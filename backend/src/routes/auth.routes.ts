/**
 * Authentication Routes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POST /auth/google       → Initiate OAuth flow (returns redirect URL)
 * GET  /auth/callback     → OAuth callback (exchanges code, issues tokens)
 * POST /auth/google/quick → Quick Google login (instant DB account & session)
 * POST /auth/email/register → Email/password registration (stored in users table)
 * POST /auth/email/login    → Email/password login (verified against users table)
 * POST /auth/refresh      → Refresh access token
 * POST /auth/logout       → Revoke session (client must discard tokens)
 * GET  /auth/me           → Get current user profile
 *
 * Security:
 *   • Single unified 'users' table in server database
 *   • Passwords securely hashed with bcrypt (10 rounds)
 *   • Password hash and credentials NEVER returned to client
 *   • NO financial transactions or chat logs stored on server
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  generateAuthUrl,
  generateOAuthState,
  verifyOAuthState,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  buildAuthResponse,
  buildEmailAuthResponse,
  verifyRefreshJwt,
  createSessionJwtFromRefresh,
} from '../services/auth.service';
import {
  findUserByEmail,
  findUserById,
  createUser,
  findOrCreateGoogleUser,
  recordUserLogin,
  updateUserProfile,
} from '../services/userStore.service';
import { db } from '../db';
import { generateGmailConnectAuthUrl, completeGmailConnection } from '../services/gmailConnection.service';
import { requireAuth } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rateLimit.middleware';
import { validateTokenRefresh, validateEmailRegister, validateEmailLogin } from '../middleware/validation.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { PublicUserProfile, GoogleUserInfo, OAuthTokens } from '../types/auth.types';

const router = Router();
const BCRYPT_ROUNDS = 10;
/** Cookie name used to mark a callback as "connect Gmail to an already
 *  logged-in user" rather than "log in". Short-lived, HttpOnly. */
const GMAIL_CONNECT_COOKIE = 'gmail_connect_uid';

// ── POST /auth/google ─────────────────────────────────────────────────────────
/**
 * Initiates the Google OAuth flow.
 * Returns { isConfigured, authUrl, state } for the frontend.
 */
router.post('/google', authRateLimiter, (_req: Request, res: Response): void => {
  try {
    const isConfigured = config.google.isConfigured;

    if (!isConfigured) {
      sendSuccess(res, {
        isConfigured: false,
        authUrl: null,
        message: 'Google OAuth credentials not configured in backend .env'
      }, 200);
      return;
    }

    const { state, signature } = generateOAuthState();
    const authUrl = generateAuthUrl(state);

    // Store HMAC signature in HttpOnly cookie (10-minute TTL)
    res.cookie('oauth_state_sig', signature, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      maxAge: config.cookie.maxAgeMs,
      domain: config.cookie.domain || undefined,
    });

    sendSuccess(res, { isConfigured: true, authUrl, state }, 200);
  } catch (err) {
    logger.error('Failed to generate OAuth URL', { error: (err as Error).message });
    sendError(res, 'Failed to initiate authentication', 500);
  }
});

// ── POST /auth/gmail/connect ────────────────────────────────────────────────
/**
 * Initiates the "Connect Gmail" flow for an ALREADY-LOGGED-IN Kanakku
 * user (any auth provider). Distinct from /auth/google (which is the
 * login flow) — this attaches a persisted, independently-disconnectable
 * Gmail connection to the current user without touching their session.
 *
 * Reuses the existing /auth/callback redirect URI (see the branch at
 * the top of that route below) rather than requiring a second
 * "authorized redirect URI" to be registered in Google Cloud Console.
 */
