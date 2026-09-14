"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOAuthState = generateOAuthState;
exports.verifyOAuthState = verifyOAuthState;
exports.generateAuthUrl = generateAuthUrl;
exports.exchangeCodeForTokens = exchangeCodeForTokens;
exports.fetchGoogleUserInfo = fetchGoogleUserInfo;
exports.refreshGoogleAccessToken = refreshGoogleAccessToken;
exports.createSessionJwt = createSessionJwt;
exports.createEmailSessionJwt = createEmailSessionJwt;
exports.createRefreshJwt = createRefreshJwt;
exports.verifySessionJwt = verifySessionJwt;
exports.verifyRefreshJwt = verifyRefreshJwt;
exports.createSessionJwtFromRefresh = createSessionJwtFromRefresh;
exports.buildAuthResponse = buildAuthResponse;
exports.buildEmailAuthResponse = buildEmailAuthResponse;
exports.createAuthenticatedClient = createAuthenticatedClient;
const googleapis_1 = require("googleapis");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const crypto_2 = require("../utils/crypto");
const logger_1 = require("../utils/logger");
// ─── OAuth2 Client ────────────────────────────────────────────────────────────
function createOAuth2Client() {
    return new googleapis_1.google.auth.OAuth2(config_1.config.google.clientId, config_1.config.google.clientSecret, config_1.config.google.redirectUri);
}
// ─── State Parameter ──────────────────────────────────────────────────────────
/**
 * Generate a cryptographically random state parameter for CSRF protection.
 * Returns { state, signature } where signature = HMAC-SHA256(state, COOKIE_SECRET)
 */
function generateOAuthState() {
    const state = crypto_1.default.randomBytes(32).toString('hex');
    const signature = crypto_1.default
        .createHmac('sha256', config_1.config.cookie.secret)
        .update(state)
        .digest('hex');
    return { state, signature };
}
/**
 * Verify the state parameter returned by Google matches what we sent.
 */
function verifyOAuthState(state, signature) {
    if (!state || !signature || typeof state !== 'string' || typeof signature !== 'string') {
        return false;
    }
    const expected = crypto_1.default
        .createHmac('sha256', config_1.config.cookie.secret)
        .update(state)
        .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const sigBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== sigBuf.length) {
        return false;
    }
    return crypto_1.default.timingSafeEqual(expectedBuf, sigBuf);
}
// ─── Authorization URL ────────────────────────────────────────────────────────
function generateAuthUrl(state) {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
        access_type: 'offline', // Request refresh token
        scope: config_1.config.google.scopes,
        state,
        prompt: 'consent', // Always show consent to get refresh_token
        include_granted_scopes: true,
    });
}
// ─── Code Exchange ────────────────────────────────────────────────────────────
async function exchangeCodeForTokens(code) {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    return tokens;
}
// ─── User Profile ─────────────────────────────────────────────────────────────
async function fetchGoogleUserInfo(accessToken) {
    const client = createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    const userId = data.id || data.sub;
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
async function refreshGoogleAccessToken(encryptedRefreshToken) {
    const refreshToken = (0, crypto_2.decryptToken)(encryptedRefreshToken);
    const client = createOAuth2Client();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
        throw new Error('Token refresh failed: no access token returned');
    }
    logger_1.logger.info('Google access token refreshed successfully');
    return {
        accessToken: credentials.access_token,
        expiryMs: credentials.expiry_date ?? Date.now() + 3600 * 1000,
    };
}
// ─── Application JWT ──────────────────────────────────────────────────────────
function createSessionJwt(userInfo, tokens) {
    const encryptedAccessToken = (0, crypto_2.encryptToken)(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
        ? (0, crypto_2.encryptToken)(tokens.refresh_token)
        : undefined;
    const payload = {
        userId: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        authProvider: 'google',
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiryMs: tokens.expiry_date ?? undefined,
    };
    return jsonwebtoken_1.default.sign(payload, config_1.config.jwt.secret, {
        expiresIn: config_1.config.jwt.expiresIn,
    });
}
/**
 * Session JWT for email/password-authenticated users. No Google OAuth
 * tokens exist for these users, so Gmail auto-sync is simply
 * unavailable to them — everything else (manual entry, receipts,
 * reports, AI chat) works the same.
 */
function createEmailSessionJwt(user) {
    const payload = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture || '',
        authProvider: 'email',
    };
    return jsonwebtoken_1.default.sign(payload, config_1.config.jwt.secret, {
        expiresIn: config_1.config.jwt.expiresIn,
    });
}
function createRefreshJwt(userId, extra) {
    const payload = {
        userId,
        tokenVersion: 1,
        ...extra,
    };
    return jsonwebtoken_1.default.sign(payload, config_1.config.jwt.refreshSecret, {
        expiresIn: config_1.config.jwt.refreshExpiresIn,
    });
}
function verifySessionJwt(token) {
    return jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
}
function verifyRefreshJwt(token) {
    return jsonwebtoken_1.default.verify(token, config_1.config.jwt.refreshSecret);
}
/**
 * Creates a new session access token (signed with JWT_SECRET)
 * using claims verified from a valid refresh token.
 */
