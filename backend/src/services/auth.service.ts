/**
 * Google OAuth 2.0 Service
 * ─────────────────────────────────────────────────────────────────────────
 * Handles:
 *  • Generating the OAuth authorization URL
 *  • Exchanging the authorization code for tokens
 *  • Fetching the user's Google profile
 *  • Refreshing expired access tokens
 *  • Creating / verifying our application JWTs
 *
 * Security:
 *  • OAuth tokens are NEVER returned to the frontend
 *  • OAuth tokens are AES-256-GCM encrypted before being embedded in JWT
 *  • State parameter is signed and stored in a short-lived HttpOnly cookie
 * ─────────────────────────────────────────────────────────────────────────
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import { config } from '../config';
import { encryptToken, decryptToken } from '../utils/crypto';
import { logger } from '../utils/logger';
import type {
  OAuthTokens,
  GoogleUserInfo,
  SessionPayload,
  RefreshTokenPayload,
  AuthResponse,
  PublicUserProfile,
} from '../types/auth.types';

// ─── OAuth2 Client ────────────────────────────────────────────────────────────

function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// ─── State Parameter ──────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random state parameter for CSRF protection.
 * Returns { state, signature } where signature = HMAC-SHA256(state, COOKIE_SECRET)
 */
export function generateOAuthState(): { state: string; signature: string } {
  const state = crypto.randomBytes(32).toString('hex');
  const signature = crypto
    .createHmac('sha256', config.cookie.secret)
    .update(state)
    .digest('hex');
  return { state, signature };
}

/**
 * Verify the state parameter returned by Google matches what we sent.
 */
export function verifyOAuthState(state: string, signature: string): boolean {
  if (!state || !signature || typeof state !== 'string' || typeof signature !== 'string') {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', config.cookie.secret)
    .update(state)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const sigBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== sigBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

// ─── Authorization URL ────────────────────────────────────────────────────────

export function generateAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',       // Request refresh token
    scope: config.google.scopes,
    state,
    prompt: 'consent',            // Always show consent to get refresh_token
    include_granted_scopes: true,
  });
}

// ─── Code Exchange ────────────────────────────────────────────────────────────

export async function exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens as OAuthTokens;
}

// ─── User Profile ─────────────────────────────────────────────────────────────

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const client = createOAuth2Client();
  client.setCredentials({ access_token: accessToken });

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  const userId = data.id || (data as Record<string, unknown>).sub;
  if (!userId || !data.email) {
    throw new Error('Incomplete user profile returned from Google');
  }

  return {
    sub: String(userId),
    email: data.email,
    name: data.name || '',
    picture: data.picture || '',
    email_verified: !!data.verified_email,
    locale: data.locale || undefined,
  };
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

/**
 * Use a refresh token to get a new access token.
 * Called transparently when the Gmail service detects token expiry.
 */
export async function refreshGoogleAccessToken(
  encryptedRefreshToken: string
): Promise<{ accessToken: string; expiryMs: number }> {
  const refreshToken = decryptToken(encryptedRefreshToken);
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Token refresh failed: no access token returned');
  }

  logger.info('Google access token refreshed successfully');

  return {
    accessToken: credentials.access_token,
    expiryMs: credentials.expiry_date ?? Date.now() + 3600 * 1000,
  };
}

// ─── Application JWT ──────────────────────────────────────────────────────────

export function createSessionJwt(
  userInfo: GoogleUserInfo,
  tokens: OAuthTokens
): string {
  const encryptedAccessToken = encryptToken(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : undefined;

  const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
    userId: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
    authProvider: 'google',
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenExpiryMs: tokens.expiry_date ?? undefined,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

/**
 * Session JWT for email/password-authenticated users. No Google OAuth
 * tokens exist for these users, so Gmail auto-sync is simply
 * unavailable to them — everything else (manual entry, receipts,
 * reports, AI chat) works the same.
 */
export function createEmailSessionJwt(user: {
  userId: string;
  email: string;
  name: string;
  picture?: string | null;
}): string {
  const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    picture: user.picture || '',
    authProvider: 'email',
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

export function createRefreshJwt(
  userId: string,
  extra?: {
    email?: string;
    name?: string;
    picture?: string;
    authProvider?: 'google' | 'email';
    encryptedRefreshToken?: string;
  }
): string {
  const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
    userId,
    tokenVersion: 1,
    ...extra,
  };

  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as jwt.SignOptions);
}

export function verifySessionJwt(token: string): SessionPayload {
  return jwt.verify(token, config.jwt.secret) as SessionPayload;
}

export function verifyRefreshJwt(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
}

/**
 * Creates a new session access token (signed with JWT_SECRET)
 * using claims verified from a valid refresh token.
 */
export async function createSessionJwtFromRefresh(
  refreshPayload: RefreshTokenPayload
): Promise<{ accessToken: string; expiresIn: number }> {
  let sessionJwt: string;

  if (refreshPayload.authProvider === 'email') {
    sessionJwt = createEmailSessionJwt({
      userId: refreshPayload.userId,
      email: refreshPayload.email || '',
      name: refreshPayload.name || '',
    });
  } else {
    // Google OAuth session
    let encryptedAccessToken: string | undefined;
    let tokenExpiryMs: number | undefined;

    if (refreshPayload.encryptedRefreshToken) {
      try {
        const refreshedGoogle = await refreshGoogleAccessToken(refreshPayload.encryptedRefreshToken);
        encryptedAccessToken = encryptToken(refreshedGoogle.accessToken);
        tokenExpiryMs = refreshedGoogle.expiryMs;
      } catch (err) {
        logger.warn('Google token refresh during app session refresh failed', {
          userId: refreshPayload.userId,
          error: (err as Error).message,
        });
      }
    }

    const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
      userId: refreshPayload.userId,
      email: refreshPayload.email || '',
      name: refreshPayload.name || '',
      picture: refreshPayload.picture || '',
      authProvider: 'google',
      encryptedAccessToken,
      encryptedRefreshToken: refreshPayload.encryptedRefreshToken,
      tokenExpiryMs,
    };

    sessionJwt = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as jwt.SignOptions);
  }

  const decoded = jwt.decode(sessionJwt) as { exp?: number };
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 7200;

  return { accessToken: sessionJwt, expiresIn };
}

