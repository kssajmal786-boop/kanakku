// ============================================================
// Settings Page — ChatGPT-Style Clean Categorization with Kanakku Identity
// Profile, Appearance, Finance, Gmail Sync, AI Assistant, Account & Data
// ============================================================

import { t, getLang, setLang } from '../i18n.js';
import { getState, setState, resetState, clearSession, persistSession } from '../store.js';
import { getDB, setCurrentUser } from '../services/db.js';
import { initiateGmailConnect, getGmailConnectionStatus, disconnectGmailConnection, updateUserProfile } from '../services/apiClient.js';
import { getSavedTheme, applyTheme, resetThemeOnLogout } from '../services/theme.js';
import { CURRENCIES, getCurrentCurrency, setCurrency, resetCurrencyOnLogout } from '../services/currency.js';

const THEME_ICONS = { light: '☀️', dark: '🌙', system: '💻' };
const THEME_DESCS = {
  light: 'Clean light aesthetic with crisp typography and high contrast',
  dark: 'Dark console optimized for low-light environments',
  system: 'Automatically matches your device operating system theme',
};

let _activeSettingsCategory = 'profile';

export function renderSettings(container) {
  const user = getState('user') || {};
  const lang = getLang();
  const currentTheme = getSavedTheme(user.userId);
  const currentCurrency = getCurrentCurrency(user.userId);
  const isGoogle = user.authProvider === 'google' || user.gmailConnected;

  const categories = [
    { id: 'profile',    icon: '👤', label: 'Profile' },
    { id: 'appearance', icon: '🎨', label: 'Appearance' },
    { id: 'finance',    icon: '💳', label: 'Finance' },
    { id: 'gmail',      icon: '📧', label: 'Gmail Sync' },
    { id: 'ai',         icon: '🤖', label: 'AI Assistant' },
    { id: 'account',    icon: '⚙️', label: 'Account & Data' },
  ];

  container.innerHTML = `
    <style>
      .pfp-wrapper {
        position: relative;
        cursor: pointer;
        outline: none;
        display: inline-block;
      }
      .pfp-avatar-circle {
        width: 84px;
        height: 84px;
        border-radius: 50%;
        overflow: hidden;
        background: var(--gradient-brand);
        box-shadow: var(--shadow-brand);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        border: 3px solid var(--color-border);
        font-size: 2rem;
        color: white;
        font-weight: var(--weight-bold);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .pfp-wrapper:hover .pfp-avatar-circle,
      .pfp-wrapper:focus-visible .pfp-avatar-circle {
        transform: scale(1.04);
        box-shadow: 0 0 0 4px rgba(14, 124, 123, 0.3), var(--shadow-brand);
      }
      .pfp-badge {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--color-brand-primary, #0e7c7b);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--color-bg-card, #ffffff);
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        pointer-events: none;
        transition: transform 0.2s ease;
      }
      .pfp-wrapper:hover .pfp-badge {
        transform: scale(1.1);
      }
    </style>

    <div class="settings-shell">
      <!-- Left Category Navigation -->
      <nav class="settings-nav-sidebar" aria-label="Settings categories">
        <div style="padding:4px 8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);">
          Settings
        </div>
        ${categories.map(cat => `
          <button class="settings-nav-item ${cat.id === _activeSettingsCategory ? 'active' : ''}" data-cat="${cat.id}">
            <span style="font-size:15px;">${cat.icon}</span>
            <span>${cat.label}</span>
          </button>
        `).join('')}
      </nav>

      <!-- Right Category Content Panel -->
      <div class="settings-content-panel" id="settings-content-panel">
        ${renderCategoryContent(_activeSettingsCategory, user, lang, currentTheme, currentCurrency, isGoogle)}
      </div>
    </div>
  `;

  setupSettingsHandlers(container, user);
  if (_activeSettingsCategory === 'gmail') {
    loadGmailConnectionSection(container);
  }
}

// ─── Category Content Renderer ────────────────────────────────

function renderCategoryContent(cat, user, lang, currentTheme, currentCurrency, isGoogle) {
  switch (cat) {
    case 'profile':
      return renderProfileCategory(user, isGoogle);
    case 'appearance':
      return renderAppearanceCategory(currentTheme, lang);
    case 'finance':
      return renderFinanceCategory(currentCurrency);
    case 'gmail':
      return renderGmailCategory();
    case 'ai':
      return renderAICategory();
    case 'account':
      return renderAccountCategory();
    default:
      return renderProfileCategory(user, isGoogle);
  }
}

