// ============================================================
// CashFlow App — Main Entry
// ============================================================

import { initI18n, t, getLang, rerender } from './i18n.js';
import { initRouter, navigate }           from './router.js';
import { getState, setState, loadSession, persistSession, clearSession } from './store.js';
import { renderOnboarding }   from './pages/onboarding.js';
import { renderDashboard }    from './pages/dashboard.js';
import { renderChat }         from './pages/chat.js';
import { renderTransactions } from './pages/transactions.js';
import { renderReports }      from './pages/reports.js';
import { renderStatements }   from './pages/statements.js';
import { renderSettings }     from './pages/settings.js';
import { renderGmailSync }    from './pages/gmail.js';
import { extractCallbackTokens, extractCallbackError, setTokens, clearTokens, fetchUserProfile, loadStoredTokens } from './services/apiClient.js';
import { getDB, setCurrentUser } from './services/db.js';
import { completeAuth } from './authFlow.js';
import { initTheme, resetThemeOnLogout } from './services/theme.js';
import { initCurrency, resetCurrencyOnLogout, getCurrencySymbol } from './services/currency.js';

// ── Initialization ───────────────────────────────────────────

async function init() {
  // 1. i18n, Theme, Currency
  initI18n();
  const initialUser = loadSession();
  initTheme(initialUser?.userId || null);
  initCurrency(initialUser?.userId || null);

  // 2. Register Service Worker with forced update check
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.update().catch(() => {});
    }).catch(() => {});
  }

  // 3. Check for OAuth callback error in URL
  const callbackError = extractCallbackError();
  if (callbackError) {
    let friendlyMessage = callbackError;
    const lower = callbackError.toLowerCase();
    if (lower.includes('access_denied') || lower.includes('user_denied')) {
      friendlyMessage = 'Google authorization was denied or cancelled. Please grant access to continue.';
    } else if (lower.includes('invalid_client') || lower.includes('unauthorized_client')) {
      friendlyMessage = 'Google OAuth configuration error: Invalid Client ID or credentials.';
    } else if (lower.includes('redirect_uri_mismatch')) {
      friendlyMessage = 'OAuth redirect URI mismatch in Google Cloud configuration.';
    } else if (lower.includes('missing_authorization_code')) {
      friendlyMessage = 'Authorization code was not returned by Google. Please try again.';
    } else if (lower.includes('token_exchange_failed') || lower.includes('invalid_grant')) {
      friendlyMessage = 'Authorization code expired or failed to exchange for tokens. Please sign in again.';
    } else if (lower.includes('state_mismatch')) {
      friendlyMessage = 'Security validation failed (state mismatch). Please try logging in again.';
    } else if (lower.includes('permission_denied') || lower.includes('gmail_permission_denied')) {
      friendlyMessage = 'Gmail permission was denied. Please ensure read-only Gmail access is selected during sign-in.';
    }

    clearTokens();
    clearSession();
    setCurrentUser(null);
    resetThemeOnLogout();
    resetCurrencyOnLogout();
    setState({ isAuthenticated: false, user: null });
    showOnboarding(0, { errorMsg: friendlyMessage });
    return;
  }

  // 4. Check for OAuth callback tokens in URL
  const callbackTokens = extractCallbackTokens();
  if (callbackTokens) {
    setTokens(callbackTokens);
    try {
      let user = null;
      try {
        const profile = await fetchUserProfile();
        user = profile?.user;
      } catch (_) {}

      if (!user && callbackTokens.accessToken) {
        try {
          const base64Url = callbackTokens.accessToken.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
          const decoded = JSON.parse(jsonPayload);
          if (decoded?.userId) {
            user = {
              userId: decoded.userId,
              email: decoded.email,
              name: decoded.name,
              picture: decoded.picture || '',
              authProvider: 'google',
            };
          }
        } catch (_) {}
      }

      if (user) {
        const { goTo } = await completeAuth(
          { ...callbackTokens, user },
          { gmailConnected: true }
        );
        if (goTo === 'main') { showMainApp(); return; }
        showOnboarding(1); // profile-setup step
        return;
      }
    } catch (_) {}
  }

  // 5. Check for local session with valid tokens
  const hasTokens = loadStoredTokens();
  const localUser = loadSession();
  if (hasTokens && localUser && localUser.name) {
    // CRITICAL: establish which user's own database to open BEFORE
    // any page renders and reads data — this is the session-restore
    // path (page refresh / reopening the browser), the other place
    // besides completeAuth() where the current user becomes known.
    setCurrentUser(localUser.userId, localUser.email);
    setState({ isAuthenticated: true, user: localUser });
    showMainApp();

    // Background sync profile with IndexedDB & Backend
    try {
      getDB().profile.get(localUser.userId).then(stored => {
        if (stored && (stored.photoURL || stored.picture) && !localUser.photoURL) {
          const u = getState('user') || localUser;
          const merged = { ...u, photoURL: stored.photoURL || stored.picture, picture: stored.photoURL || stored.picture };
          setState({ user: merged });
          persistSession(merged);
        }
      }).catch(() => {});

      fetchUserProfile().then(profile => {
        if (profile?.user) {
          const u = getState('user') || localUser;
          const updated = {
            ...u,
            name: profile.user.name || u.name,
            photoURL: profile.user.picture || u.photoURL || '',
            picture: profile.user.picture || u.photoURL || '',
            workType: profile.user.workType || u.workType,
          };
          setState({ user: updated });
          persistSession(updated);
          getDB().profile.put({ userId: updated.userId, ...updated }).catch(() => {});
        }
      }).catch(() => {});
    } catch (_) {}
  } else {
    setCurrentUser(null);
    clearTokens();
    clearSession();
    resetThemeOnLogout();
    resetCurrencyOnLogout();
    setState({ isAuthenticated: false, user: null });
    showOnboarding(0);
  }
}

