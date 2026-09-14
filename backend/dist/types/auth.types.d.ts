/**
 * Authentication & User Types
 */
export interface GoogleUserInfo {
    sub: string;
    email: string;
    name: string;
    picture: string;
    email_verified: boolean;
    locale?: string;
}
export interface OAuthTokens {
    access_token: string;
    refresh_token?: string | null;
    expiry_date?: number | null;
    token_type?: string;
    scope?: string;
    id_token?: string;
}
/**
 * Session token payload (stored in JWT – NO financial data)
 *
 * `authProvider` distinguishes Google-OAuth sessions (which carry
 * encrypted Gmail tokens for the readonly Gmail integration) from
 * email/password sessions (which don't — those users simply won't
 * have Gmail auto-sync available, and can still use manual entry
 * and receipt upload).
 */
export interface SessionPayload {
    userId: string;
    email: string;
    name: string;
    picture: string;
    authProvider: 'google' | 'email';
    /** Encrypted OAuth access token – only present for Google sessions */
    encryptedAccessToken?: string;
    /** Encrypted OAuth refresh token – only present for Google sessions */
    encryptedRefreshToken?: string;
    /** Token expiry epoch ms – only present for Google sessions */
    tokenExpiryMs?: number;
    iat?: number;
    exp?: number;
}
export interface RefreshTokenPayload {
    userId: string;
    tokenVersion: number;
    email?: string;
    name?: string;
    picture?: string;
    authProvider?: 'google' | 'email';
    encryptedRefreshToken?: string;
    iat?: number;
    exp?: number;
}
/**
 * What the API returns to the client after authentication
 * NO OAuth tokens exposed here.
 */
export interface AuthResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: PublicUserProfile;
}
export interface PublicUserProfile {
    userId: string;
    email: string;
    name: string;
    picture: string;
    workType?: string;
    language?: string;
}
export interface TokenRefreshRequest {
    refreshToken: string;
}
export interface TokenRefreshResponse {
    accessToken: string;
    expiresIn: number;
}