router.post('/gmail/connect', requireAuth, authRateLimiter, (req: Request, res: Response): void => {
  try {
    if (!config.google.isConfigured) {
      sendError(res, 'Google OAuth is not configured on the server', 503, 'GOOGLE_NOT_CONFIGURED');
      return;
    }

    const { state, signature } = generateOAuthState();
    const authUrl = generateGmailConnectAuthUrl(state);

    res.cookie('oauth_state_sig', signature, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      maxAge: config.cookie.maxAgeMs,
      domain: config.cookie.domain || undefined,
    });
    // Marks this as a "connect" callback and identifies which existing
    // user to attach the credentials to (this route is behind requireAuth).
    res.cookie(GMAIL_CONNECT_COOKIE, req.user!.userId, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      maxAge: config.cookie.maxAgeMs,
      domain: config.cookie.domain || undefined,
    });

    sendSuccess(res, { authUrl, state }, 200);
  } catch (err) {
    logger.error('Failed to generate Gmail connect URL', { error: (err as Error).message });
    sendError(res, 'Failed to initiate Gmail connection', 500);
  }
});

// ── POST /auth/google/quick ───────────────────────────────────────────────────
/**
 * Quick Google Login endpoint:
 * Finds or creates user in server database and issues authentic session JWTs.
 */
router.post('/google/quick', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, picture } = req.body || {};
    const finalEmail = (email && typeof email === 'string' && email.trim())
      ? email.trim().toLowerCase()
      : 'alex.rivera@gmail.com';
    const finalName = (name && typeof name === 'string' && name.trim())
      ? name.trim()
      : (finalEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Google User');
    const finalPicture = (picture && typeof picture === 'string' && picture.trim())
      ? picture.trim()
      : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
    const googleId = `google_${Buffer.from(finalEmail).toString('base64').replace(/=/g, '').slice(0, 16)}`;

    const dbUser = await findOrCreateGoogleUser({
      googleId,
      email: finalEmail,
      name: finalName,
    });

    const userInfo: GoogleUserInfo = {
      sub: dbUser.userId,
      email: finalEmail,
      name: finalName,
      picture: finalPicture,
      email_verified: true,
    };

    const fakeTokens: OAuthTokens = {
      access_token: `mock_google_token_${Date.now()}`,
      expiry_date: Date.now() + 3600 * 1000,
    };

    const authResponse = buildAuthResponse(userInfo, fakeTokens, dbUser.userId);
    sendSuccess(res, authResponse, 200);
  } catch (err) {
    logger.error('Quick Google login failed', { error: (err as Error).message });
    sendError(res, 'Failed to complete Google login', 500);
  }
});

// ── GET /auth/callback ────────────────────────────────────────────────────────
/**
 * Google's OAuth redirect target.
 * Exchanges the authorization code for tokens and returns app JWTs.
 */
