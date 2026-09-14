// ============================================================
// CashFlow Currency Service
// Centralized currency configuration, user-scoped persistence,
// and standardized financial number formatting.
// ============================================================

export const CURRENCIES = [
  { code: 'INR', symbol: '₹',   name: 'Indian Rupee',     locale: 'en-IN' },
  { code: 'USD', symbol: '$',   name: 'US Dollar',        locale: 'en-US' },
  { code: 'EUR', symbol: '€',   name: 'Euro',             locale: 'en-US' },
  { code: 'GBP', symbol: '£',   name: 'British Pound',    locale: 'en-GB' },
  { code: 'JPY', symbol: '¥',   name: 'Japanese Yen',     locale: 'ja-JP' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham',       locale: 'en-AE' },
  { code: 'SGD', symbol: 'S$',  name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'CAD', symbol: 'C$',  name: 'Canadian Dollar',  locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$',  name: 'Australian Dollar', locale: 'en-AU' },
];

export const DEFAULT_CURRENCY = 'INR';

let _activeCurrencyCode = DEFAULT_CURRENCY;

/**
 * Storage key for currency preference: scoped per user when authenticated
 */
function getStorageKey(userId) {
  return userId ? `cashflow_currency_${userId}` : 'cashflow_currency';
}

/**
 * Find currency config by code (case-insensitive)
 * @param {string} code
 * @returns {typeof CURRENCIES[0]}
 */
export function getCurrencyConfig(code) {
  if (!code) return CURRENCIES[0];
  const upper = String(code).toUpperCase().trim();
  return CURRENCIES.find(c => c.code === upper) || CURRENCIES[0];
}

/**
 * Get user's saved currency code
 * @param {string|null} userId
 * @returns {string}
 */
export function getSavedCurrency(userId = null) {
  try {
    const key = getStorageKey(userId);
    const saved = localStorage.getItem(key);
    if (saved && CURRENCIES.some(c => c.code === saved.toUpperCase())) {
      return saved.toUpperCase();
    }
    return DEFAULT_CURRENCY;
  } catch (_) {
    return DEFAULT_CURRENCY;
  }
}

/**
 * Get current active currency configuration object
 * @param {string|null} userId
 * @returns {{code: string, symbol: string, name: string, locale: string}}
 */
export function getCurrentCurrency(userId = null) {
  const code = userId ? getSavedCurrency(userId) : _activeCurrencyCode;
  return getCurrencyConfig(code);
}

/**
 * Get current active currency symbol (e.g. '₹', '$', '€')
 * @param {string|null} userId
 * @returns {string}
 */
export function getCurrencySymbol(userId = null) {
  return getCurrentCurrency(userId).symbol;
}

/**
 * Set and persist active currency
 * @param {string} code
 * @param {string|null} userId
 * @param {boolean} save
 * @returns {{code: string, symbol: string, name: string, locale: string}}
 */
export function setCurrency(code, userId = null, save = true) {
  const config = getCurrencyConfig(code);
  _activeCurrencyCode = config.code;

  if (save) {
    try {
      const key = getStorageKey(userId);
      localStorage.setItem(key, config.code);
    } catch (_) {}
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cashflow:currencychange', {
      detail: { currency: config }
    }));
  }

  return config;
}

/**
 * Initialize currency for a given user ID (or default/guest)
 * @param {string|null} userId
 */
export function initCurrency(userId = null) {
  const saved = getSavedCurrency(userId);
  return setCurrency(saved, userId, false);
}

/**
 * Reset active session currency to default upon logout
 */
export function resetCurrencyOnLogout() {
  _activeCurrencyCode = DEFAULT_CURRENCY;
  return setCurrency(DEFAULT_CURRENCY, null, false);
}

/**
 * Centralized financial amount formatter.
 * Formats a numerical value using the active currency symbol and consistent financial notation.
 *
 * Examples:
 *   formatCurrency(1250)              => "₹1,250.00"
 *   formatCurrency(1250, {sign: '+'}) => "+₹1,250.00"
 *   formatCurrency(1250, {sign: '-'}) => "-₹1,250.00"
 *   formatCurrency(-1250)             => "-₹1,250.00"
 *   formatCurrency(1000, {compact:true}) => "₹1k"
 *
 * @param {number|string} amount
 * @param {Object} [options]
 * @param {boolean} [options.symbol=true]  Include currency symbol
 * @param {'+'|'-'|'auto'|boolean} [options.sign] Prefix sign behavior
 * @param {number} [options.decimals]      Fraction digits (defaults to 2, or 0 for JPY)
 * @param {boolean} [options.compact=false] Compact format for chart axes ($1k)
 * @param {string|null} [options.userId]    Optional scoped userId
 * @returns {string}
 */
export function formatCurrency(amount, options = {}) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  const curr = getCurrentCurrency(options.userId);
  const includeSymbol = options.symbol !== false;
  const symbol = curr.symbol;

  // Handle compact notation (e.g. for charts)
  if (options.compact) {
    const absVal = Math.abs(num);
    const signPrefix = num < 0 ? '-' : (options.sign === '+' ? '+' : '');
    const formattedCompact = absVal >= 10000000 && curr.code === 'INR'
      ? `${(absVal / 10000000).toFixed(1)}Cr`
      : absVal >= 100000 && curr.code === 'INR'
      ? `${(absVal / 100000).toFixed(0)}L`
      : absVal >= 1000
      ? `${(absVal / 1000).toFixed(0)}k`
      : absVal.toFixed(0);

    return includeSymbol ? `${signPrefix}${symbol}${formattedCompact}` : `${signPrefix}${formattedCompact}`;
  }

  // Determine decimal fraction digits
  const defaultDecimals = curr.code === 'JPY' ? 0 : 2;
  const fractionDigits = options.decimals !== undefined ? options.decimals : defaultDecimals;

  // Format the absolute number
  const absNum = Math.abs(num);
  const formattedNumber = absNum.toLocaleString(curr.locale || 'en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  // Determine sign prefix
  let signPrefix = '';
  if (options.sign === '+') {
    signPrefix = '+';
  } else if (options.sign === '-') {
    signPrefix = '-';
  } else if (options.sign === 'auto') {
    signPrefix = num < 0 ? '-' : (num > 0 ? '+' : '');
  } else if (num < 0) {
    signPrefix = '-';
  }

  return includeSymbol
    ? `${signPrefix}${symbol}${formattedNumber}`
    : `${signPrefix}${formattedNumber}`;
}
