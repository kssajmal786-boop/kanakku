// ============================================================
// CashFlow i18n Engine
// Lightweight internationalization system
// ============================================================

import en from '../i18n/en.js';
import ta from '../i18n/ta.js';

const TRANSLATIONS = { en, ta };
const STORAGE_KEY  = 'cashflow_lang';

let _lang = localStorage.getItem(STORAGE_KEY) || 'en';
let _listeners = [];

// ── Core API ──────────────────────────────────────────────

/**
 * Get current language code
 */
export function getLang() { return _lang; }

/**
 * Set language and persist
 * @param {'en'|'ta'} lang
 */
export function setLang(lang) {
  if (!TRANSLATIONS[lang]) { console.warn(`[i18n] Unknown lang: ${lang}`); return; }
  _lang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  document.body.className = document.body.className.replace(/\blang-\w+\b/, '');
  document.body.classList.add(`lang-${lang}`);
  _listeners.forEach(fn => fn(lang));
  rerender();
}

/**
 * Subscribe to language changes
 */
export function onLangChange(fn) { _listeners.push(fn); }

/**
 * Translate a dot-notation key with optional interpolation
 * @param {string} key  e.g. 'nav.dashboard'
 * @param {Object} vars e.g. { name: 'Arun' }
 */
export function t(key, vars = {}) {
  const parts = key.split('.');
  let val = TRANSLATIONS[_lang];
  for (const p of parts) {
    if (val == null) break;
    val = val[p];
  }
  // Fallback to English
  if (val == null) {
    val = TRANSLATIONS['en'];
    for (const p of parts) {
      if (val == null) break;
      val = val[p];
    }
  }
  if (val == null) { console.warn(`[i18n] Missing key: ${key}`); return key; }
  if (typeof val !== 'string') return val; // Return raw (arrays, objects)
  // Interpolate {placeholder}
  return val.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/**
 * Translate all [data-i18n] elements in the DOM
 */
export function rerender() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (typeof val === 'string') {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = val;
      } else {
        el.textContent = val;
      }
    }
  });

  // data-i18n-attr="placeholder:key"
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const pairs = el.dataset.i18nAttr.split(',');
    pairs.forEach(pair => {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr.trim(), t(key.trim()));
    });
  });
}

// Initialize on load
export function initI18n() {
  document.documentElement.lang = _lang;
  document.body.classList.add(`lang-${_lang}`);
}