// ─── Auth Response Builder ────────────────────────────────────────────────────

/**
 * Build the AuthResponse sent to the client.
 * NOTE: No OAuth tokens included — only our app tokens.
 */
export function buildAuthResponse(
  userInfo: GoogleUserInfo,
  tokens: OAuthTokens,
  customUserId?: string,
  existingDbUser?: { picture?: string | null; workType?: string | null; language?: string }
): AuthResponse {
  const userId = customUserId || userInfo.sub;
  const picture = existingDbUser?.picture || userInfo.picture || '';
  const userInfoWithId: GoogleUserInfo = {
    ...userInfo,
    sub: userId,
    picture,
  };
  const accessToken = createSessionJwt(userInfoWithId, tokens);
  const encryptedRefreshToken = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : undefined;

  const refreshToken = createRefreshJwt(userId, {
    email: userInfo.email,
    name: userInfo.name,
    picture,
    authProvider: 'google',
    encryptedRefreshToken,
  });

  // Calculate expiry in seconds
  const decoded = jwt.decode(accessToken) as { exp?: number };
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 7200;

  const user: PublicUserProfile = {
    userId,
    email: userInfo.email,
    name: userInfo.name,
    picture,
    workType: existingDbUser?.workType || undefined,
    language: existingDbUser?.language || 'en',
  };

  return { accessToken, refreshToken, expiresIn, user };
}

/**
 * Build the AuthResponse sent to the client for email/password sign-in.
 * Mirrors buildAuthResponse's shape so the frontend handles both
 * providers identically.
 */
export function buildEmailAuthResponse(user: {
  userId: string;
  email: string;
  name: string;
  picture?: string | null;
  workType?: string | null;
  language?: string;
}): AuthResponse {
  const accessToken = createEmailSessionJwt(user);
  const refreshToken = createRefreshJwt(user.userId, {
    email: user.email,
    name: user.name,
    picture: user.picture || '',
    authProvider: 'email',
  });

  const decoded = jwt.decode(accessToken) as { exp?: number };
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;

  const publicUser: PublicUserProfile = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    picture: user.picture || '',
    workType: user.workType || undefined,
    language: user.language || 'en',
  };

  return { accessToken, refreshToken, expiresIn, user: publicUser };
}

// ─── OAuth2 Client for Gmail ──────────────────────────────────────────────────

/**
 * Create an authenticated OAuth2Client from a session payload.
 * Transparently refreshes the access token if it has expired.
 *
 * Only valid for Google-provider sessions. Email/password sessions
 * have no Gmail tokens at all — callers must check this before
 * offering any Gmail-dependent feature to an email-auth user.
 */
export async function createAuthenticatedClient(
  session: SessionPayload
): Promise<OAuth2Client> {
  if (session.authProvider !== 'google' || !session.encryptedAccessToken) {
    throw new Error('GMAIL_NOT_AVAILABLE: This account signed in with email, not Google, so Gmail sync is not available.');
  }

  const client = createOAuth2Client();

  let accessToken = decryptToken(session.encryptedAccessToken);
  let expiryMs = session.tokenExpiryMs;

  // Refresh if expired or expiring within 2 minutes
  const needsRefresh =
    !expiryMs || Date.now() >= expiryMs - 2 * 60 * 1000;

  if (needsRefresh && session.encryptedRefreshToken) {
    try {
      const refreshed = await refreshGoogleAccessToken(session.encryptedRefreshToken);
      accessToken = refreshed.accessToken;
      expiryMs = refreshed.expiryMs;
    } catch (err) {
      logger.warn('Token refresh failed, proceeding with existing token', { error: (err as Error).message });
    }
  }

  client.setCredentials({
    access_token: accessToken,
    expiry_date: expiryMs,
  });

  return client;
}