// ── Shell Management ──────────────────────────────────────────

export function showOnboarding(initialStep = 0, opts = {}) {
  document.getElementById('auth-shell').style.display = 'flex';
  document.getElementById('main-shell').style.display = 'none';
  window.scrollTo(0, 0);
  renderOnboarding(initialStep, opts);
}

export function showMainApp() {
  const authShell = document.getElementById('auth-shell');
  const mainShell = document.getElementById('main-shell');
  authShell.style.display = 'none';
  mainShell.style.display = 'flex';
  window.scrollTo(0, 0);

  // Build bottom nav
  buildBottomNav();

  // Build desktop sidebar
  buildDesktopSidebar();

  // Real sync status (from gmailSync's own record, not invented)
  refreshSyncStatus();

  // Build FAB
  buildFAB();

  // Build Floating AI Assistant Button
  buildFloatingAI();

  // Update Header Avatar
  updateHeaderAvatar();

  // Build page containers
  buildPages();

  // Init router (will render correct page)
  initRouter();

  // Initial page render
  const currentPage = getState('currentPage') || 'dashboard';
  renderPage(currentPage);

  // Re-apply i18n
  rerender();
}

// ── Navigation ────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'dashboard',    icon: iconHome(),    key: 'nav.dashboard'    },
  { id: 'chat',         icon: iconChat(),    key: 'nav.chat'         },
  { id: 'transactions', icon: iconList(),    key: 'nav.transactions' },
  { id: 'reports',      icon: iconChart(),   key: 'nav.reports'      },
  { id: 'gmail',        icon: iconMail(),    key: 'nav.gmail'        },
  { id: 'settings',     icon: iconSettings(),key: 'nav.settings'     },
];

function buildBottomNav() {
  const navEl = document.getElementById('bottom-nav');
  if (!navEl) return;

  navEl.innerHTML = `
    <div class="bottom-nav-inner">
      ${NAV_ITEMS.map(item => `
        <button class="nav-item" data-page="${item.id}" aria-label="${t(item.key)}">
          <div class="nav-icon-wrap">${item.icon}</div>
          <span class="nav-label" data-i18n="${item.key}"></span>
        </button>
      `).join('')}
    </div>
  `;

  navEl.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(`/${btn.dataset.page}`);
      renderPage(btn.dataset.page);
    });
  });

  rerender();
}

