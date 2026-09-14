// ============================================================
// CashFlow Theme Service
// Centralized theme management for Light, Dark, and System modes
// Supports immediate application, user-scoped persistence, and
// automatic OS color scheme tracking.
// ============================================================

const DEFAULT_THEME = 'light';
let _mediaQueryListener = null;

/**
 * Storage key for theme preference: scoped per user when authenticated
 */
function getStorageKey(userId) {
  return userId ? `cashflow_theme_${userId}` : 'cashflow_theme';
}

/**
 * Get the user's saved theme preference ('light' | 'dark' | 'system')
 * @param {string|null} userId
 * @returns {'light'|'dark'|'system'}
 */
export function getSavedTheme(userId = null) {
  try {
    const key = getStorageKey(userId);
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
    // If authenticated user has no saved preference yet, default to light
    return DEFAULT_THEME;
  } catch (_) {
    return DEFAULT_THEME;
  }
}

/**
 * Determine effective visual theme ('light' or 'dark') given preference
 * @param {'light'|'dark'|'system'} theme
 * @returns {'light'|'dark'}
 */
export function resolveEffectiveTheme(theme) {
  if (theme === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return theme === 'dark' ? 'dark' : 'light';
}

/**
 * Apply a theme preference immediately to the application.
 * @param {'light'|'dark'|'system'} theme
 * @param {string|null} userId
 * @param {boolean} save
 */
export function applyTheme(theme = 'light', userId = null, save = true) {
  const validTheme = (theme === 'dark' || theme === 'system') ? theme : 'light';

  // 1. Persist if requested
  if (save) {
    try {
      const key = getStorageKey(userId);
      localStorage.setItem(key, validTheme);
    } catch (_) {}
  }

  // 2. Resolve effective theme
  const effectiveTheme = resolveEffectiveTheme(validTheme);

  // 3. Set attributes on document element
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.documentElement.setAttribute('data-theme-preference', validTheme);
    document.documentElement.style.colorScheme = effectiveTheme;

    // Update mobile status bar theme color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', effectiveTheme === 'dark' ? '#0b0f19' : '#f5f6f8');
    }
  }

  // 4. Update Chart.js global defaults if available
  if (typeof window !== 'undefined' && window.Chart) {
    window.Chart.defaults.color = effectiveTheme === 'dark' ? '#9ca3af' : '#667085';
    window.Chart.defaults.borderColor = effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(16, 21, 31, 0.06)';
  }

  // 5. Manage OS media query listener for 'system' theme
  if (typeof window !== 'undefined' && window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    // Remove existing listener if any
    if (_mediaQueryListener) {
      if (media.removeEventListener) {
        media.removeEventListener('change', _mediaQueryListener);
      } else if (media.removeListener) {
        media.removeListener(_mediaQueryListener);
      }
      _mediaQueryListener = null;
    }

    // Attach listener if system is selected
    if (validTheme === 'system') {
      _mediaQueryListener = () => {
        const newEffective = resolveEffectiveTheme('system');
        document.documentElement.setAttribute('data-theme', newEffective);
        document.documentElement.style.colorScheme = newEffective;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', newEffective === 'dark' ? '#0b0f19' : '#f5f6f8');
        if (window.Chart) {
          window.Chart.defaults.color = newEffective === 'dark' ? '#9ca3af' : '#667085';
          window.Chart.defaults.borderColor = newEffective === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(16, 21, 31, 0.06)';
        }
        window.dispatchEvent(new CustomEvent('cashflow:themechange', { detail: { theme: 'system', effectiveTheme: newEffective } }));
      };

      if (media.addEventListener) {
        media.addEventListener('change', _mediaQueryListener);
      } else if (media.addListener) {
        media.addListener(_mediaQueryListener);
      }
    }
  }

  // 6. Dispatch custom event for any listening views
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cashflow:themechange', { detail: { theme: validTheme, effectiveTheme } }));
  }

  return { theme: validTheme, effectiveTheme };
}

/**
 * Initialize theme for a given user ID (or default/guest)
 * @param {string|null} userId
 */
export function initTheme(userId = null) {
  const saved = getSavedTheme(userId);
  return applyTheme(saved, userId, false);
}

/**
 * Get current theme preference
 * @param {string|null} userId
 * @returns {'light'|'dark'|'system'}
 */
export function getCurrentTheme(userId = null) {
  return getSavedTheme(userId);
}

/**
 * Reset application theme to default light upon logout so next user starts fresh
 */
export function resetThemeOnLogout() {
  // Reset DOM to light mode
  return applyTheme('light', null, false);
}