// ─── 1. Profile Category ──────────────────────────────────────

function renderProfileCategory(user, isGoogle) {
  const avatarSrc = user.photoURL || user.picture;

  return `
    <div class="animate-fade-in-up">
      <div style="margin-bottom:var(--space-5);">
        <h2 style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);">Profile</h2>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">
          Manage your personal identity, avatar, and profession preferences
        </p>
      </div>

      <!-- Centered Modern Profile Card -->
      <div class="console-card" style="padding:var(--space-6);display:flex;flex-direction:column;align-items:center;text-align:center;gap:var(--space-3);border-radius:var(--radius-2xl);">
        <div class="pfp-wrapper" id="pfp-upload-trigger" title="Click to change profile picture" role="button" tabindex="0" aria-label="Upload profile photo">
          <div class="avatar pfp-avatar-circle">
            ${avatarSrc ? `
              <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(user.name || 'User')}" style="width:100%;height:100%;object-fit:cover;display:block;" />
            ` : `
              <span>${user.name ? escapeHtml(user.name.charAt(0).toUpperCase()) : '?'}</span>
            `}
          </div>
          <div class="pfp-badge" title="Change Photo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <input type="file" id="pfp-file-input" accept="image/*" style="display:none;" />
        </div>

        <div>
          <div style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);">
            ${escapeHtml(user.name || 'Account Holder')}
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">
            ${escapeHtml(user.email || 'local-ledger@kanakku.app')}
          </div>
          <div style="display:flex;align-items:center;justify-content:center;gap:var(--space-2);margin-top:var(--space-3);flex-wrap:wrap;">
            <span class="badge ${isGoogle ? 'badge-info' : 'badge-neutral'}" style="font-size:10.5px;">
              ${isGoogle ? '🌐 Google Account' : '✉️ Email Account'}
            </span>
            <span class="badge badge-neutral" style="font-size:10.5px;">
              ${t(`onboarding.workTypes.${user.workType || 'other'}`)}
            </span>
          </div>
        </div>

        <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2);flex-wrap:wrap;justify-content:center;">
          <button class="btn btn-secondary btn-sm" id="btn-change-pfp-action" style="font-size:12px;padding:6px 14px;border-radius:var(--radius-lg);">
            📷 Change Profile Picture
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-edit-profile" style="font-size:12px;padding:6px 14px;border-radius:var(--radius-lg);">
            ✏️ Edit Profile Details
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── 2. Appearance Category ───────────────────────────────────

function renderAppearanceCategory(currentTheme, lang) {
  return `
    <div class="animate-fade-in-up">
      <div style="margin-bottom:var(--space-5);">
        <h2 style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);">Appearance</h2>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">
          Customize the visual theme and application language
        </p>
      </div>

      <div class="settings-group">
        <!-- Theme Switcher -->
        <div class="settings-item" id="set-theme" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" id="theme-icon" style="background:rgba(217,119,6,0.1);color:var(--color-brand-accent);">
              ${THEME_ICONS[currentTheme] || '☀️'}
            </div>
            <div>
              <div class="settings-label" data-i18n="settings.theme">Theme</div>
              <div class="settings-desc" id="theme-desc">${THEME_DESCS[currentTheme] || THEME_DESCS.light}</div>
            </div>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;" role="group" aria-label="Theme selector">
            <button class="chip ${currentTheme === 'light' ? 'active' : ''}" data-settheme="light">Light</button>
            <button class="chip ${currentTheme === 'dark' ? 'active' : ''}" data-settheme="dark">Dark</button>
            <button class="chip ${currentTheme === 'system' ? 'active' : ''}" data-settheme="system">System</button>
          </div>
        </div>

        <!-- Language Switcher -->
        <div class="settings-item" id="set-language" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(14,124,123,0.1);color:var(--color-flow);">🌐</div>
            <div>
              <div class="settings-label" data-i18n="settings.language">Language</div>
              <div class="settings-desc">${lang === 'ta' ? 'தமிழ் (Tamil)' : 'English (India)'}</div>
            </div>
          </div>
          <div style="display:flex;gap:var(--space-2);">
            <button class="chip ${lang === 'en' ? 'active' : ''}" data-setlang="en">EN</button>
            <button class="chip ${lang === 'ta' ? 'active' : ''}" data-setlang="ta">தமிழ்</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── 3. Finance Category ──────────────────────────────────────