function buildDesktopSidebar() {
  const el = document.getElementById('desktop-sidebar');
  if (!el) return;

  el.innerHTML = `
    <div class="desktop-nav-brand">
      <div class="desktop-nav-brand-mark">${getCurrencySymbol()}</div>
      <div class="desktop-nav-brand-name">CashFlow</div>
    </div>
    ${NAV_ITEMS.map(item => `
      <button class="desktop-nav-item" data-page="${item.id}">
        ${item.icon}
        <span data-i18n="${item.key}"></span>
      </button>
    `).join('')}
    <div class="desktop-nav-footer">
      <span class="sync-pill offline" id="sidebar-sync-pill">
        <span class="sync-pill-dot"></span>
        <span id="sidebar-sync-label">—</span>
      </span>
    </div>
  `;

  el.querySelectorAll('.desktop-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(`/${btn.dataset.page}`);
      renderPage(btn.dataset.page);
    });
  });

  rerender();
}

/** Real sync status, derived from gmailSync's own record — not invented. */
async function refreshSyncStatus() {
  try {
    const { getLastSyncTime } = await import('./services/gmailSync.js');
    const last = await getLastSyncTime();
    const label = last ? relativeSyncLabel(new Date(last)) : 'Not synced yet';
    setSyncPill(!!last, label);
  } catch {
    setSyncPill(false, 'Sync unavailable');
  }
}

function relativeSyncLabel(date) {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  return `Synced ${Math.floor(hrs / 24)}d ago`;
}

function setSyncPill(online, label) {
  [
    ['header-sync-pill', 'header-sync-label'],
    ['sidebar-sync-pill', 'sidebar-sync-label'],
  ].forEach(([pillId, labelId]) => {
    const pill = document.getElementById(pillId);
    const lbl  = document.getElementById(labelId);
    if (pill) pill.classList.toggle('offline', !online);
    if (lbl) lbl.textContent = label;
  });
}

// ── Pages ─────────────────────────────────────────────────────

function buildPages() {
  const pagesContainer = document.getElementById('pages-container');
  if (!pagesContainer) return;

  const pages = ['dashboard','chat','transactions','reports','statements','gmail','settings'];
  pagesContainer.innerHTML = pages.map(p => `
    <div id="page-${p}" class="page" role="main">
      <div class="container" id="page-${p}-content"></div>
    </div>
  `).join('');
}

export function renderPage(page, options = {}) {
  window.scrollTo(0, 0);
  // Update nav active state
  document.querySelectorAll('.nav-item, .desktop-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Show/hide pages
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');

  // Render page content into its content container
  const content = document.getElementById(`page-${page}-content`);
  if (!content) return;

  switch (page) {
    case 'dashboard':    renderDashboard(content, options);    break;
    case 'chat':         renderChat(content, options);         break;
    case 'transactions': renderTransactions(content, options); break;
    case 'reports':      renderReports(content, options);      break;
    case 'statements':   renderStatements(content, options);   break;
    case 'gmail':        renderGmailSync(content, options);    break;
    case 'settings':     renderSettings(content, options);     break;
  }
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer) {
    fabContainer.style.display = page === 'chat' ? 'none' : '';
  }
  const floatingAIBtn = document.getElementById('floating-ai-btn');
  if (floatingAIBtn) {
    floatingAIBtn.style.display = page === 'chat' ? 'none' : '';
  }
  updateHeaderAvatar();

  setState({ currentPage: page });
}

// ── FAB (Quick Actions) ───────────────────────────────────────

