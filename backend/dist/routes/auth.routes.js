"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auth_service_1 = require("../services/auth.service");
const userStore_service_1 = require("../services/userStore.service");
const db_1 = require("../db");
const gmailConnection_service_1 = require("../services/gmailConnection.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const rateLimit_middleware_1 = require("../middleware/rateLimit.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const response_1 = require("../utils/response");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const router = (0, express_1.Router)();
const BCRYPT_ROUNDS = 10;
/** Cookie name used to mark a callback as "connect Gmail to an already
 *  logged-in user" rather than "log in". Short-lived, HttpOnly. */
const GMAIL_CONNECT_COOKIE = 'gmail_connect_uid';
// ── POST /auth/google ─────────────────────────────────────────────────────────
/**
 * Initiates the Google OAuth flow.
 * Returns { isConfigured, authUrl, state } for the frontend.
 */
router.post('/google', rateLimit_middleware_1.authRateLimiter, (_req, res) => {
    try {
        const isConfigured = config_1.config.google.isConfigured;
        if (!isConfigured) {
            (0, response_1.sendSuccess)(res, {
                isConfigured: false,
                authUrl: null,
                message: 'Google OAuth credentials not configured in backend .env'
            }, 200);
            return;
        }
        const { state, signature } = (0, auth_service_1.generateOAuthState)();
        const authUrl = (0, auth_service_1.generateAuthUrl)(state);
        // Store HMAC signature in HttpOnly cookie (10-minute TTL)
        res.cookie('oauth_state_sig', signature, {
            httpOnly: true,
            secure: config_1.config.cookie.secure,
            sameSite: config_1.config.cookie.sameSite,
            maxAge: config_1.config.cookie.maxAgeMs,
            domain: config_1.config.cookie.domain || undefined,
        });
        (0, response_1.sendSuccess)(res, { isConfigured: true, authUrl, state }, 200);
    }
    catch (err) {
        logger_1.logger.error('Failed to generate OAuth URL', { error: err.message });
        (0, response_1.sendError)(res, 'Failed to initiate authentication', 500);
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
router.post('/gmail/connect', auth_middleware_1.requireAuth, rateLimit_middleware_1.authRateLimiter, (req, res) => {
    try {
        if (!config_1.config.google.isConfigured) {
            (0, response_1.sendError)(res, 'Google OAuth is not configured on the server', 503, 'GOOGLE_NOT_CONFIGURED');
            return;
        }
        const { state, signature } = (0, auth_service_1.generateOAuthState)();
        const authUrl = (0, gmailConnection_service_1.generateGmailConnectAuthUrl)(state);
        res.cookie('oauth_state_sig', signature, {
            httpOnly: true,
            secure: config_1.config.cookie.secure,
            sameSite: config_1.config.cookie.sameSite,
            maxAge: config_1.config.cookie.maxAgeMs,
            domain: config_1.config.cookie.domain || undefined,
        });
        // Marks this as a "connect" callback and identifies which existing
        // user to attach the credentials to (this route is behind requireAuth).
        res.cookie(GMAIL_CONNECT_COOKIE, req.user.userId, {
            httpOnly: true,
            secure: config_1.config.cookie.secure,
            sameSite: config_1.config.cookie.sameSite,
            maxAge: config_1.config.cookie.maxAgeMs,
            domain: config_1.config.cookie.domain || undefined,
        });
        (0, response_1.sendSuccess)(res, { authUrl, state }, 200);
    }
    catch (err) {
        logger_1.logger.error('Failed to generate Gmail connect URL', { error: err.message });
        (0, response_1.sendError)(res, 'Failed to initiate Gmail connection', 500);
    }
});
// ── POST /auth/google/quick ───────────────────────────────────────────────────
/**
 * Quick Google Login endpoint:
 * Finds or creates user in server database and issues authentic session JWTs.
 */
router.post('/google/quick', rateLimit_middleware_1.authRateLimiter, async (req, res) => {
    try {
        const { name, email, picture } = req.body || {};
        const finalEmail = (email && typeof email === 'string' && email.trim())
            ? email.trim().toLowerCase()
            : 'alex.rivera@gmail.com';
        const finalName = (name && typeof name === 'string' && name.trim())
            ? name.trim()
            : (finalEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) || 'Google User');
        const finalPicture = (picture && typeof picture === 'string' && picture.trim())
            ? picture.trim()
            : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
        const googleId = `google_${Buffer.from(finalEmail).toString('base64').replace(/=/g, '').slice(0, 16)}`;
        const dbUser = await (0, userStore_service_1.findOrCreateGoogleUser)({
            googleId,
            email: finalEmail,
            name: finalName,
        });
        const userInfo = {
            sub: dbUser.userId,
            email: finalEmail,
            name: finalName,
            picture: finalPicture,
            email_verified: true,
        };
        const fakeTokens = {
            access_token: `mock_google_token_${Date.now()}`,
            expiry_date: Date.now() + 3600 * 1000,
        };
        const authResponse = (0, auth_service_1.buildAuthResponse)(userInfo, fakeTokens, dbUser.userId);
        (0, response_1.sendSuccess)(res, authResponse, 200);
    }
    catch (err) {
        logger_1.logger.error('Quick Google login failed', { error: err.message });
        (0, response_1.sendError)(res, 'Failed to complete Google login', 500);
    }
});
// ── GET /auth/callback ────────────────────────────────────────────────────────
/**
 * Google's OAuth redirect target.
 * Exchanges the authorization code for tokens and returns app JWTs.
 */
router.get('/callback', rateLimit_middleware_1.authRateLimiter, async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    // Handle OAuth errors from Google (e.g. user denied permissions)
    if (oauthError) {
        logger_1.logger.warn('OAuth error from Google', { error: oauthError });
        res.redirect(`${config_1.config.server.allowedOrigins[0]}/auth/error?reason=${encodeURIComponent(String(oauthError))}`);
        return;
    }
    if (!code || !state) {
        logger_1.logger.warn('OAuth callback missing code or state parameter');
        res.redirect(`${config_1.config.server.allowedOrigins[0]}/auth/error?reason=missing_authorization_code`);
        return;
    }
    // Verify CSRF state
    const storedSig = req.cookies?.oauth_state_sig;
    if (!storedSig || !(0, auth_service_1.verifyOAuthState)(String(state), storedSig)) {
        if (config_1.config.server.isDevelopment) {
            logger_1.logger.warn('OAuth state cookie missing or unverified in dev — proceeding with exchange');
        }
        else {
            logger_1.logger.warn('OAuth state mismatch — possible CSRF attempt');
            res.redirect(`${config_1.config.server.allowedOrigins[0]}/auth/error?reason=state_mismatch`);
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
        const settingsUrl = `${config_1.config.server.allowedOrigins[0]}/#/settings`;
        try {
            const tokens = await (0, auth_service_1.exchangeCodeForTokens)(String(code));
            if (!tokens.access_token) {
                throw new Error('TOKEN_EXCHANGE_FAILED');
            }
            const userInfo = await (0, auth_service_1.fetchGoogleUserInfo)(tokens.access_token);
            await (0, gmailConnection_service_1.completeGmailConnection)(String(gmailConnectUserId), tokens, userInfo.email);
            res.redirect(`${settingsUrl}?gmail=connected`);
        }
        catch (err) {
            const errorMsg = err.message || 'connect_failed';
            logger_1.logger.error('Gmail connect callback failed', { error: errorMsg, userId: gmailConnectUserId });
            res.redirect(`${settingsUrl}?gmail=error&reason=${encodeURIComponent(errorMsg)}`);
        }
        return;
    }
    try {
        // Exchange code for tokens
        const tokens = await (0, auth_service_1.exchangeCodeForTokens)(String(code));
        if (!tokens.access_token) {
            logger_1.logger.error('Token exchange failed: no access token returned');
            res.redirect(`${config_1.config.server.allowedOrigins[0]}/auth/error?reason=token_exchange_failed`);
            return;
        }
        // Fetch user profile from Google
        const userInfo = await (0, auth_service_1.fetchGoogleUserInfo)(tokens.access_token);
        // Find or create Kanakku user in server database
        const dbUser = await (0, userStore_service_1.findOrCreateGoogleUser)({
            googleId: userInfo.sub,
            email: userInfo.email,
            name: userInfo.name,
        });
        // Build our application auth response with unified user ID
        const authResponse = (0, auth_service_1.buildAuthResponse)(userInfo, tokens, dbUser.userId, dbUser);
        logger_1.logger.info('User authenticated successfully with Google OAuth', { userId: dbUser.userId, email: userInfo.email });
        // Redirect to frontend with tokens
        const redirectUrl = new URL(`${config_1.config.server.allowedOrigins[0]}/auth/success`);
        redirectUrl.searchParams.set('accessToken', authResponse.accessToken);
        redirectUrl.searchParams.set('refreshToken', authResponse.refreshToken);
        redirectUrl.searchParams.set('expiresIn', String(authResponse.expiresIn));
        res.redirect(redirectUrl.toString());
    }
    catch (err) {
        const errorMsg = err.message || 'callback_failed';
        logger_1.logger.error('OAuth callback failed', { error: errorMsg });
        res.redirect(`${config_1.config.server.allowedOrigins[0]}/auth/error?reason=${encodeURIComponent(errorMsg)}`);
    }
});
// ── POST /auth/email/register ───────────────────────────────────────────────
/**
 * Register a new account with email + password in users database table.
 */
router.post('/email/register', rateLimit_middleware_1.authRateLimiter, validation_middleware_1.validateEmailRegister, async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const existing = await (0, userStore_service_1.findUserByEmail)(email);
        if (existing) {
            (0, response_1.sendError)(res, 'An account with this email already exists', 409, 'EMAIL_ALREADY_REGISTERED');
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, BCRYPT_ROUNDS);
        const user = await (0, userStore_service_1.createUser)({ email, name, passwordHash });
        const authResponse = (0, auth_service_1.buildEmailAuthResponse)(user);
        logger_1.logger.info('User registered with email', { userId: user.userId });
        (0, response_1.sendSuccess)(res, authResponse, 201);
    }
    catch (err) {
        const message = err.message;
        if (message === 'EMAIL_ALREADY_REGISTERED') {
            (0, response_1.sendError)(res, 'An account with this email already exists', 409, 'EMAIL_ALREADY_REGISTERED');
            return;
        }
        logger_1.logger.error('Email registration failed', { error: message });
        (0, response_1.sendError)(res, 'Registration failed', 500);
    }
});
// ── POST /auth/email/login ──────────────────────────────────────────────────
/**
 * Sign in with email + password against the users database table.
 */
router.post('/email/login', rateLimit_middleware_1.authRateLimiter, validation_middleware_1.validateEmailLogin, async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await (0, userStore_service_1.findUserByEmail)(email);
        if (!user || !user.passwordHash) {
            (0, response_1.sendError)(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
            return;
        }
        const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!valid) {
            (0, response_1.sendError)(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
            return;
        }
        await (0, userStore_service_1.recordUserLogin)(user.userId);
        const authResponse = (0, auth_service_1.buildEmailAuthResponse)(user);
        logger_1.logger.info('User logged in with email', { userId: user.userId });
        (0, response_1.sendSuccess)(res, authResponse, 200);
    }
    catch (err) {
        logger_1.logger.error('Email login failed', { error: err.message });
        (0, response_1.sendError)(res, 'Login failed', 500);
    }
});
// ── POST /auth/refresh ────────────────────────────────────────────────────────
/**
 * Exchange a refresh token for a new access token.
 */