function renderFinanceCategory(currentCurrency) {
  return `
    <div class="animate-fade-in-up">
      <div style="margin-bottom:var(--space-5);">
        <h2 style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);">Finance</h2>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">
          Configure internal ledger currency and transaction preferences
        </p>
      </div>

      <div class="settings-group">
        <!-- Currency Selection -->
        <div class="settings-item" id="set-currency" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" id="currency-icon" style="background:rgba(14,124,123,0.1);color:var(--color-flow);font-weight:700;font-size:1.15rem;">
              ${currentCurrency.symbol}
            </div>
            <div>
              <div class="settings-label" data-i18n="settings.currency">Currency</div>
              <div class="settings-desc" id="currency-desc">Used to display balances, transactions, and reports across Kanakku.</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <select id="currency-select" class="form-select" style="min-width:180px;font-size:var(--text-xs);font-weight:var(--weight-semibold);background:var(--color-bg-elevated);border-radius:var(--radius-lg);padding:var(--space-2) var(--space-6) var(--space-2) var(--space-3);cursor:pointer;" aria-label="Select currency">
              ${CURRENCIES.map(c => `
                <option value="${c.code}" ${c.code === currentCurrency.code ? 'selected' : ''}>
                  ${c.code} — ${c.symbol} ${c.name}
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- Notifications -->
        <div class="settings-item" id="set-notif" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(67,56,202,0.1);color:var(--color-intel);">🔔</div>
            <div>
              <div class="settings-label" data-i18n="settings.notifications">Notifications</div>
              <div class="settings-desc" data-i18n="settings.notifDesc">Alerts for high-value UPI expenses and daily summaries</div>
            </div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="toggle-notif" checked />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>
  `;
}

// ─── 4. Gmail Sync Category ───────────────────────────────────

function renderGmailCategory() {
  return `
    <div class="animate-fade-in-up">
      <div style="margin-bottom:var(--space-5);">
        <h2 style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);">Gmail Sync</h2>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">
          Automated read-only bank email extraction & transaction ledger syncing
        </p>
      </div>

      <div class="settings-group">
        <!-- Gmail Connection Container (populated asynchronously) -->
        <div id="gmail-connection-section">
          <div class="settings-item" style="cursor:default;">
            <div class="settings-item-left">
              <div class="settings-icon" style="background:rgba(102,112,133,0.1);color:var(--color-text-muted);">📧</div>
              <div>
                <div class="settings-label">Gmail Transaction Sync</div>
                <div class="settings-desc">Checking connection…</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── 5. AI Assistant Category ─────────────────────────────────