function buildFAB() {
  let existing = document.getElementById('fab-container');
  if (existing) existing.remove();

  const fab = document.createElement('div');
  fab.id = 'fab-container';
  fab.innerHTML = `
    <!-- FAB Menu Items (hidden) -->
    <div id="fab-menu" class="fab-menu hidden">
      ${[
        { icon: '💸', label: t('quickActions.addCashExpense'), action: 'add-expense' },
        { icon: '💰', label: t('quickActions.addCashIncome'),  action: 'add-income'  },
        { icon: '📷', label: t('quickActions.uploadReceipt'),  action: 'receipt'     },
        { icon: '📧', label: t('quickActions.syncGmail'),      action: 'gmail-sync'  },
        { icon: '📊', label: t('quickActions.generateReport'), action: 'report'      },
      ].map((item, i) => `
        <div class="fab-menu-item" data-action="${item.action}" style="animation-delay:${i * 0.05}s;">
          <div class="fab-menu-item-icon" style="background:var(--gradient-brand);">${item.icon}</div>
          <span>${item.label}</span>
        </div>
      `).join('')}
    </div>

    <!-- FAB Button -->
    <button id="fab-btn" class="fab ripple-container" aria-label="${t('quickActions.title')}" aria-expanded="false">
      <svg id="fab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  `;

  document.getElementById('main-shell').appendChild(fab);

  let isOpen = false;
  const fabBtn  = fab.querySelector('#fab-btn');
  const fabMenu = fab.querySelector('#fab-menu');
  const fabIcon = fab.querySelector('#fab-icon');

  const toggle = () => {
    isOpen = !isOpen;
    fabMenu.classList.toggle('hidden', !isOpen);
    fabBtn.setAttribute('aria-expanded', isOpen);
    fabIcon.style.transform = isOpen ? 'rotate(45deg)' : 'rotate(0deg)';
    fabIcon.style.transition = 'transform 0.25s ease';
  };

  const close = () => {
    isOpen = false;
    fabMenu.classList.add('hidden');
    fabBtn.setAttribute('aria-expanded', false);
    fabIcon.style.transform = 'rotate(0deg)';
  };

  fabBtn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  document.addEventListener('click', close);

  fab.querySelectorAll('.fab-menu-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      handleFabAction(item.dataset.action);
      close();
    });
  });
}

// ── Floating AI Assistant Button ──────────────────────────────

function buildFloatingAI() {
  let existing = document.getElementById('floating-ai-btn');
  if (existing) existing.remove();

  const btn = document.createElement('button');
  btn.id = 'floating-ai-btn';
  btn.className = 'floating-ai-btn';
  btn.setAttribute('aria-label', 'Open Kanakku AI Assistant');
  btn.setAttribute('title', 'Kanakku AI Assistant');
  btn.innerHTML = `
    <span>🤖</span>
    <span class="floating-ai-badge" title="Online & Local-First"></span>
  `;

  btn.addEventListener('click', () => {
    navigate('/chat');
    renderPage('chat');
  });

  document.getElementById('main-shell').appendChild(btn);
}

function updateHeaderAvatar() {
  const avatarEl = document.getElementById('header-avatar');
  if (!avatarEl) return;
  const user = getState('user') || {};
  const photo = user.photoURL || user.picture;

  if (photo) {
    avatarEl.innerHTML = `<img src="${photo}" alt="${user.name || 'User'}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />`;
    avatarEl.style.padding = '0';
    avatarEl.style.overflow = 'hidden';
  } else {
    avatarEl.textContent = user.name ? user.name.charAt(0).toUpperCase() : '?';
  }

  avatarEl.onclick = () => {
    navigate('/settings');
    renderPage('settings');
  };
}

function handleFabAction(action) {
  switch (action) {
    case 'add-expense':
    case 'add-income':
      navigate('/transactions');
      renderPage('transactions');
      setTimeout(() => document.getElementById('btn-add-txn')?.click(), 400);
      break;
    case 'receipt':
      showReceiptUpload();
      break;
    case 'gmail-sync':
      navigate('/gmail');
      renderPage('gmail');
      break;
    case 'report':
      navigate('/reports');
      renderPage('reports');
      break;
  }
}

