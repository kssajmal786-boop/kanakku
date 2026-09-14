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

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { config } from '../config';
import { db, GmailConnectionRecord } from '../db';
import { encryptToken, decryptToken } from '../utils/crypto';
import { logger } from '../utils/logger';
import type { OAuthTokens, GoogleUserInfo } from '../types/auth.types';

/** Minimum required scope — read-only, nothing else. */
export const GMAIL_CONNECT_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GmailConnectionStatus {
  connected: boolean;
  googleAccountEmail?: string;
  connectedAt?: string;
  updatedAt?: string;
}

function createOAuth2Client(): OAuth2Client {
  // Reuses the SAME registered redirect URI as login (see auth.service.ts) —
  // the shared /auth/callback route branches internally on purpose, so no
  // second "authorized redirect URI" needs to be registered in Google Cloud.
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/** Authorization URL for the "Connect Gmail" button.
 * Requests gmail.readonly (the actual permission we need) plus the
 * `email` scope so we can label the connection with which Google
 * account was granted — still far narrower than the login flow's
 * openid+email+profile+gmail.readonly bundle.
 */
export function generateGmailConnectAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [GMAIL_CONNECT_SCOPE, 'email'],
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
export async function completeGmailConnection(
  userId: string,
  tokens: OAuthTokens,
  googleAccountEmail: string
): Promise<GmailConnectionStatus> {
  if (!tokens.access_token) {
    throw new Error('TOKEN_EXCHANGE_FAILED: No access token returned by Google');
  }
  if (!tokens.refresh_token) {
    // Happens if the user previously granted consent and Google didn't
    // re-issue a refresh token. prompt:'consent' above should prevent
    // this in practice, but fail clearly rather than storing nothing.
    throw new Error('NO_REFRESH_TOKEN: Google did not return a refresh token. Please remove Kanakku from https://myaccount.google.com/permissions and try connecting again.');
  }

  const record = await db.upsertGmailConnection({
    userId,
    googleAccountEmail,
    encryptedRefreshToken: encryptToken(tokens.refresh_token),
    encryptedAccessToken: encryptToken(tokens.access_token),
    tokenExpiryMs: tokens.expiry_date ?? Date.now() + 3600 * 1000,
    scope: GMAIL_CONNECT_SCOPE,
  });

  logger.info('Gmail connection established', { userId, googleAccountEmail });

  return toStatus(record);
}

export async function getGmailConnectionStatus(userId: string): Promise<GmailConnectionStatus> {
  const record = await db.findGmailConnectionByUserId(userId);
  return record ? toStatus(record) : { connected: false };
}

function toStatus(record: GmailConnectionRecord): GmailConnectionStatus {
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
export async function getAuthenticatedClientForUser(userId: string): Promise<OAuth2Client> {
  const record = await db.findGmailConnectionByUserId(userId);
  if (!record) {
    const err = new Error('GMAIL_NOT_CONNECTED: This account has not connected Gmail yet.');
    (err as Error & { code: string }).code = 'GMAIL_NOT_CONNECTED';
    throw err;
  }

  const client = createOAuth2Client();
  let accessToken = record.encrypted_access_token ? decryptToken(record.encrypted_access_token) : null;
  let expiryMs = record.token_expiry_ms;

  const needsRefresh = !accessToken || !expiryMs || Date.now() >= expiryMs - 2 * 60 * 1000;

  if (needsRefresh) {
    try {
      const refreshToken = decryptToken(record.encrypted_refresh_token);
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('No access token returned on refresh');
      }

      accessToken = credentials.access_token;
      expiryMs = credentials.expiry_date ?? Date.now() + 3600 * 1000;

      await db.updateGmailAccessToken(userId, encryptToken(accessToken), expiryMs);
    } catch (err) {
      const message = (err as { message?: string })?.message || '';
      // invalid_grant is Google's signal that the refresh token was
      // revoked (user removed access via their Google account, or the
      // grant expired from inactivity).
      if (message.includes('invalid_grant')) {
        await db.deleteGmailConnection(userId);
        logger.warn('Gmail refresh token was revoked; connection removed', { userId });
        const revokedErr = new Error('GMAIL_ACCESS_REVOKED: Gmail access was revoked. Please reconnect.');
        (revokedErr as Error & { code: string }).code = 'GMAIL_ACCESS_REVOKED';
        throw revokedErr;
      }
      logger.error('Failed to refresh Gmail access token', { userId, error: message });
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
export async function disconnectGmail(userId: string): Promise<void> {
  const record = await db.findGmailConnectionByUserId(userId);
  if (record) {
    try {
      const client = createOAuth2Client();
      const refreshToken = decryptToken(record.encrypted_refresh_token);
      await client.revokeToken(refreshToken);
      logger.info('Gmail OAuth grant revoked with Google', { userId });
    } catch (err) {
      logger.warn('Could not revoke Gmail grant with Google (removing local connection anyway)', {
        userId,
        error: (err as Error).message,
      });
    }
  }
  await db.deleteGmailConnection(userId);
}

// Re-exported for the shared /auth/callback route to build a client
// directly from a fresh code exchange without a DB round-trip, if ever
// needed. Not currently used outside this module, kept for symmetry
// with auth.service.ts's exported OAuthTokens/GoogleUserInfo helpers.
export type { OAuthTokens, GoogleUserInfo };