function renderAICategory() {
  return `
    <div class="animate-fade-in-up">
      <div style="margin-bottom:var(--space-5);">
        <h2 style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);">AI Assistant</h2>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">
          Intelligence engine preferences, voice input, and local-first privacy
        </p>
      </div>

      <div class="settings-group">
        <div class="settings-item" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(14,124,123,0.1);color:var(--color-flow);">🤖</div>
            <div>
              <div class="settings-label">Financial Intelligence Engine</div>
              <div class="settings-desc">
                <span class="badge badge-success" style="font-size:10px;">Active</span>
                <span class="text-xs text-muted" style="margin-left:6px;">Gemini 2.5 Flash with Real-Time Local Tools</span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-item" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(67,56,202,0.1);color:var(--color-intel);">🎙️</div>
            <div>
              <div class="settings-label">Voice Recognition & Playback</div>
              <div class="settings-desc">Supports Web Speech API for voice queries and audio listen in English & Tamil</div>
            </div>
          </div>
        </div>

        <div class="settings-item" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(16,185,129,0.1);color:var(--color-success);">🔒</div>
            <div>
              <div class="settings-label">Privacy & Data Governance</div>
              <div class="settings-desc">Zero cloud retention. Financial calculations and chat history stay exclusively on your device in IndexedDB.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── 6. Account & Data Category ───────────────────────────────

function renderAccountCategory() {
  return `
    <div class="animate-fade-in-up">
      <div style="margin-bottom:var(--space-5);">
        <h2 style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);">Account & Data</h2>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">
          Ledger backups, security, feedback, and session management
        </p>
      </div>

      <div class="settings-group">
        <!-- Export Local Data -->
        <div class="settings-item" id="set-export" style="cursor:pointer;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(14,124,123,0.1);color:var(--color-flow);">📥</div>
            <div>
              <div class="settings-label" data-i18n="settings.exportData">Export Data</div>
              <div class="settings-desc">Download your IndexedDB financial ledger as JSON backup</div>
            </div>
          </div>
          ${chevronRight()}
        </div>

        <!-- Delete / Reset Local Ledger -->
        <div class="settings-item" id="set-delete" style="cursor:pointer;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(220,38,38,0.1);color:var(--color-danger);">🗑️</div>
            <div>
              <div class="settings-label" style="color:var(--color-danger);" data-i18n="settings.deleteAccount">Delete Local Ledger</div>
              <div class="settings-desc" data-i18n="settings.deleteDesc">Permanently erase stored offline transactions on this device</div>
            </div>
          </div>
          ${chevronRight()}
        </div>

        <!-- Feedback -->
        <div class="settings-item" id="set-feedback" style="cursor:pointer;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(14,124,123,0.1);color:var(--color-flow);">💬</div>
            <div>
              <div class="settings-label" data-i18n="settings.feedback">Send Feedback</div>
              <div class="settings-desc">Submit suggestions or bug reports to Kanakku support</div>
            </div>
          </div>
          ${chevronRight()}
        </div>

        <!-- About -->
        <div class="settings-item" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(67,56,202,0.1);color:var(--color-intel);">ℹ️</div>
            <div>
              <div class="settings-label" data-i18n="settings.version">Version</div>
              <div class="settings-desc">Kanakku Finance PWA v1.0.0 (Command Console)</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sign Out Button -->
      <div style="margin-top:var(--space-6);">
        <button id="btn-signout" class="btn btn-danger btn-lg btn-full" style="border-radius:var(--radius-xl);">
          🚪 <span data-i18n="settings.signOut">Sign Out</span>
        </button>
      </div>
    </div>
  `;
}

// ── Gmail connection section (real, DB-backed status) ─────────────

async function loadGmailConnectionSection(container) {
  const section = container.querySelector('#gmail-connection-section');
  if (!section) return;

  const hashQuery = window.location.hash.split('?')[1] || '';
  const params = new URLSearchParams(hashQuery);
  const gmailParam = params.get('gmail');
  if (gmailParam) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#/settings`);
    import('../app.js').then(m => {
      if (gmailParam === 'connected') m.showToast?.('success', 'Gmail connected successfully.');
      else m.showToast?.('error', 'Could not connect Gmail. ' + (params.get('reason') || 'Please try again.'));
    });
  }

  try {
    const status = await getGmailConnectionStatus();
    renderGmailSection(container, status);
  } catch (err) {
    section.innerHTML = `
      <div class="settings-item" style="cursor:default;">
        <div class="settings-item-left">
          <div class="settings-icon" style="background:rgba(220,38,38,0.1);color:var(--color-danger);">📧</div>
          <div>
            <div class="settings-label">Gmail Transaction Sync</div>
            <div class="settings-desc">Could not check connection status.</div>
          </div>
        </div>
      </div>
    `;
  }
}

