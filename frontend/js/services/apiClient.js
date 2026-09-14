// ============================================================
// API Client — Authenticated HTTP calls to the backend
// ============================================================
// Manages JWT tokens (memory + sessionStorage) and handles
// automatic token refresh. Never stores refresh token in
// localStorage (only sessionStorage for security).
//
// The backend runs on: http://localhost:3001 (local) or same-origin (Vercel/production)
// ============================================================

const API_BASE = (function() {
  if (typeof window.CASHFLOW_API_BASE === 'string') {
    return window.CASHFLOW_API_BASE;
  }
  // Local development with separate dev servers
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (window.location.port === '3000') {
      return 'http://localhost:3001';
    }
  }
  // Production (Vercel serverless deployment or same-origin host)
  return '';
})();

let _accessToken = null;
let _accessTokenExpiry = 0; // Unix ms timestamp
let _refreshToken = null;

// ─── Token Management ──────────────────────────────────────────

export function setTokens({ accessToken, refreshToken, expiresIn }) {
  _accessToken = accessToken;
  _refreshToken = refreshToken;
  // expiresIn is in seconds; leave 60s buffer
  _accessTokenExpiry = Date.now() + (expiresIn - 60) * 1000;

  // Persist refresh token in sessionStorage (cleared on tab close)
  try {
    sessionStorage.setItem('cf_refresh_token', refreshToken);
    sessionStorage.setItem('cf_access_token', accessToken);
    sessionStorage.setItem('cf_token_expiry', String(_accessTokenExpiry));
  } catch (_) {}
}

export function loadStoredTokens() {
  try {
    const rt = sessionStorage.getItem('cf_refresh_token');
    const at = sessionStorage.getItem('cf_access_token');
    const exp = parseInt(sessionStorage.getItem('cf_token_expiry') || '0', 10);
    if (rt && at && exp > Date.now()) {
      _accessToken = at;
      _refreshToken = rt;
      _accessTokenExpiry = exp;
      return true;
    }
  } catch (_) {}
  return false;
}

export function clearTokens() {
  _accessToken = null;
  _refreshToken = null;
  _accessTokenExpiry = 0;
  try {
    sessionStorage.removeItem('cf_refresh_token');
    sessionStorage.removeItem('cf_access_token');
    sessionStorage.removeItem('cf_token_expiry');
  } catch (_) {}
}

export function isAuthenticated() {
  return !!_accessToken && _accessTokenExpiry > Date.now();
}

export function getAccessToken() {
  return _accessToken;
}

// ─── Token Refresh ─────────────────────────────────────────────

async function refreshAccessToken() {
  if (!_refreshToken) throw new Error('No refresh token available');

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ refreshToken: _refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('Token refresh failed — please log in again');
  }

  const data = await res.json();
  if (data.success && data.data?.accessToken) {
    _accessToken = data.data.accessToken;
    _accessTokenExpiry = Date.now() + (data.data.expiresIn - 60) * 1000;
    try {
      sessionStorage.setItem('cf_access_token', _accessToken);
      sessionStorage.setItem('cf_token_expiry', String(_accessTokenExpiry));
    } catch (_) {}
  }
}

// ─── Core request ──────────────────────────────────────────────

async function request(method, path, body = null, options = {}) {
  // Auto-refresh token if expiring
  if (_accessToken && _accessTokenExpiry > 0 && Date.now() >= _accessTokenExpiry - 30000) {
    try { await refreshAccessToken(); } catch (_) {}
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
  };

  if (_accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  }

  const fetchOptions = {
    method,
    headers,
    credentials: 'include',
    signal: options.signal,
  };

  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  const url = `${API_BASE}${path}`;

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }

  // Handle 401 — try refresh once
  if (res.status === 401 && _refreshToken && !options._retried) {
    try {
      await refreshAccessToken();
      return request(method, path, body, { ...options, _retried: true });
    } catch (_) {
      clearTokens();
      window.dispatchEvent(new CustomEvent('cashflow:auth-expired'));
      throw new Error('Session expired. Please log in again.');
    }
  }

  const data = await res.json().catch(() => ({ success: false, error: 'Invalid response' }));

  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }

  return data.data ?? data;
}

// ─── Public API ────────────────────────────────────────────────

export const api = {
  get: (path, options) => request('GET', path, null, options),
  post: (path, body, options) => request('POST', path, body, options),
  put: (path, body, options) => request('PUT', path, body, options),
  delete: (path, options) => request('DELETE', path, null, options),
};