async function createSessionJwtFromRefresh(refreshPayload) {
    let sessionJwt;
    if (refreshPayload.authProvider === 'email') {
        sessionJwt = createEmailSessionJwt({
            userId: refreshPayload.userId,
            email: refreshPayload.email || '',
            name: refreshPayload.name || '',
        });
    }
    else {
        // Google OAuth session
        let encryptedAccessToken;
        let tokenExpiryMs;
        if (refreshPayload.encryptedRefreshToken) {
            try {
                const refreshedGoogle = await refreshGoogleAccessToken(refreshPayload.encryptedRefreshToken);
                encryptedAccessToken = (0, crypto_2.encryptToken)(refreshedGoogle.accessToken);
                tokenExpiryMs = refreshedGoogle.expiryMs;
            }
            catch (err) {
                logger_1.logger.warn('Google token refresh during app session refresh failed', {
                    userId: refreshPayload.userId,
                    error: err.message,
                });
            }
        }
        const payload = {
            userId: refreshPayload.userId,
            email: refreshPayload.email || '',
            name: refreshPayload.name || '',
            picture: refreshPayload.picture || '',
            authProvider: 'google',
            encryptedAccessToken,
            encryptedRefreshToken: refreshPayload.encryptedRefreshToken,
            tokenExpiryMs,
        };
        sessionJwt = jsonwebtoken_1.default.sign(payload, config_1.config.jwt.secret, {
            expiresIn: config_1.config.jwt.expiresIn,
        });
    }
    const decoded = jsonwebtoken_1.default.decode(sessionJwt);
    const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 7200;
    return { accessToken: sessionJwt, expiresIn };
}
// ─── Auth Response Builder ────────────────────────────────────────────────────
/**
 * Build the AuthResponse sent to the client.
 * NOTE: No OAuth tokens included — only our app tokens.
 */
function buildAuthResponse(userInfo, tokens, customUserId, existingDbUser) {
    const userId = customUserId || userInfo.sub;
    const picture = existingDbUser?.picture || userInfo.picture || '';
    const userInfoWithId = {
        ...userInfo,
        sub: userId,
        picture,
    };
    const accessToken = createSessionJwt(userInfoWithId, tokens);
    const encryptedRefreshToken = tokens.refresh_token
        ? (0, crypto_2.encryptToken)(tokens.refresh_token)
        : undefined;
    const refreshToken = createRefreshJwt(userId, {
        email: userInfo.email,
        name: userInfo.name,
        picture,
        authProvider: 'google',
        encryptedRefreshToken,
    });
    // Calculate expiry in seconds
    const decoded = jsonwebtoken_1.default.decode(accessToken);
    const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 7200;
    const user = {
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
function buildEmailAuthResponse(user) {
    const accessToken = createEmailSessionJwt(user);
    const refreshToken = createRefreshJwt(user.userId, {
        email: user.email,
        name: user.name,
        picture: user.picture || '',
        authProvider: 'email',
    });
    const decoded = jsonwebtoken_1.default.decode(accessToken);
    const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
    const publicUser = {
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
async function createAuthenticatedClient(session) {
    if (session.authProvider !== 'google' || !session.encryptedAccessToken) {
        throw new Error('GMAIL_NOT_AVAILABLE: This account signed in with email, not Google, so Gmail sync is not available.');
    }
    const client = createOAuth2Client();
    let accessToken = (0, crypto_2.decryptToken)(session.encryptedAccessToken);
    let expiryMs = session.tokenExpiryMs;
    // Refresh if expired or expiring within 2 minutes
    const needsRefresh = !expiryMs || Date.now() >= expiryMs - 2 * 60 * 1000;
    if (needsRefresh && session.encryptedRefreshToken) {
        try {
            const refreshed = await refreshGoogleAccessToken(session.encryptedRefreshToken);
            accessToken = refreshed.accessToken;
            expiryMs = refreshed.expiryMs;
        }
        catch (err) {
            logger_1.logger.warn('Token refresh failed, proceeding with existing token', { error: err.message });
        }
    }
    client.setCredentials({
        access_token: accessToken,
        expiry_date: expiryMs,
    });
    return client;
}
//# sourceMappingURL=auth.service.js.map