function renderGmailSection(container, status) {
  const section = container.querySelector('#gmail-connection-section');
  if (!section) return;

  if (status.connected) {
    section.innerHTML = `
      <div class="settings-item" id="set-gmail" style="flex-direction:column;align-items:stretch;gap:var(--space-3);cursor:default;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(14,124,123,0.1);color:var(--color-flow);">📧</div>
            <div>
              <div class="settings-label">✓ Gmail Connected</div>
              <div class="settings-desc">
                <span class="badge badge-success" style="font-size:10px;">Connected</span>
                <span class="text-xs text-muted" style="margin-left:var(--space-2);">${escapeHtml(status.googleAccountEmail || '')}</span>
              </div>
            </div>
          </div>
          <button class="btn btn-secondary" style="font-size:var(--text-xs);padding:var(--space-2) var(--space-3);color:var(--color-danger);" id="btn-disconnect-gmail">
            Disconnect
          </button>
        </div>

        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-2);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2);">
          <span class="text-xs text-muted">Manage transaction synchronization and custom date ranges:</span>
          <button class="btn btn-primary" style="font-size:var(--text-xs);padding:var(--space-1) var(--space-3);" id="btn-go-gmail-dashboard">
            Open Gmail Sync Dashboard →
          </button>
        </div>
      </div>
    `;
    section.querySelector('#btn-disconnect-gmail')?.addEventListener('click', () => handleGmailDisconnect(container));
    section.querySelector('#btn-go-gmail-dashboard')?.addEventListener('click', () => {
      window.location.hash = '/gmail';
    });
  } else {
    section.innerHTML = `
      <div class="settings-item" style="flex-direction:column;align-items:stretch;gap:var(--space-3);cursor:default;">
        <div class="settings-item-left">
          <div class="settings-icon" style="background:rgba(102,112,133,0.1);color:var(--color-text-muted);">📧</div>
          <div>
            <div class="settings-label">Gmail</div>
            <div class="settings-desc">
              <span class="badge badge-neutral" style="font-size:10px;">Not Connected</span>
              <span class="text-xs text-muted" style="margin-left:var(--space-2);">Connect your Gmail account to automatically import financial transaction emails</span>
            </div>
          </div>
        </div>
        <button class="btn btn-primary" style="font-size:var(--text-xs);padding:var(--space-2) var(--space-3);" id="btn-connect-gmail">
          Connect Gmail
        </button>
      </div>
    `;
    section.querySelector('#btn-connect-gmail')?.addEventListener('click', (e) => handleGmailConnect(e.currentTarget));
  }
}