router.post('/refresh', rateLimit_middleware_1.authRateLimiter, validation_middleware_1.validateTokenRefresh, async (req, res) => {
    const { refreshToken } = req.body;
    try {
        const payload = (0, auth_service_1.verifyRefreshJwt)(refreshToken);
        logger_1.logger.info('Token refreshed', { userId: payload.userId });
        const { accessToken: newAccessToken, expiresIn } = await (0, auth_service_1.createSessionJwtFromRefresh)(payload);
        (0, response_1.sendSuccess)(res, {
            accessToken: newAccessToken,
            expiresIn,
        });
    }
    catch (err) {
        const msg = err.message ?? '';
        if (msg.includes('expired')) {
            (0, response_1.sendError)(res, 'Refresh token expired, please log in again', 401, 'REFRESH_EXPIRED');
        }
        else {
            (0, response_1.sendError)(res, 'Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
        }
    }
});
// ── POST /auth/logout ─────────────────────────────────────────────────────────
/**
 * Logout — client must discard tokens.
 * Server-side: clears any cookies.
 */
router.post('/logout', auth_middleware_1.requireAuth, (req, res) => {
    res.clearCookie('oauth_state_sig');
    logger_1.logger.info('User logged out', { userId: req.user?.userId });
    (0, response_1.sendSuccess)(res, { message: 'Logged out successfully' });
});
// ── GET /auth/me ──────────────────────────────────────────────────────────────
/**
 * Get current authenticated user's public profile from server database.
 */
router.get('/me', auth_middleware_1.requireAuth, async (req, res) => {
    const user = req.user;
    let dbUser = await (0, userStore_service_1.findUserById)(user.userId);
    if (!dbUser && user.email) {
        dbUser = await (0, userStore_service_1.findUserByEmail)(user.email);
    }
    const profile = {
        userId: dbUser?.userId || user.userId,
        email: dbUser?.email || user.email,
        name: dbUser?.name || user.name,
        picture: dbUser?.picture || user.picture || '',
        workType: dbUser?.workType || undefined,
        language: dbUser?.language || 'en',
    };
    (0, response_1.sendSuccess)(res, { user: profile });
});
// ── PUT /auth/me ──────────────────────────────────────────────────────────────
/**
 * Update current authenticated user's profile in database (picture, name, workType, language).
 */
router.put('/me', auth_middleware_1.requireAuth, async (req, res) => {
    const user = req.user;
    const { name, picture, workType, language } = req.body;
    const updates = {};
    if (name !== undefined)
        updates.display_name = name;
    if (picture !== undefined)
        updates.picture = picture;
    if (workType !== undefined)
        updates.work_type = workType;
    if (language !== undefined)
        updates.language = language;
    let updated = await (0, userStore_service_1.updateUserProfile)(user.userId, updates);
    if (!updated && user.email) {
        const existing = await (0, userStore_service_1.findUserByEmail)(user.email);
        if (existing) {
            updated = await (0, userStore_service_1.updateUserProfile)(existing.userId, updates);
        }
        else {
            try {
                const now = new Date().toISOString();
                const record = await db_1.db.createUser({
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
            }
            catch (_) { }
        }
    }
    const profile = {
        userId: user.userId,
        email: updated?.email || user.email,
        name: updated?.name || updates.display_name || user.name,
        picture: updated?.picture || (picture !== undefined ? picture : user.picture) || '',
        workType: updated?.workType || (workType !== undefined ? workType : undefined),
        language: updated?.language || (language !== undefined ? language : 'en'),
    };
    (0, response_1.sendSuccess)(res, { user: profile });
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map