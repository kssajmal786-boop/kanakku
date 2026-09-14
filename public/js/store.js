// ============================================================
// CashFlow State Store
// Simple reactive state management
// ============================================================

const _state = {
  // Auth
  isAuthenticated: false,
  user: null, // { name, email, age, phone, workType, photoUrl, gmailConnected }

  // Onboarding
  onboardingStep: 0, // 0=welcome,1=login,2=profile,3=language,4=gmail,5=done

  // App
  currentPage: 'dashboard',
  isLoading: false,

  // Data (populated by services)
  transactions: [],
  dashboardData: null,
  reports: [],
  statements: [],
  chatMessages: [],

  // UI
  fabOpen: false,
  activeFilters: { type: 'all', paymentMethod: 'all', category: 'all' },
  searchQuery: '',

  // Report
  reportTab: 'monthly',
  reportDateRange: { from: null, to: null },
};

const _listeners = {};

/**
 * Get a value from state
 */
export function getState(key) {
  return key ? _state[key] : { ..._state };
}

/**
 * Set state and notify subscribers
 */
export function setState(updates) {
  const changed = [];
  for (const [k, v] of Object.entries(updates)) {
    if (_state[k] !== v) { _state[k] = v; changed.push(k); }
  }
  changed.forEach(k => (_listeners[k] || []).forEach(fn => fn(_state[k])));
  (_listeners['*'] || []).forEach(fn => fn({ ..._state }));
}

/**
 * Subscribe to state key changes
 * @param {string} key  state key or '*' for any change
 * @param {Function} fn callback(newValue)
 * @returns {Function} unsubscribe
 */
export function subscribe(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
  return () => { _listeners[key] = _listeners[key].filter(f => f !== fn); };
}

/**
 * Reset to initial state (logout)
 */
export function resetState() {
  setState({
    isAuthenticated: false,
    user: null,
    onboardingStep: 0,
    currentPage: 'dashboard',
    transactions: [],
    dashboardData: null,
    reports: [],
    statements: [],
    chatMessages: [],
    fabOpen: false,
  });
}

// Persist user session
export function persistSession(user) {
  try { localStorage.setItem('cashflow_user', JSON.stringify(user)); } catch {}
}

export function loadSession() {
  try {
    const raw = localStorage.getItem('cashflow_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearSession() {
  localStorage.removeItem('cashflow_user');
}