async function handleGmailConnect(btn) {
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    const { authUrl } = await initiateGmailConnect();
    if (!authUrl) throw new Error('Google OAuth is not configured on the server.');
    window.location.href = authUrl;
  } catch (err) {
    import('../app.js').then(m => m.showToast?.('error', err.message || 'Could not start Gmail connection'));
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function handleGmailDisconnect(container) {
  if (!window.confirm('Disconnect Gmail? Kanakku will no longer be able to read your Gmail. Your existing transactions are not affected.')) return;
  try {
    await disconnectGmailConnection();
    import('../app.js').then(m => m.showToast?.('success', 'Gmail disconnected.'));
    loadGmailConnectionSection(container);
  } catch (err) {
    import('../app.js').then(m => m.showToast?.('error', err.message || 'Could not disconnect Gmail'));
  }
}

// ─── Setup Settings Handlers ──────────────────────────────────

function setupSettingsHandlers(container, user) {
  // Category Navigation Switching
  container.querySelectorAll('.settings-nav-item').forEach(navItem => {
    navItem.addEventListener('click', () => {
      const cat = navItem.dataset.cat;
      if (cat && cat !== _activeSettingsCategory) {
        _activeSettingsCategory = cat;
        renderSettings(container);
      }
    });
  });

  // Profile Picture Upload
  const pfpTrigger = container.querySelector('#pfp-upload-trigger');
  const pfpActionBtn = container.querySelector('#btn-change-pfp-action');
  const pfpFileInput = container.querySelector('#pfp-file-input');

  const triggerUpload = () => pfpFileInput?.click();

  pfpTrigger?.addEventListener('click', triggerUpload);
  pfpActionBtn?.addEventListener('click', triggerUpload);

  pfpTrigger?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerUpload();
    }
  });

  pfpFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readAndCompressImage(file);
      const currentUser = getState('user') || {};
      const updatedUser = { ...currentUser, photoURL: dataUrl, picture: dataUrl };

      setState({ user: updatedUser });
      persistSession(updatedUser);

      try {
        const db = getDB();
        await db.profile.put({ ...updatedUser });
      } catch (_) {}

      try {
        await updateUserProfile({ picture: dataUrl });
      } catch (_) {}

      renderSettings(container);
      import('../app.js').then(m => m.showToast?.('success', 'Profile photo updated!'));
    } catch (err) {
      import('../app.js').then(m => m.showToast?.('error', err.message || 'Could not update profile photo'));
    }
  });

  // Edit Profile Modal
  container.querySelector('#btn-edit-profile')?.addEventListener('click', () => {
    showEditProfileModal(user, container);
  });

  // Theme switcher
  container.querySelectorAll('[data-settheme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedTheme = btn.dataset.settheme;
      const userId = user?.userId || null;
      applyTheme(selectedTheme, userId, true);

      container.querySelectorAll('[data-settheme]').forEach(b => {
        b.classList.toggle('active', b.dataset.settheme === selectedTheme);
      });

      const iconEl = container.querySelector('#theme-icon');
      const descEl = container.querySelector('#theme-desc');
      if (iconEl) iconEl.textContent = THEME_ICONS[selectedTheme] || '☀️';
      if (descEl) descEl.textContent = THEME_DESCS[selectedTheme] || THEME_DESCS.light;

      import('../app.js').then(m => m.showToast?.('success', `Theme set to ${selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1)}`));
    });
  });

  // Language switcher
  container.querySelectorAll('[data-setlang]').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.setlang;
      setLang(lang);
      updateUserProfile({ language: lang }).catch(() => {});
      renderSettings(container);
      import('../app.js').then(m => m.showToast?.('success', t('notifications.settingsSaved')));
    });
  });

  // Currency switcher
  container.querySelector('#currency-select')?.addEventListener('change', (e) => {
    const newCode = e.target.value;
    const updated = setCurrency(newCode, user?.userId || null, true);
    const iconEl = container.querySelector('#currency-icon');
    if (iconEl) iconEl.textContent = updated.symbol;
    import('../app.js').then(m => m.showToast?.('success', `Currency set to ${updated.code} (${updated.symbol})`));
  });

  // Export Data as JSON
  container.querySelector('#set-export')?.addEventListener('click', async () => {
    try {
      const db = getDB();
      const txns = await db.transactions.toArray();
      const profile = await db.profile.toArray();
      const statements = await db.statements.toArray();

      const exportBlob = new Blob([
        JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          profile,
          transactions: txns,
          statements,
        }, null, 2)
      ], { type: 'application/json' });

      const url = URL.createObjectURL(exportBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Kanakku_Backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      import('../app.js').then(m => m.showToast?.('success', 'Data exported successfully!'));
    } catch (err) {
      import('../app.js').then(m => m.showToast?.('error', 'Export failed: ' + err.message));
    }
  });

  // Delete Data
  container.querySelector('#set-delete')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete all local financial records? This action cannot be undone.')) {
      try {
        const db = getDB();
        await db.transactions.clear();
        await db.statements.clear();
        await db.statementData.clear();
        resetState();
        import('../app.js').then(m => {
          m.showToast?.('success', 'Local data cleared');
          m.showOnboarding?.();
        });
      } catch (err) {
        import('../app.js').then(m => m.showToast?.('error', 'Could not clear data: ' + err.message));
      }
    }
  });

  // Feedback
  container.querySelector('#set-feedback')?.addEventListener('click', () => {
    window.open('mailto:support@kanakku.app?subject=Kanakku%20Feedback', '_blank');
  });

  // Sign Out
  container.querySelector('#btn-signout')?.addEventListener('click', async () => {
    if (confirm(t('settings.signOutConfirm'))) {
      try {
        const { logout, clearTokens } = await import('../services/apiClient.js');
        await logout();
        clearTokens();
      } catch (_) {}
      resetState();
      clearSession();
      setCurrentUser(null);
      resetThemeOnLogout();
      resetCurrencyOnLogout();
      import('../app.js').then(({ showOnboarding }) => showOnboarding());
    }
  });
}

