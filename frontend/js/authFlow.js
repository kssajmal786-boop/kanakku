// ============================================================
// Auth Flow — shared "what happens right after login" logic
// ============================================================
// Used by both the Google OAuth callback (app.js) and the email
// sign-in/register forms (onboarding.js), so both providers land the
// user in exactly the same place: main app if they already finished
// onboarding, or the profile-setup step if not.
//
// Lives in its own module (not app.js) specifically to avoid a
// circular import — onboarding.js needs this, and app.js imports
// onboarding.js.
// ============================================================

import { setState, persistSession } from './store.js';
import { setTokens, updateUserProfile } from './services/apiClient.js';
import { getDB, setCurrentUser } from './services/db.js';
import { initTheme } from './services/theme.js';
import { initCurrency } from './services/currency.js';

/**
 * @param {{accessToken, refreshToken, expiresIn, user: {userId, email, name, picture, workType, language}}} authResponse
 * @param {{gmailConnected: boolean}} opts
 * @returns {Promise<{goTo: 'main'|'onboarding-profile'}>}
 */
export async function completeAuth(authResponse, { gmailConnected }) {
  setTokens(authResponse);

  // CRITICAL: must happen before getDB() below, so this user's own
  // database is opened rather than reusing whatever database (if any)
  // was open for a previously logged-in user on this browser.
  setCurrentUser(authResponse.user.userId, authResponse.user.email);
  initTheme(authResponse.user.userId);
  initCurrency(authResponse.user.userId);

  const db = getDB();
  const storedProfile = await db.profile.get(authResponse.user.userId).catch(() => null);

  // Merge backend user profile and stored IndexedDB profile
  const photoURL = authResponse.user.picture || storedProfile?.photoURL || storedProfile?.picture || '';
  const workType = authResponse.user.workType || storedProfile?.workType || null;
  const language = authResponse.user.language || storedProfile?.language || 'en';
  const name = authResponse.user.name || storedProfile?.name || '';
  const email = authResponse.user.email || storedProfile?.email || '';

  const user = {
    userId: authResponse.user.userId,
    name,
    email,
    photoURL,
    picture: photoURL,
    workType,
    language,
    age: storedProfile?.age || null,
    phone: storedProfile?.phone || null,
    authProvider: authResponse.user.authProvider || (gmailConnected ? 'google' : 'email'),
    gmailConnected,
  };

  setState({ user, isAuthenticated: true });
  persistSession(user);

  // Ensure IndexedDB has the latest merged profile
  await db.profile.put({
    userId: user.userId,
    ...storedProfile,
    ...user,
  }).catch(() => {});

  // If local profile had photo or workType that backend lacked, sync to backend
  if ((photoURL && !authResponse.user.picture) || (workType && !authResponse.user.workType)) {
    updateUserProfile({ picture: photoURL, workType, name, language }).catch(() => {});
  }

  return { goTo: user.workType ? 'main' : 'onboarding-profile' };
}
