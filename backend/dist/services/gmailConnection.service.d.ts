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
import { OAuth2Client } from 'google-auth-library';
import type { OAuthTokens, GoogleUserInfo } from '../types/auth.types';
/** Minimum required scope — read-only, nothing else. */
export declare const GMAIL_CONNECT_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export interface GmailConnectionStatus {
    connected: boolean;
    googleAccountEmail?: string;
    connectedAt?: string;
    updatedAt?: string;
}
/** Authorization URL for the "Connect Gmail" button.
 * Requests gmail.readonly (the actual permission we need) plus the
 * `email` scope so we can label the connection with which Google
 * account was granted — still far narrower than the login flow's
 * openid+email+profile+gmail.readonly bundle.
 */
export declare function generateGmailConnectAuthUrl(state: string): string;
/**
 * Persists an already-exchanged Gmail OAuth grant for a Kanakku user.
 *
 * IMPORTANT: this does NOT exchange the authorization code itself —
 * that happens exactly once, in the shared /auth/callback route
 * (auth.routes.ts), which branches between "login" and "connect"
 * purposes. Authorization codes are single-use, so the exchange must
 * happen in exactly one place regardless of which purpose triggered it.
 */
export declare function completeGmailConnection(userId: string, tokens: OAuthTokens, googleAccountEmail: string): Promise<GmailConnectionStatus>;
export declare function getGmailConnectionStatus(userId: string): Promise<GmailConnectionStatus>;
/**
 * Builds an authenticated OAuth2Client from the persisted connection,
 * transparently refreshing the access token if it's expired or about
 * to expire, and persisting the refreshed token back to the DB.
 *
 * Throws a clearly-coded error if Gmail isn't connected, or if the
 * stored refresh token has been revoked by the user on Google's side.
 */
export declare function getAuthenticatedClientForUser(userId: string): Promise<OAuth2Client>;
/**
 * Disconnects Gmail: best-effort revokes the grant with Google, then
 * always deletes the local record regardless of whether the revoke
 * call succeeded (so the app never gets stuck in a "disconnected
 * locally but Google thinks it's still connected" limbo — the user
 * can always revoke manually at myaccount.google.com/permissions too).
 */
export declare function disconnectGmail(userId: string): Promise<void>;
export type { OAuthTokens, GoogleUserInfo };