// ── Receipt Upload Modal ──────────────────────────────────────

export function showReceiptUpload() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="border-radius:24px 24px 0 0;">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <h3 class="modal-title" data-i18n="receipt.title"></h3>
        <button class="btn btn-icon btn-ghost" id="receipt-close">${iconClose()}</button>
      </div>
      <div class="modal-body" id="receipt-modal-body">
        <!-- Step 1: Upload -->
        <div id="receipt-upload-step">
          <div class="upload-zone" id="receipt-dropzone" tabindex="0" role="button">
            <div style="font-size:2.5rem;margin-bottom:var(--space-3);">📷</div>
            <p class="font-medium" data-i18n="receipt.dragDrop"></p>
            <p class="text-sm text-muted" style="margin-top:var(--space-1);" data-i18n="receipt.orDivider"></p>
            <input type="file" id="receipt-file-input" accept="image/*" capture="environment" style="display:none;" />
          </div>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
            <button id="btn-take-photo" class="btn btn-primary btn-full">
              📷 <span data-i18n="receipt.takePhoto"></span>
            </button>
            <button id="btn-choose-file" class="btn btn-secondary btn-full">
              📁 <span data-i18n="receipt.chooseFile"></span>
            </button>
          </div>
        </div>

        <!-- Step 2: Processing (hidden) -->
        <div id="receipt-processing-step" class="hidden" style="text-align:center;padding:var(--space-8) 0;">
          <div class="spinner spinner-lg" style="margin:0 auto var(--space-4);"></div>
          <p class="font-medium" data-i18n="receipt.processing"></p>
          <div class="progress-track" style="margin-top:var(--space-4);">
            <div class="progress-fill animate-pulse" style="width:60%;"></div>
          </div>
        </div>

        <!-- Step 3: Review (hidden) -->
        <div id="receipt-review-step" class="hidden">
          <div class="insight-card" style="margin-bottom:var(--space-4);">
            <div class="insight-label">✅ <span data-i18n="receipt.extractedData"></span></div>
            <p class="text-xs text-muted" style="margin-top:var(--space-1);">Review and confirm the extracted details</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-3);">
            <div class="form-group">
              <label class="form-label" data-i18n="receipt.merchant"></label>
              <input id="rcpt-merchant" class="form-input" value="ABC Supermarket" />
            </div>
            <div class="form-group">
              <label class="form-label" data-i18n="receipt.amount"></label>
              <div class="input-wrapper">
                <span class="input-icon-left" style="font-weight:bold;">${getCurrencySymbol()}</span>
                <input id="rcpt-amount" class="form-input has-icon-left" type="number" value="1240" />
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label" data-i18n="receipt.date"></label>
                <input id="rcpt-date" class="form-input" type="date" value="${new Date().toISOString().split('T')[0]}" />
              </div>
              <div class="form-group">
                <label class="form-label" data-i18n="receipt.paymentMethod"></label>
                <select id="rcpt-method" class="form-select">
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                </select>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);">
            <button id="btn-rcpt-edit" class="btn btn-secondary btn-full" data-i18n="receipt.editDetails"></button>
            <button id="btn-rcpt-confirm" class="btn btn-primary btn-full" data-i18n="receipt.confirmSave"></button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  rerender();

  const close = () => { backdrop.classList.remove('open'); setTimeout(() => backdrop.remove(), 400); };
  backdrop.querySelector('#receipt-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  const fileInput = backdrop.querySelector('#receipt-file-input');
  backdrop.querySelector('#btn-take-photo').addEventListener('click', () => fileInput.click());
  backdrop.querySelector('#btn-choose-file').addEventListener('click', () => { fileInput.removeAttribute('capture'); fileInput.click(); });

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    await processReceiptFile(backdrop, file);
  });

  // Drag & drop support on upload zone
  const dropzone = backdrop.querySelector('#receipt-dropzone');
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--color-brand-primary)'; });
  dropzone?.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone?.addEventListener('drop', async e => {
    e.preventDefault();
    dropzone.style.borderColor = '';
    if (e.dataTransfer?.files?.length) {
      await processReceiptFile(backdrop, e.dataTransfer.files[0]);
    }
  });

  backdrop.querySelector('#btn-rcpt-confirm')?.addEventListener('click', () => {
    import('./services/transactionsAdapter.js').then(({ addTransaction }) => {
      const amountVal = parseFloat(backdrop.querySelector('#rcpt-amount').value);
      if (!amountVal || amountVal <= 0) {
        showToast('error', 'Please enter a valid amount');
        return;
      }
      addTransaction({
        merchant:      backdrop.querySelector('#rcpt-merchant').value.trim() || 'Receipt Expense',
        amount:        amountVal,
        type:          'expense',
        category:      backdrop.dataset.rcptCategory || 'grocery',
        paymentMethod: backdrop.querySelector('#rcpt-method').value,
        date:          backdrop.querySelector('#rcpt-date').value,
        note:          backdrop.dataset.rcptGstin ? `GSTIN: ${backdrop.dataset.rcptGstin}` : '',
        icon:          '🧾',
      }).then(() => {
        close();
        showToast('success', t('notifications.receiptSaved'));
      }).catch(err => {
        showToast('error', err.message || t('errors.generic'));
      });
    });
  });
}