function readAndCompressImage(file, maxSize = 300) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('Please choose a valid image file.'));
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load selected image.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function showEditProfileModal(user, parentContainer) {
  let pendingPhoto = user.photoURL || user.picture || '';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="border-radius:var(--radius-2xl) var(--radius-2xl) 0 0;">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <h3 class="modal-title">Edit Profile</h3>
        <button class="btn btn-icon btn-ghost" id="edit-profile-close">${iconClose()}</button>
      </div>
      <div class="modal-body">
        <form id="edit-profile-form" style="display:flex;flex-direction:column;gap:var(--space-4);">
          <!-- Profile Picture Upload / Preview -->
          <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-2);padding-bottom:var(--space-3);border-bottom:1px solid var(--color-border);">
            <div id="modal-avatar-preview" style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:var(--gradient-brand);box-shadow:var(--shadow-brand);display:flex;align-items:center;justify-content:center;border:2.5px solid var(--color-border);font-size:1.5rem;color:white;font-weight:var(--weight-bold);">
              ${pendingPhoto ? `
                <img src="${escapeHtml(pendingPhoto)}" alt="Profile preview" style="width:100%;height:100%;object-fit:cover;display:block;" />
              ` : `
                <span>${user.name ? escapeHtml(user.name.charAt(0).toUpperCase()) : '?'}</span>
              `}
            </div>
            <div style="display:flex;gap:var(--space-2);align-items:center;margin-top:4px;">
              <button type="button" class="btn btn-sm btn-secondary" id="btn-modal-upload-photo" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <span>Upload Image</span>
              </button>
              <button type="button" class="btn btn-sm btn-ghost text-danger" id="btn-modal-remove-photo" style="display:${pendingPhoto ? 'inline-flex' : 'none'};font-size:12px;padding:6px 10px;">
                Remove
              </button>
            </div>
            <input type="file" id="modal-pfp-file-input" accept="image/*" style="display:none;" />
          </div>

          <div class="form-group">
            <label class="form-label" data-i18n="onboarding.name">Name</label>
            <input id="prof-name" class="form-input" value="${escapeHtml(user.name || '')}" required />
          </div>
          <div class="form-group">
            <label class="form-label" data-i18n="onboarding.workType">Work Type</label>
            <select id="prof-worktype" class="form-select">
              <option value="salaried" ${user.workType === 'salaried' ? 'selected' : ''}>Salaried</option>
              <option value="business" ${user.workType === 'business' ? 'selected' : ''}>Business</option>
              <option value="freelancer" ${user.workType === 'freelancer' ? 'selected' : ''}>Freelancer</option>
              <option value="student" ${user.workType === 'student' ? 'selected' : ''}>Student</option>
              <option value="homemaker" ${user.workType === 'homemaker' ? 'selected' : ''}>Homemaker</option>
              <option value="other" ${user.workType === 'other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:var(--space-2);">
            Save Changes
          </button>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const close = () => { backdrop.classList.remove('open'); setTimeout(() => backdrop.remove(), 400); };
  backdrop.querySelector('#edit-profile-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  const modalFileInput = backdrop.querySelector('#modal-pfp-file-input');
  const modalUploadBtn = backdrop.querySelector('#btn-modal-upload-photo');
  const modalRemoveBtn = backdrop.querySelector('#btn-modal-remove-photo');
  const modalAvatarPreview = backdrop.querySelector('#modal-avatar-preview');

  modalUploadBtn?.addEventListener('click', () => modalFileInput?.click());
  modalFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      pendingPhoto = await readAndCompressImage(file);
      modalAvatarPreview.innerHTML = `<img src="${escapeHtml(pendingPhoto)}" alt="Profile preview" style="width:100%;height:100%;object-fit:cover;display:block;" />`;
      if (modalRemoveBtn) modalRemoveBtn.style.display = 'inline-flex';
    } catch (err) {
      import('../app.js').then(m => m.showToast?.('error', err.message || 'Invalid image'));
    }
  });

  modalRemoveBtn?.addEventListener('click', () => {
    pendingPhoto = '';
    const currentName = backdrop.querySelector('#prof-name')?.value?.trim() || user.name || '';
    modalAvatarPreview.innerHTML = `<span>${currentName ? escapeHtml(currentName.charAt(0).toUpperCase()) : '?'}</span>`;
    modalRemoveBtn.style.display = 'none';
  });

  backdrop.querySelector('#edit-profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const updatedName = backdrop.querySelector('#prof-name').value.trim();
    const updatedWorkType = backdrop.querySelector('#prof-worktype').value;

    const updatedUser = {
      ...user,
      name: updatedName,
      workType: updatedWorkType,
      photoURL: pendingPhoto,
      picture: pendingPhoto,
    };
    setState({ user: updatedUser });
    persistSession(updatedUser);

    try {
      const db = getDB();
      await db.profile.put({ ...updatedUser });
    } catch (_) {}

    try {
      await updateUserProfile({
        name: updatedName,
        workType: updatedWorkType,
        picture: pendingPhoto,
      });
    } catch (_) {}

    close();
    renderSettings(parentContainer);
    import('../app.js').then(m => m.showToast?.('success', 'Profile updated'));
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chevronRight() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-text-muted);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>`;
}

function iconClose() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}