// ─── Auth-specific calls ───────────────────────────────────────

/**
 * Initiate Google OAuth flow.
 * Returns { isConfigured, authUrl, state, offline, message }
 */
export async function initiateGoogleLogin() {
  try {
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        isConfigured: false,
        authUrl: null,
        offline: false,
        message: errData.error || errData.message || `Server returned error (${res.status})`,
      };
    }
    const data = await res.json();
    if (!data.success) {
      return {
        isConfigured: false,
        authUrl: null,
        offline: false,
        message: data.error || data.message || 'OAuth initiation failed',
      };
    }
    return data.data; // { isConfigured: boolean, authUrl: string | null, state?: string, message?: string }
  } catch (err) {
    // Backend is unreachable or offline
    return {
      isConfigured: false,
      authUrl: null,
      offline: true,
      message: `Backend server is unavailable${API_BASE ? ` at ${API_BASE}` : ''}. Please ensure the backend is running.`,
    };
  }
}

// ─── Gmail connection (independent of login provider) ───────────

/**
 * Initiates the "Connect Gmail" flow for the CURRENTLY LOGGED-IN user
 * (works whether they logged in via Google or email/password).
 * Returns { authUrl, state }. Caller should redirect to authUrl.
 */
export async function initiateGmailConnect() {
  return api.post('/auth/gmail/connect', {});
}

/**
 * Checks whether the current user has a persisted Gmail connection.
 * Returns { connected: boolean, googleAccountEmail?, connectedAt?, updatedAt? }
 */
export async function getGmailConnectionStatus() {
  return api.get('/gmail/connect/status');
}

/**
 * Disconnects Gmail: revokes the grant with Google and deletes the
 * stored credentials. Does not touch local financial transactions.
 */
export async function disconnectGmailConnection() {
  return api.post('/gmail/disconnect', {});
}

/**
 * Test/verification calls — fetch safe message metadata only.
 */
export async function fetchRecentGmailMessages(limit = 10) {
  return api.get(`/gmail/messages?limit=${encodeURIComponent(limit)}`);
}

export async function searchGmailMessages(query, limit = 10) {
  return api.get(`/gmail/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`);
}

/**
 * Exchange OAuth callback params for app tokens.
 * Called after Google redirects back to /auth/success.
 */
export function extractCallbackTokens() {
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('accessToken');
  const refreshToken = params.get('refreshToken');
  const expiresIn = parseInt(params.get('expiresIn') || '7200', 10);

  if (!accessToken || !refreshToken) return null;

  // Clean the URL (remove tokens from browser history)
  window.history.replaceState({}, document.title, '/');

  return { accessToken, refreshToken, expiresIn };
}

/**
 * Extract error message if Google OAuth callback redirected to /auth/error.
 */
export function extractCallbackError() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason') || params.get('error') || params.get('error_description');
  const isErrorPath = window.location.pathname.includes('/auth/error');

  if (!reason && !isErrorPath) return null;

  // Clean the URL
  window.history.replaceState({}, document.title, '/');

  return reason || 'Authentication could not be completed';
}

/**
 * Get the current user profile from the backend.
 */
export async function fetchUserProfile() {
  return api.get('/auth/me');
}

/**
 * Update current user profile in the backend database.
 */
export async function updateUserProfile(data) {
  return api.put('/auth/me', data);
}

/**
 * Get saved Gmail sync settings from backend database.
 */
export async function getGmailSyncSettings() {
  return api.get('/gmail/sync/settings');
}

/**
 * Persist Gmail sync settings to backend database.
 */
export async function saveGmailSyncSettings(settings) {
  return api.post('/gmail/sync/settings', settings);
}

// ─── Email/password auth ────────────────────────────────────────

/**
 * Register a new account with email + password.
 * Returns { accessToken, refreshToken, expiresIn, user } — same shape
 * as the Google OAuth flow, so callers can handle both identically.
 */
export async function registerWithEmail(name, email, password) {
  const res = await fetch(`${API_BASE}/auth/email/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error || 'Registration failed');
    err.code = data.code;
    throw err;
  }
  return data.data;
}

/**
 * Sign in with email + password.
 */
export async function loginWithEmail(email, password) {
  const res = await fetch(`${API_BASE}/auth/email/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error || 'Login failed');
    err.code = data.code;
    throw err;
  }
  return data.data;
}

/**
 * Log out — clears local tokens.
 */
export async function logout() {
  try {
    await api.post('/auth/logout', {});
  } catch (_) {}
  clearTokens();
}