async function processReceiptFile(backdrop, file) {
  backdrop.querySelector('#receipt-upload-step').classList.add('hidden');
  const procStep = backdrop.querySelector('#receipt-processing-step');
  procStep.classList.remove('hidden');

  const progressLabel = procStep.querySelector('p');
  const progressBar = procStep.querySelector('.progress-fill');

  try {
    const { processReceipt } = await import('./services/transactionsAdapter.js');
    const data = await processReceipt(file, ({ status, progress }) => {
      if (progressLabel) progressLabel.textContent = status || 'Processing receipt…';
      if (progressBar) progressBar.style.width = `${progress}%`;
    });

    // Populate extracted values into review inputs
    backdrop.querySelector('#rcpt-merchant').value = data.merchant || 'Retail Store';
    backdrop.querySelector('#rcpt-amount').value = data.amount > 0 ? data.amount : '';
    backdrop.querySelector('#rcpt-date').value = data.date || new Date().toISOString().split('T')[0];
    if (data.paymentMethod) {
      backdrop.querySelector('#rcpt-method').value = data.paymentMethod;
    }
    backdrop.dataset.rcptCategory = data.category || 'grocery';
    backdrop.dataset.rcptGstin = data.gstin || '';

    procStep.classList.add('hidden');
    backdrop.querySelector('#receipt-review-step').classList.remove('hidden');
    rerender();
  } catch (err) {
    console.error('[Receipt OCR error]', err);
    // Fallback gracefully to manual review step
    procStep.classList.add('hidden');
    backdrop.querySelector('#receipt-review-step').classList.remove('hidden');
    showToast('info', 'Could not read receipt automatically. Please enter details manually.');
    rerender();
  }
}

// ── Toast Notifications ───────────────────────────────────────

export function showToast(type = 'info', message, title = '') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${title}</div>` : ''}
      <div class="toast-message">${message}</div>
    </div>
    <button class="btn btn-icon btn-ghost btn-icon-sm" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Nav Icons ─────────────────────────────────────────────────
function iconHome() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
}
function iconChat() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
}
function iconList() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
}
function iconChart() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`;
}
function iconSettings() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
}
function iconMail() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
}
function iconClose() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}

// ── Boot ──────────────────────────────────────────────────────
init().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[BOOT] Fatal initialization error:', err);
  try {
    showOnboarding(0, { errorMsg: 'Failed to initialize application. Please refresh or try signing in again.' });
  } catch (_) {
    const authShell = document.getElementById('auth-shell');
    if (authShell) authShell.style.display = 'flex';
  }
});
