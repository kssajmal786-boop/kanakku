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
import { OAuth2Client } from 'google-auth-library';
import type { OAuthTokens, GoogleUserInfo, SessionPayload, RefreshTokenPayload, AuthResponse } from '../types/auth.types';
/**
 * Generate a cryptographically random state parameter for CSRF protection.
 * Returns { state, signature } where signature = HMAC-SHA256(state, COOKIE_SECRET)
 */
export declare function generateOAuthState(): {
    state: string;
    signature: string;
};
/**
 * Verify the state parameter returned by Google matches what we sent.
 */
export declare function verifyOAuthState(state: string, signature: string): boolean;
export declare function generateAuthUrl(state: string): string;
export declare function exchangeCodeForTokens(code: string): Promise<OAuthTokens>;
export declare function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo>;
/**
 * Use a refresh token to get a new access token.
 * Called transparently when the Gmail service detects token expiry.
 */
export declare function refreshGoogleAccessToken(encryptedRefreshToken: string): Promise<{
    accessToken: string;
    expiryMs: number;
}>;
export declare function createSessionJwt(userInfo: GoogleUserInfo, tokens: OAuthTokens): string;
/**
 * Session JWT for email/password-authenticated users. No Google OAuth
 * tokens exist for these users, so Gmail auto-sync is simply
 * unavailable to them — everything else (manual entry, receipts,
 * reports, AI chat) works the same.
 */
export declare function createEmailSessionJwt(user: {
    userId: string;
    email: string;
    name: string;
    picture?: string | null;
}): string;
export declare function createRefreshJwt(userId: string, extra?: {
    email?: string;
    name?: string;
    picture?: string;
    authProvider?: 'google' | 'email';
    encryptedRefreshToken?: string;
}): string;
export declare function verifySessionJwt(token: string): SessionPayload;
export declare function verifyRefreshJwt(token: string): RefreshTokenPayload;
/**
 * Creates a new session access token (signed with JWT_SECRET)
 * using claims verified from a valid refresh token.
 */
export declare function createSessionJwtFromRefresh(refreshPayload: RefreshTokenPayload): Promise<{
    accessToken: string;
    expiresIn: number;
}>;
/**
 * Build the AuthResponse sent to the client.
 * NOTE: No OAuth tokens included — only our app tokens.
 */
export declare function buildAuthResponse(userInfo: GoogleUserInfo, tokens: OAuthTokens, customUserId?: string, existingDbUser?: {
    picture?: string | null;
    workType?: string | null;
    language?: string;
}): AuthResponse;
/**
 * Build the AuthResponse sent to the client for email/password sign-in.
 * Mirrors buildAuthResponse's shape so the frontend handles both
 * providers identically.
 */
export declare function buildEmailAuthResponse(user: {
    userId: string;
    email: string;
    name: string;
    picture?: string | null;
    workType?: string | null;
    language?: string;
}): AuthResponse;
/**
 * Create an authenticated OAuth2Client from a session payload.
 * Transparently refreshes the access token if it has expired.
 *
 * Only valid for Google-provider sessions. Email/password sessions
 * have no Gmail tokens at all — callers must check this before
 * offering any Gmail-dependent feature to an email-auth user.
 */
export declare function createAuthenticatedClient(session: SessionPayload): Promise<OAuth2Client>;
