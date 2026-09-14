"use strict";
/**
 * Gmail Connection Service
 * ─────────────────────────────────────────────────────────────────────────
 * Manages a PERSISTED Gmail OAuth connection, one per Kanakku user,
 * stored in the `gmail_connections` DB table (see db/index.ts).
 *
 * This is deliberately separate from the existing login-time OAuth
 * flow in auth.service.ts (which embeds encrypted tokens in the JWT
 * and only lasts as long as that session). A persisted connection:
 *   • survives logout/login and JWT expiry
 *   • works for BOTH Google-login and email/password-login users
 *   • can be explicitly disconnected, independent of the login session
 *
 * Security (unchanged from the rest of the app):
 *   • Reuses the existing AES-256-GCM token encryption (utils/crypto.ts)
 *   • Refresh/access tokens are NEVER returned to the frontend
 *   • Refresh/access tokens are NEVER logged
 * ─────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GMAIL_CONNECT_SCOPE = void 0;
exports.generateGmailConnectAuthUrl = generateGmailConnectAuthUrl;
exports.completeGmailConnection = completeGmailConnection;
exports.getGmailConnectionStatus = getGmailConnectionStatus;
exports.getAuthenticatedClientForUser = getAuthenticatedClientForUser;
exports.disconnectGmail = disconnectGmail;
const googleapis_1 = require("googleapis");
const config_1 = require("../config");
const db_1 = require("../db");
const crypto_1 = require("../utils/crypto");
const logger_1 = require("../utils/logger");
/** Minimum required scope — read-only, nothing else. */
exports.GMAIL_CONNECT_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
function createOAuth2Client() {
    // Reuses the SAME registered redirect URI as login (see auth.service.ts) —
    // the shared /auth/callback route branches internally on purpose, so no
    // second "authorized redirect URI" needs to be registered in Google Cloud.
    return new googleapis_1.google.auth.OAuth2(config_1.config.google.clientId, config_1.config.google.clientSecret, config_1.config.google.redirectUri);
}
/** Authorization URL for the "Connect Gmail" button.
 * Requests gmail.readonly (the actual permission we need) plus the
 * `email` scope so we can label the connection with which Google
 * account was granted — still far narrower than the login flow's
 * openid+email+profile+gmail.readonly bundle.
 */
function generateGmailConnectAuthUrl(state) {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
        access_type: 'offline',
        scope: [exports.GMAIL_CONNECT_SCOPE, 'email'],
        state,
        prompt: 'consent', // always show consent so we reliably get a refresh_token
        include_granted_scopes: false,
    });
}
/**
 * Persists an already-exchanged Gmail OAuth grant for a Kanakku user.
 *
 * IMPORTANT: this does NOT exchange the authorization code itself —
 * that happens exactly once, in the shared /auth/callback route
 * (auth.routes.ts), which branches between "login" and "connect"
 * purposes. Authorization codes are single-use, so the exchange must
 * happen in exactly one place regardless of which purpose triggered it.
 */
async function completeGmailConnection(userId, tokens, googleAccountEmail) {
    if (!tokens.access_token) {
        throw new Error('TOKEN_EXCHANGE_FAILED: No access token returned by Google');
    }
    if (!tokens.refresh_token) {
        // Happens if the user previously granted consent and Google didn't
        // re-issue a refresh token. prompt:'consent' above should prevent
        // this in practice, but fail clearly rather than storing nothing.
        throw new Error('NO_REFRESH_TOKEN: Google did not return a refresh token. Please remove Kanakku from https://myaccount.google.com/permissions and try connecting again.');
    }
    const record = await db_1.db.upsertGmailConnection({
        userId,
        googleAccountEmail,
        encryptedRefreshToken: (0, crypto_1.encryptToken)(tokens.refresh_token),
        encryptedAccessToken: (0, crypto_1.encryptToken)(tokens.access_token),
        tokenExpiryMs: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        scope: exports.GMAIL_CONNECT_SCOPE,
    });
    logger_1.logger.info('Gmail connection established', { userId, googleAccountEmail });
    return toStatus(record);
}
async function getGmailConnectionStatus(userId) {
    const record = await db_1.db.findGmailConnectionByUserId(userId);
    return record ? toStatus(record) : { connected: false };
}
function toStatus(record) {
    return {
        connected: true,
        googleAccountEmail: record.google_account_email,
        connectedAt: record.connected_at,
        updatedAt: record.updated_at,
    };
}
/**
 * Builds an authenticated OAuth2Client from the persisted connection,
 * transparently refreshing the access token if it's expired or about
 * to expire, and persisting the refreshed token back to the DB.
 *
 * Throws a clearly-coded error if Gmail isn't connected, or if the
 * stored refresh token has been revoked by the user on Google's side.
 */