router.get('/callback', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const { code, state, error: oauthError } = req.query;

  // Handle OAuth errors from Google (e.g. user denied permissions)
  if (oauthError) {
    logger.warn('OAuth error from Google', { error: oauthError });
    res.redirect(
      `${config.server.allowedOrigins[0]}/auth/error?reason=${encodeURIComponent(String(oauthError))}`
    );
    return;
  }

  if (!code || !state) {
    logger.warn('OAuth callback missing code or state parameter');
    res.redirect(
      `${config.server.allowedOrigins[0]}/auth/error?reason=missing_authorization_code`
    );
    return;
  }

  // Verify CSRF state
  const storedSig = req.cookies?.oauth_state_sig;
  if (!storedSig || !verifyOAuthState(String(state), storedSig)) {
    if (config.server.isDevelopment) {
      logger.warn('OAuth state cookie missing or unverified in dev — proceeding with exchange');
    } else {
      logger.warn('OAuth state mismatch — possible CSRF attempt');
      res.redirect(
        `${config.server.allowedOrigins[0]}/auth/error?reason=state_mismatch`
      );
      return;
    }
  }

  // Clear the state cookie
  res.clearCookie('oauth_state_sig');

  // Was this callback triggered by "Connect Gmail" (from an already
  // logged-in user) rather than a login? Branch entirely separately —
  // the login path below is untouched when this cookie isn't present.
  const gmailConnectUserId = req.cookies?.[GMAIL_CONNECT_COOKIE];
  if (gmailConnectUserId) {
    res.clearCookie(GMAIL_CONNECT_COOKIE);
    const settingsUrl = `${config.server.allowedOrigins[0]}/#/settings`;

    try {
      const tokens = await exchangeCodeForTokens(String(code));
      if (!tokens.access_token) {
        throw new Error('TOKEN_EXCHANGE_FAILED');
      }

      const userInfo = await fetchGoogleUserInfo(tokens.access_token);
      await completeGmailConnection(String(gmailConnectUserId), tokens, userInfo.email);

      res.redirect(`${settingsUrl}?gmail=connected`);
    } catch (err) {
      const errorMsg = (err as Error).message || 'connect_failed';
      logger.error('Gmail connect callback failed', { error: errorMsg, userId: gmailConnectUserId });
      res.redirect(`${settingsUrl}?gmail=error&reason=${encodeURIComponent(errorMsg)}`);
    }
    return;
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(String(code));

    if (!tokens.access_token) {
      logger.error('Token exchange failed: no access token returned');
      res.redirect(
        `${config.server.allowedOrigins[0]}/auth/error?reason=token_exchange_failed`
      );
      return;
    }

    // Fetch user profile from Google
    const userInfo = await fetchGoogleUserInfo(tokens.access_token);

    // Find or create Kanakku user in server database
    const dbUser = await findOrCreateGoogleUser({
      googleId: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
    });

    // Build our application auth response with unified user ID
    const authResponse = buildAuthResponse(userInfo, tokens, dbUser.userId, dbUser);

    logger.info('User authenticated successfully with Google OAuth', { userId: dbUser.userId, email: userInfo.email });

    // Redirect to frontend with tokens
    const redirectUrl = new URL(`${config.server.allowedOrigins[0]}/auth/success`);
    redirectUrl.searchParams.set('accessToken', authResponse.accessToken);
    redirectUrl.searchParams.set('refreshToken', authResponse.refreshToken);
    redirectUrl.searchParams.set('expiresIn', String(authResponse.expiresIn));

    res.redirect(redirectUrl.toString());
  } catch (err) {
    const errorMsg = (err as Error).message || 'callback_failed';
    logger.error('OAuth callback failed', { error: errorMsg });
    res.redirect(
      `${config.server.allowedOrigins[0]}/auth/error?reason=${encodeURIComponent(errorMsg)}`
    );
  }
});

// ── POST /auth/email/register ───────────────────────────────────────────────
/**
 * Register a new account with email + password in users database table.
 */
router.post(
  '/email/register',
  authRateLimiter,
  validateEmailRegister,
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password } = req.body as { name: string; email: string; password: string };

    try {
      const existing = await findUserByEmail(email);
      if (existing) {
        sendError(res, 'An account with this email already exists', 409, 'EMAIL_ALREADY_REGISTERED');
        return;
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = await createUser({ email, name, passwordHash });

      const authResponse = buildEmailAuthResponse(user);
      logger.info('User registered with email', { userId: user.userId });

      sendSuccess(res, authResponse, 201);
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'EMAIL_ALREADY_REGISTERED') {
        sendError(res, 'An account with this email already exists', 409, 'EMAIL_ALREADY_REGISTERED');
        return;
      }
      logger.error('Email registration failed', { error: message });
      sendError(res, 'Registration failed', 500);
    }
  }
);

// ── POST /auth/email/login ──────────────────────────────────────────────────
/**
 * Sign in with email + password against the users database table.
 */
