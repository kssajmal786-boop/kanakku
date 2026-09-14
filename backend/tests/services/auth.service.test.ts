import jwt from 'jsonwebtoken';
import {
  generateAuthUrl,
  generateOAuthState,
  verifyOAuthState,
  createSessionJwt,
  createEmailSessionJwt,
  createRefreshJwt,
  verifySessionJwt,
  verifyRefreshJwt,
  createSessionJwtFromRefresh,
  buildAuthResponse,
  buildEmailAuthResponse,
} from '../../src/services/auth.service';
import { config } from '../../src/config';
import type { GoogleUserInfo, OAuthTokens } from '../../src/types/auth.types';

describe('Auth Service - OAuth & JWT Security', () => {
  const mockUser: GoogleUserInfo = {
    sub: 'google_user_12345',
    email: 'testuser@gmail.com',
    name: 'Test User',
    picture: 'https://lh3.googleusercontent.com/a/default-user',
    email_verified: true,
  };

  const mockTokens: OAuthTokens = {
    access_token: 'google_access_token_abc123',
    refresh_token: 'google_refresh_token_xyz789',
    expiry_date: Date.now() + 3600 * 1000,
  };

  test('generateAuthUrl includes required parameters (client_id, redirect_uri, offline access, scopes, prompt consent)', () => {
    const { state } = generateOAuthState();
    const url = generateAuthUrl(state);

    expect(url).toContain('accounts.google.com');
    expect(url).toContain(encodeURIComponent(config.google.clientId) || config.google.clientId);
    expect(url).toContain(encodeURIComponent(config.google.redirectUri));
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('response_type=code');
    expect(url).toContain('gmail.readonly');
    expect(url).toContain(state);
  });

  test('generateOAuthState and verifyOAuthState handle CSRF state verification securely', () => {
    const { state, signature } = generateOAuthState();

    expect(verifyOAuthState(state, signature)).toBe(true);

    // Tampered state or signature fails
    expect(verifyOAuthState('tampered_state_value', signature)).toBe(false);
    expect(verifyOAuthState(state, 'tampered_signature_value')).toBe(false);
  });

  test('access token is signed with JWT_SECRET and verified with JWT_SECRET', () => {
    const sessionToken = createSessionJwt(mockUser, mockTokens);
    const decoded = verifySessionJwt(sessionToken);

    expect(decoded.userId).toBe(mockUser.sub);
    expect(decoded.email).toBe(mockUser.email);
    expect(decoded.authProvider).toBe('google');
    expect(decoded.encryptedAccessToken).toBeDefined();

    // Verifying access token with refresh secret MUST fail
    expect(() => {
      jwt.verify(sessionToken, config.jwt.refreshSecret);
    }).toThrow();
  });

  test('refresh token is signed with JWT_REFRESH_SECRET and verified with JWT_REFRESH_SECRET', () => {
    const refreshToken = createRefreshJwt(mockUser.sub, {
      email: mockUser.email,
      name: mockUser.name,
      authProvider: 'google',
    });
    const decoded = verifyRefreshJwt(refreshToken);

    expect(decoded.userId).toBe(mockUser.sub);
    expect(decoded.email).toBe(mockUser.email);
    expect(decoded.authProvider).toBe('google');

    // Verifying refresh token with access secret MUST fail
    expect(() => {
      jwt.verify(refreshToken, config.jwt.secret);
    }).toThrow();
  });

  test('createSessionJwtFromRefresh produces a valid session access token signed with JWT_SECRET', async () => {
    const refreshPayload = {
      userId: mockUser.sub,
      tokenVersion: 1,
      email: mockUser.email,
      name: mockUser.name,
      picture: mockUser.picture,
      authProvider: 'google' as const,
    };

    const { accessToken, expiresIn } = await createSessionJwtFromRefresh(refreshPayload);

    expect(expiresIn).toBeGreaterThan(0);
    const verified = verifySessionJwt(accessToken);
    expect(verified.userId).toBe(mockUser.sub);
    expect(verified.email).toBe(mockUser.email);
    expect(verified.authProvider).toBe('google');
  });

  test('buildAuthResponse does not expose raw OAuth tokens in response payload', () => {
    const authRes = buildAuthResponse(mockUser, mockTokens);

    expect(authRes.accessToken).toBeDefined();
    expect(authRes.refreshToken).toBeDefined();
    expect(authRes.user.userId).toBe(mockUser.sub);
    expect(authRes.user.email).toBe(mockUser.email);

    const stringified = JSON.stringify(authRes);
    expect(stringified).not.toContain(mockTokens.access_token);
    expect(stringified).not.toContain(mockTokens.refresh_token!);
  });

  test('buildEmailAuthResponse creates valid tokens for email user', () => {
    const emailUser = {
      userId: 'email_user_456',
      email: 'alex@example.com',
      name: 'Alex Rivera',
    };

    const authRes = buildEmailAuthResponse(emailUser);
    expect(authRes.accessToken).toBeDefined();
    expect(authRes.refreshToken).toBeDefined();
    expect(authRes.user.userId).toBe(emailUser.userId);

    const sessionPayload = verifySessionJwt(authRes.accessToken);
    expect(sessionPayload.authProvider).toBe('email');
  });
});