async function getAuthenticatedClientForUser(userId) {
    const record = await db_1.db.findGmailConnectionByUserId(userId);
    if (!record) {
        const err = new Error('GMAIL_NOT_CONNECTED: This account has not connected Gmail yet.');
        err.code = 'GMAIL_NOT_CONNECTED';
        throw err;
    }
    const client = createOAuth2Client();
    let accessToken = record.encrypted_access_token ? (0, crypto_1.decryptToken)(record.encrypted_access_token) : null;
    let expiryMs = record.token_expiry_ms;
    const needsRefresh = !accessToken || !expiryMs || Date.now() >= expiryMs - 2 * 60 * 1000;
    if (needsRefresh) {
        try {
            const refreshToken = (0, crypto_1.decryptToken)(record.encrypted_refresh_token);
            client.setCredentials({ refresh_token: refreshToken });
            const { credentials } = await client.refreshAccessToken();
            if (!credentials.access_token) {
                throw new Error('No access token returned on refresh');
            }
            accessToken = credentials.access_token;
            expiryMs = credentials.expiry_date ?? Date.now() + 3600 * 1000;
            await db_1.db.updateGmailAccessToken(userId, (0, crypto_1.encryptToken)(accessToken), expiryMs);
        }
        catch (err) {
            const message = err?.message || '';
            // invalid_grant is Google's signal that the refresh token was
            // revoked (user removed access via their Google account, or the
            // grant expired from inactivity).
            if (message.includes('invalid_grant')) {
                await db_1.db.deleteGmailConnection(userId);
                logger_1.logger.warn('Gmail refresh token was revoked; connection removed', { userId });
                const revokedErr = new Error('GMAIL_ACCESS_REVOKED: Gmail access was revoked. Please reconnect.');
                revokedErr.code = 'GMAIL_ACCESS_REVOKED';
                throw revokedErr;
            }
            logger_1.logger.error('Failed to refresh Gmail access token', { userId, error: message });
            throw err;
        }
    }
    client.setCredentials({ access_token: accessToken, expiry_date: expiryMs });
    return client;
}
/**
 * Disconnects Gmail: best-effort revokes the grant with Google, then
 * always deletes the local record regardless of whether the revoke
 * call succeeded (so the app never gets stuck in a "disconnected
 * locally but Google thinks it's still connected" limbo — the user
 * can always revoke manually at myaccount.google.com/permissions too).
 */
async function disconnectGmail(userId) {
    const record = await db_1.db.findGmailConnectionByUserId(userId);
    if (record) {
        try {
            const client = createOAuth2Client();
            const refreshToken = (0, crypto_1.decryptToken)(record.encrypted_refresh_token);
            await client.revokeToken(refreshToken);
            logger_1.logger.info('Gmail OAuth grant revoked with Google', { userId });
        }
        catch (err) {
            logger_1.logger.warn('Could not revoke Gmail grant with Google (removing local connection anyway)', {
                userId,
                error: err.message,
            });
        }
    }
    await db_1.db.deleteGmailConnection(userId);
}
//# sourceMappingURL=gmailConnection.service.js.map