router.post(
  '/email/login',
  authRateLimiter,
  validateEmailLogin,
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body as { email: string; password: string };

    try {
      const user = await findUserByEmail(email);
      if (!user || !user.passwordHash) {
        sendError(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        sendError(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
        return;
      }

      await recordUserLogin(user.userId);
      const authResponse = buildEmailAuthResponse(user);
      logger.info('User logged in with email', { userId: user.userId });

      sendSuccess(res, authResponse, 200);
    } catch (err) {
      logger.error('Email login failed', { error: (err as Error).message });
      sendError(res, 'Login failed', 500);
    }
  }
);

// ── POST /auth/refresh ────────────────────────────────────────────────────────
/**
 * Exchange a refresh token for a new access token.
 */
router.post(
  '/refresh',
  authRateLimiter,
  validateTokenRefresh,
  async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body as { refreshToken: string };

    try {
      const payload = verifyRefreshJwt(refreshToken);

      logger.info('Token refreshed', { userId: payload.userId });

      const { accessToken: newAccessToken, expiresIn } = await createSessionJwtFromRefresh(payload);

      sendSuccess(res, {
        accessToken: newAccessToken,
        expiresIn,
      });
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('expired')) {
        sendError(res, 'Refresh token expired, please log in again', 401, 'REFRESH_EXPIRED');
      } else {
        sendError(res, 'Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
      }
    }
  }
);

// ── POST /auth/logout ─────────────────────────────────────────────────────────
/**
 * Logout — client must discard tokens.
 * Server-side: clears any cookies.
 */
router.post('/logout', requireAuth, (req: Request, res: Response): void => {
  res.clearCookie('oauth_state_sig');
  logger.info('User logged out', { userId: req.user?.userId });
  sendSuccess(res, { message: 'Logged out successfully' });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
/**
 * Get current authenticated user's public profile from server database.
 */
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  let dbUser = await findUserById(user.userId);
  if (!dbUser && user.email) {
    dbUser = await findUserByEmail(user.email);
  }

  const profile: PublicUserProfile = {
    userId: dbUser?.userId || user.userId,
    email: dbUser?.email || user.email,
    name: dbUser?.name || user.name,
    picture: dbUser?.picture || user.picture || '',
    workType: dbUser?.workType || undefined,
    language: dbUser?.language || 'en',
  };
  sendSuccess(res, { user: profile });
});

// ── PUT /auth/me ──────────────────────────────────────────────────────────────
/**
 * Update current authenticated user's profile in database (picture, name, workType, language).
 */
router.put('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const { name, picture, workType, language } = req.body as {
    name?: string;
    picture?: string;
    workType?: string;
    language?: string;
  };

  const updates: Parameters<typeof updateUserProfile>[1] = {};
  if (name !== undefined) updates.display_name = name;
  if (picture !== undefined) updates.picture = picture;
  if (workType !== undefined) updates.work_type = workType;
  if (language !== undefined) updates.language = language;

  let updated = await updateUserProfile(user.userId, updates);
  if (!updated && user.email) {
    const existing = await findUserByEmail(user.email);
    if (existing) {
      updated = await updateUserProfile(existing.userId, updates);
    } else {
      try {
        const now = new Date().toISOString();
        const record = await db.createUser({
          id: user.userId,
          email: user.email.trim().toLowerCase(),
          display_name: updates.display_name || user.name || 'User',
          google_id: null,
          password_hash: null,
          language: updates.language || 'en',
          account_status: 'active',
          picture: updates.picture !== undefined ? updates.picture : (user.picture || null),
          work_type: updates.work_type !== undefined ? updates.work_type : null,
          created_at: now,
          updated_at: now,
          last_login_at: now,
        });
        updated = {
          userId: record.id,
          email: record.email,
          name: record.display_name,
          picture: record.picture,
          workType: record.work_type,
          language: record.language,
          accountStatus: record.account_status,
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        };
      } catch (_) {}
    }
  }

  const profile: PublicUserProfile = {
    userId: user.userId,
    email: updated?.email || user.email,
    name: updated?.name || updates.display_name || user.name,
    picture: updated?.picture || (picture !== undefined ? picture : user.picture) || '',
    workType: updated?.workType || (workType !== undefined ? workType : undefined),
    language: updated?.language || (language !== undefined ? language : 'en'),
  };
  sendSuccess(res, { user: profile });
});

export default router;
