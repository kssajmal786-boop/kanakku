// ============================================================
// Gmail Sync Page — Dedicated Synchronization Dashboard
// ============================================================
// Features:
//   1. Account Connection status card
//   2. Quick Date Presets: Today, Last 7 Days, This Month, Last Month
//   3. Custom Date Range with inclusive validation
//   4. Multi-step live sync progress
//   5. Real metrics from backend (found, processed, added, skipped, review)
//   6. Recent imported transactions from canonical IndexedDB
// ============================================================

import { t } from '../i18n.js';
import { getDB } from '../services/db.js';
import { syncGmailDateRange, syncGmail, getLastSyncStats, getLastSyncTime } from '../services/gmailSync.js';
import { getGmailConnectionStatus, initiateGmailConnect, getGmailSyncSettings, saveGmailSyncSettings } from '../services/apiClient.js';
import { showToast } from '../app.js';
import { formatCurrency } from '../services/currency.js';

let _activePreset = 'today';
let _isSyncing = false;

export async function renderGmailSync(container) {
  container.innerHTML = `
    <!-- Header -->
    <div class="section animate-fade-in-up">
      <div class="flex flex-between items-center">
        <div>
          <h1 class="text-xl font-bold" style="display:flex;align-items:center;gap:var(--space-2);">
            <span>📧</span> <span>Gmail Sync</span>
          </h1>
          <p class="text-xs text-muted" style="margin-top:2px;">Import financial transactions from your Gmail account</p>
        </div>
        <button class="btn btn-icon btn-secondary" id="btn-refresh-gmail-page" title="Refresh" aria-label="Refresh">
          ${iconRefresh()}
        </button>
      </div>
    </div>

    <!-- Account Connection Status -->
    <div class="section animate-fade-in-up delay-1" id="gmail-account-card">
      <div class="console-panel" style="padding:var(--space-4);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <div class="avatar avatar-md" style="background:rgba(14,124,123,0.12);color:var(--color-flow);font-size:1.1rem;">
              📧
            </div>
            <div>
              <div class="text-xs text-muted uppercase font-semibold">Gmail Account</div>
              <div class="text-sm font-bold truncate" id="gmail-account-email" style="max-width:280px;">Checking…</div>
            </div>
          </div>
          <div id="gmail-account-badge">
            <span class="badge badge-neutral" style="font-size:11px;">Checking…</span>
          </div>
        </div>
        <div id="gmail-connect-prompt" style="display:none;margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-border);">
          <p class="text-xs text-muted" style="margin-bottom:var(--space-2);">Gmail is not connected. Connect your Google account to start syncing transactions.</p>
          <button class="btn btn-primary btn-sm" id="btn-connect-gmail-page">
            Connect Gmail
          </button>
        </div>
      </div>
    </div>

    <!-- Sync Range Controls -->
    <div class="section animate-fade-in-up delay-1">
      <div class="console-panel" style="padding:var(--space-4);">
        <div class="flex flex-between items-center" style="margin-bottom:var(--space-3);">
          <div>
            <div class="console-eyebrow">SYNC RANGE</div>
            <div class="text-sm font-bold">Select Date Range</div>
          </div>
          <span class="badge badge-neutral" id="sync-range-display" style="font-size:10px;">Inclusive</span>
        </div>

        <!-- Quick Presets -->
        <div class="quick-presets" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-4);">
          <button class="chip active" data-preset="today">Today</button>
          <button class="chip" data-preset="last7">Last 7 Days</button>
          <button class="chip" data-preset="thisMonth">This Month</button>
          <button class="chip" data-preset="lastMonth">Last Month</button>
          <button class="chip" data-preset="custom">Custom</button>
        </div>

        <!-- Date Range Inputs -->
        <div class="grid-2" style="margin-bottom:var(--space-3);">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="sync-from-date" style="font-size:11px;">From</label>
            <input type="date" id="sync-from-date" class="form-input" style="font-size:var(--text-sm);" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="sync-to-date" style="font-size:11px;">To</label>
            <input type="date" id="sync-to-date" class="form-input" style="font-size:var(--text-sm);" />
          </div>
        </div>

        <!-- Inline Validation Error -->
        <div id="sync-date-error" style="display:none;color:var(--color-danger);font-size:12px;margin-bottom:var(--space-3);padding:var(--space-2) var(--space-3);background:rgba(220,38,38,0.08);border-radius:var(--radius-md);border:1px solid rgba(220,38,38,0.2);">
          Start date must be before or equal to end date.
        </div>

        <!-- Action Buttons -->
        <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2);flex-wrap:wrap;">
          <button class="btn btn-primary" id="btn-sync-range" style="flex:2;min-width:180px;">
            🔄 Sync Gmail
          </button>
          <button class="btn btn-secondary" id="btn-sync-incremental" style="flex:1;min-width:140px;" title="Scan new messages since last sync">
            ⚡ Sync New
          </button>
        </div>
      </div>
    </div>

    <!-- Live Sync Progress Area (hidden by default) -->
    <div class="section" id="gmail-progress-section" style="display:none;">
      <div class="console-panel" style="padding:var(--space-4);background:rgba(14,124,123,0.05);border:1px solid rgba(14,124,123,0.25);">
        <div style="display:flex;align-items:center;gap:var(--space-3);">
          <div class="spinner spinner-sm" id="gmail-progress-spinner"></div>
          <div style="flex:1;">
            <div class="text-sm font-semibold" id="gmail-progress-title">Syncing with Gmail…</div>
            <div class="text-xs text-muted" id="gmail-progress-detail" style="margin-top:2px;">Contacting Gmail API</div>
          </div>
        </div>
        <div class="progress-track" style="margin-top:var(--space-3);height:4px;">
          <div class="progress-fill" id="gmail-progress-bar" style="width:30%;transition:width 0.3s ease;"></div>
        </div>
      </div>
    </div>

    <!-- Quota / Warning Banner (hidden by default) -->
    <div class="section" id="gmail-quota-banner" style="display:none;">
      <div class="console-panel" style="padding:var(--space-3) var(--space-4);background:rgba(217,119,6,0.08);border:1px solid rgba(217,119,6,0.25);border-radius:var(--radius-lg);">
        <div style="display:flex;align-items:flex-start;gap:var(--space-2);">
          <span style="font-size:1.1rem;line-height:1;">⏳</span>
          <div>
            <div class="text-xs font-bold" style="color:var(--color-brand-accent);">Google Quota Notice</div>
            <div class="text-xs text-muted" id="gmail-quota-message" style="margin-top:2px;">
              Google temporarily limited Gmail requests. Some emails are pending and can be processed during the next sync.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sync Status & Metrics Card -->
    <div class="section animate-fade-in-up delay-2">
      <div class="console-panel" style="padding:var(--space-4);">
        <div class="flex flex-between items-center" style="margin-bottom:var(--space-3);border-bottom:1px solid var(--color-border);padding-bottom:var(--space-2);">
          <div>
            <div class="console-eyebrow">SYNC STATUS</div>
            <div class="text-sm font-bold">Latest Sync Results</div>
          </div>
          <div class="text-xs text-muted" id="gmail-last-sync-time">Last Sync: Never</div>
        </div>

        <!-- Metrics Grid -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(100px, 1fr));gap:var(--space-3);text-align:center;">
          <div class="metric-box" style="padding:var(--space-2);background:var(--color-surface-alt);border-radius:var(--radius-md);">
            <div class="console-eyebrow" style="font-size:9px;">EMAILS FOUND</div>
            <div class="text-lg font-bold font-mono" id="metric-found" style="color:var(--color-text-primary);">0</div>
          </div>
          <div class="metric-box" style="padding:var(--space-2);background:var(--color-surface-alt);border-radius:var(--radius-md);">
            <div class="console-eyebrow" style="font-size:9px;">PROCESSED</div>
            <div class="text-lg font-bold font-mono" id="metric-processed" style="color:var(--color-intel);">0</div>
          </div>
          <div class="metric-box" style="padding:var(--space-2);background:var(--color-surface-alt);border-radius:var(--radius-md);">
            <div class="console-eyebrow" style="font-size:9px;">TXNS ADDED</div>
            <div class="text-lg font-bold font-mono text-income" id="metric-added">0</div>
          </div>
          <div class="metric-box" style="padding:var(--space-2);background:var(--color-surface-alt);border-radius:var(--radius-md);">
            <div class="console-eyebrow" style="font-size:9px;">DUPLICATES</div>
            <div class="text-lg font-bold font-mono" id="metric-skipped" style="color:var(--color-text-muted);">0</div>
          </div>
          <div class="metric-box" style="padding:var(--space-2);background:var(--color-surface-alt);border-radius:var(--radius-md);">
            <div class="console-eyebrow" style="font-size:9px;">NEEDS REVIEW</div>
            <div class="text-lg font-bold font-mono" id="metric-review" style="color:var(--color-brand-accent);">0</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Imported Transactions -->
    <div class="section animate-fade-in-up delay-3" style="margin-bottom:var(--space-8);">
      <div class="console-panel" style="padding:var(--space-4);">
        <div class="flex flex-between items-center" style="margin-bottom:var(--space-3);">
          <div>
            <div class="console-eyebrow">TRANSACTIONS</div>
            <div class="text-sm font-bold">Recent Imported Transactions</div>
          </div>
          <button class="btn btn-ghost" style="font-size:11px;padding:var(--space-1) var(--space-2);" id="btn-view-all-txns">
            View All →
          </button>
        </div>

        <div id="recent-gmail-txns-container">
          <div style="text-align:center;padding:var(--space-6) 0;" class="text-muted text-xs">
            <span class="spinner-sm"></span> Loading imported transactions…
          </div>
        </div>
      </div>
    </div>
  `;

  // Initialize UI & Event Handlers
  setupPageHandlers(container);

  // Restore saved date range and preset (or default to 'today')
  const savedSettings = await loadDateRangeSettings();
  if (savedSettings && savedSettings.activePreset) {
    if (savedSettings.activePreset === 'custom' && savedSettings.customStartDate && savedSettings.customEndDate) {
      _activePreset = 'custom';
      container.querySelectorAll('.quick-presets .chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === 'custom');
      });
      const fromInput = container.querySelector('#sync-from-date');
      const toInput = container.querySelector('#sync-to-date');
      if (fromInput) fromInput.value = savedSettings.customStartDate;
      if (toInput) toInput.value = savedSettings.customEndDate;
      validateDateRange(container);
    } else if (savedSettings.activePreset !== 'custom') {
      populatePreset(savedSettings.activePreset, container);
    } else {
      populatePreset('today', container);
    }
  } else {
    populatePreset('today', container);
  }

  await checkConnectionStatus(container);
  await loadSyncMetrics(container);
  await renderRecentTransactions(container);
}

// ─── Helpers: Date Preset Calculations & Persistence ─────────────

async function persistDateRangeSettings({ activePreset, customStartDate, customEndDate }) {
  try {
    const db = getDB();
    await db.syncMeta.put({
      key: 'gmail_sync_settings',
      activePreset,
      customStartDate: customStartDate || null,
      customEndDate: customEndDate || null,
      updatedAt: new Date().toISOString(),
    });
  } catch (_) {}

  try {
    await saveGmailSyncSettings({
      activePreset,
      customStartDate: customStartDate || null,
      customEndDate: customEndDate || null,
    });
  } catch (_) {}
}

async function loadDateRangeSettings() {
  let localSettings = null;
  try {
    const db = getDB();
    localSettings = await db.syncMeta.get('gmail_sync_settings');
  } catch (_) {}

  try {
    const backendSettings = await getGmailSyncSettings();
    if (backendSettings && (backendSettings.activePreset || backendSettings.customStartDate || backendSettings.customEndDate)) {
      return {
        activePreset: backendSettings.activePreset || localSettings?.activePreset || 'today',
        customStartDate: backendSettings.customStartDate || localSettings?.customStartDate || null,
        customEndDate: backendSettings.customEndDate || localSettings?.customEndDate || null,
      };
    }
  } catch (_) {}

  return localSettings || null;
}

function getPresetDates(preset) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const format = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  switch (preset) {
    case 'today': {
      const todayStr = format(now);
      return { startDate: todayStr, endDate: todayStr };
    }
    case 'last7': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return { startDate: format(start), endDate: format(now) };
    }
    case 'thisMonth': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: format(start), endDate: format(now) };
    }
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: format(start), endDate: format(end) };
    }
    default:
      return null;
  }
}

function populatePreset(preset, container) {
  _activePreset = preset;
  container.querySelectorAll('.quick-presets .chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });

  const range = getPresetDates(preset);
  if (range) {
    const fromInput = container.querySelector('#sync-from-date');
    const toInput = container.querySelector('#sync-to-date');
    if (fromInput) fromInput.value = range.startDate;
    if (toInput) toInput.value = range.endDate;
    validateDateRange(container);
  }
}

function validateDateRange(container) {
  const fromVal = container.querySelector('#sync-from-date')?.value || '';
  const toVal = container.querySelector('#sync-to-date')?.value || '';
  const errorEl = container.querySelector('#sync-date-error');
  const syncBtn = container.querySelector('#btn-sync-range');
  const rangeDisplay = container.querySelector('#sync-range-display');

  if (!fromVal || !toVal) {
    if (errorEl) {
      errorEl.textContent = 'Please select both start and end dates.';
      errorEl.style.display = 'block';
    }
    if (syncBtn) syncBtn.disabled = true;
    return false;
  }

  if (fromVal > toVal) {
    if (errorEl) {
      errorEl.textContent = 'Start date must be before or equal to end date.';
      errorEl.style.display = 'block';
    }
    if (syncBtn) syncBtn.disabled = true;
    return false;
  }

  // Valid
  if (errorEl) errorEl.style.display = 'none';
  if (syncBtn && !_isSyncing) syncBtn.disabled = false;
  if (rangeDisplay) {
    rangeDisplay.textContent = `${fromVal} → ${toVal}`;
  }
  return true;
}

// ─── Event Handlers ───────────────────────────────────────────

function setupPageHandlers(container) {
  // Preset buttons
  container.querySelectorAll('.quick-presets .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const preset = chip.dataset.preset;
      if (preset === 'custom') {
        _activePreset = 'custom';
        container.querySelectorAll('.quick-presets .chip').forEach(c => c.classList.toggle('active', c === chip));
        const fromVal = container.querySelector('#sync-from-date')?.value || '';
        const toVal = container.querySelector('#sync-to-date')?.value || '';
        persistDateRangeSettings({ activePreset: 'custom', customStartDate: fromVal, customEndDate: toVal });
        container.querySelector('#sync-from-date')?.focus();
      } else {
        populatePreset(preset, container);
        const range = getPresetDates(preset);
        persistDateRangeSettings({
          activePreset: preset,
          customStartDate: range?.startDate || '',
          customEndDate: range?.endDate || '',
        });
      }
    });
  });

  // Date inputs change
  container.querySelector('#sync-from-date')?.addEventListener('input', () => {
    _activePreset = 'custom';
    container.querySelectorAll('.quick-presets .chip').forEach(c => c.classList.toggle('active', c.dataset.preset === 'custom'));
    if (validateDateRange(container)) {
      const fromVal = container.querySelector('#sync-from-date')?.value || '';
      const toVal = container.querySelector('#sync-to-date')?.value || '';
      persistDateRangeSettings({ activePreset: 'custom', customStartDate: fromVal, customEndDate: toVal });
    }
  });

  container.querySelector('#sync-to-date')?.addEventListener('input', () => {
    _activePreset = 'custom';
    container.querySelectorAll('.quick-presets .chip').forEach(c => c.classList.toggle('active', c.dataset.preset === 'custom'));
    if (validateDateRange(container)) {
      const fromVal = container.querySelector('#sync-from-date')?.value || '';
      const toVal = container.querySelector('#sync-to-date')?.value || '';
      persistDateRangeSettings({ activePreset: 'custom', customStartDate: fromVal, customEndDate: toVal });
    }
  });

  // Range Sync button
  container.querySelector('#btn-sync-range')?.addEventListener('click', async (e) => {
    const fromVal = container.querySelector('#sync-from-date')?.value;
    const toVal = container.querySelector('#sync-to-date')?.value;
    if (!validateDateRange(container)) return;
    persistDateRangeSettings({ activePreset: _activePreset, customStartDate: fromVal, customEndDate: toVal });
    await executeSync(container, { startDate: fromVal, endDate: toVal });
  });

  // Incremental Sync button
  container.querySelector('#btn-sync-incremental')?.addEventListener('click', async () => {
    await executeSync(container, { incremental: true });
  });

  // Refresh page button
  container.querySelector('#btn-refresh-gmail-page')?.addEventListener('click', async () => {
    await checkConnectionStatus(container);
    await loadSyncMetrics(container);
    await renderRecentTransactions(container);
    showToast('info', 'Gmail dashboard updated.');
  });

  // View all transactions button
  container.querySelector('#btn-view-all-txns')?.addEventListener('click', () => {
    window.location.hash = '/transactions';
  });

  // Connect Gmail button on card
  container.querySelector('#btn-connect-gmail-page')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      const { authUrl } = await initiateGmailConnect();
      if (!authUrl) throw new Error('Google OAuth is not configured on the server.');
      window.location.href = authUrl;
    } catch (err) {
      showToast('error', err.message || 'Could not initiate Gmail connection');
      btn.disabled = false;
      btn.textContent = 'Connect Gmail';
    }
  });
}

// ─── Connection Status Check ──────────────────────────────────

async function checkConnectionStatus(container) {
  const emailEl = container.querySelector('#gmail-account-email');
  const badgeEl = container.querySelector('#gmail-account-badge');
  const promptEl = container.querySelector('#gmail-connect-prompt');

  try {
    const status = await getGmailConnectionStatus();
    if (status.connected) {
      if (emailEl) emailEl.textContent = status.googleAccountEmail || 'Connected';
      if (badgeEl) badgeEl.innerHTML = `<span class="badge badge-success" style="font-size:11px;">✓ Connected</span>`;
      if (promptEl) promptEl.style.display = 'none';
    } else {
      if (emailEl) emailEl.textContent = 'Not Connected';
      if (badgeEl) badgeEl.innerHTML = `<span class="badge badge-neutral" style="font-size:11px;">Not Connected</span>`;
      if (promptEl) promptEl.style.display = 'block';
    }
  } catch (err) {
    if (emailEl) emailEl.textContent = 'Unavailable';
    if (badgeEl) badgeEl.innerHTML = `<span class="badge badge-danger" style="font-size:11px;">Error</span>`;
  }
}

// ─── Sync Execution ───────────────────────────────────────────

async function executeSync(container, { startDate, endDate, incremental = false } = {}) {
  if (_isSyncing) return;
  _isSyncing = true;

  const syncRangeBtn = container.querySelector('#btn-sync-range');
  const syncIncBtn = container.querySelector('#btn-sync-incremental');
  const progressSec = container.querySelector('#gmail-progress-section');
  const progressTitle = container.querySelector('#gmail-progress-title');
  const progressDetail = container.querySelector('#gmail-progress-detail');
  const progressBar = container.querySelector('#gmail-progress-bar');
  const quotaBanner = container.querySelector('#gmail-quota-banner');
  const quotaMsg = container.querySelector('#gmail-quota-message');

  if (syncRangeBtn) { syncRangeBtn.disabled = true; syncRangeBtn.classList.add('loading'); }
  if (syncIncBtn) { syncIncBtn.disabled = true; }
  if (quotaBanner) quotaBanner.style.display = 'none';
  if (progressSec) progressSec.style.display = 'block';

  const updateProgress = ({ title, detail, pct }) => {
    if (progressTitle) progressTitle.textContent = title;
    if (progressDetail) progressDetail.textContent = detail;
    if (progressBar && pct !== undefined) progressBar.style.width = `${pct}%`;
  };

  updateProgress({ title: '🔍 Searching Gmail…', detail: incremental ? 'Checking for new financial messages…' : `Querying emails for ${startDate} to ${endDate}…`, pct: 15 });

  try {
    let result;
    if (incremental) {
      result = await syncGmail({
        force: false,
        onProgress: (p) => {
          handleSyncProgress(p, updateProgress);
        },
      });
    } else {
      result = await syncGmailDateRange({
        startDate,
        endDate,
        onProgress: (p) => {
          handleSyncProgress(p, updateProgress);
        },
      });
    }

    if (result.success) {
      updateProgress({
        title: '✓ Sync Complete',
        detail: `Added ${result.newTransactions || 0} transactions · Skipped ${result.duplicatesSkipped || 0} duplicates`,
        pct: 100,
      });

      const parts = [];
      if (result.newTransactions > 0) parts.push(`${result.newTransactions} added`);
      if (result.duplicatesSkipped > 0) parts.push(`${result.duplicatesSkipped} duplicate${result.duplicatesSkipped !== 1 ? 's' : ''} skipped`);
      if (result.needsReview > 0) parts.push(`${result.needsReview} need review`);

      const summaryText = parts.length > 0
        ? `✓ Sync complete: ${parts.join(' · ')}`
        : '✓ Sync complete: No new transactions found';

      showToast('success', summaryText);

      // Refresh stats & recent transactions
      await loadSyncMetrics(container);
      await renderRecentTransactions(container);

      // Refresh global app sync status pill
      try {
        const { refreshDashboard } = await import('../services/dashboardService.js');
        refreshDashboard?.();
      } catch (_) {}

    } else {
      // Failure or Quota limit
      if (result.isQuotaExceeded) {
        updateProgress({ title: '⏳ Quota Limited', detail: 'Google temporarily rate-limited retrieval.', pct: 100 });
        if (quotaBanner) {
          if (quotaMsg) quotaMsg.textContent = result.error || 'Google temporarily limited Gmail requests. Some emails are pending and can be processed during the next sync.';
          quotaBanner.style.display = 'block';
        }
        showToast('info', result.error || 'Gmail requests temporarily limited by Google.');
      } else if (result.needsReauth) {
        updateProgress({ title: '❌ Auth Required', detail: 'Please reconnect your Gmail account.', pct: 100 });
        showToast('error', result.error || 'Gmail authorization expired. Please reconnect in Settings.');
      } else {
        updateProgress({ title: '❌ Sync Failed', detail: result.error || 'Failed to complete sync.', pct: 100 });
        showToast('error', result.error || 'Gmail sync failed. Please try again.');
      }
      await loadSyncMetrics(container);
    }
  } catch (err) {
    updateProgress({ title: '❌ Unexpected Error', detail: err.message || 'Sync failed', pct: 100 });
    showToast('error', err.message || 'An unexpected error occurred during sync');
  } finally {
    _isSyncing = false;
    if (syncRangeBtn) { syncRangeBtn.disabled = false; syncRangeBtn.classList.remove('loading'); }
    if (syncIncBtn) { syncIncBtn.disabled = false; }
    validateDateRange(container);

    // Hide progress bar after 6 seconds
    setTimeout(() => {
      if (progressSec) progressSec.style.display = 'none';
    }, 6000);
  }
}

function handleSyncProgress(p, updateProgress) {
  switch (p.status) {
    case 'starting':
      updateProgress({ title: '🔍 Searching Gmail…', detail: p.message, pct: 25 });
      break;
    case 'preparing':
      updateProgress({ title: '🔍 Checking local records…', detail: p.message, pct: 40 });
      break;
    case 'fetching':
      updateProgress({ title: '📥 Fetching & extracting…', detail: p.message, pct: 65 });
      break;
    case 'storing':
      updateProgress({ title: '💾 Saving transactions…', detail: p.message, pct: 85 });
      break;
    case 'done':
      updateProgress({ title: '✓ Sync complete', detail: p.message, pct: 100 });
      break;
    default:
      updateProgress({ title: '⏳ Syncing…', detail: p.message || 'Processing…', pct: 50 });
  }
}

// ─── Sync Metrics Summary ─────────────────────────────────────

async function loadSyncMetrics(container) {
  const lastSyncTimeEl = container.querySelector('#gmail-last-sync-time');
  const foundEl = container.querySelector('#metric-found');
  const processedEl = container.querySelector('#metric-processed');
  const addedEl = container.querySelector('#metric-added');
  const skippedEl = container.querySelector('#metric-skipped');
  const reviewEl = container.querySelector('#metric-review');

  try {
    const lastSync = await getLastSyncTime();
    if (lastSyncTimeEl) {
      if (lastSync) {
        const d = new Date(lastSync);
        lastSyncTimeEl.textContent = `Last Sync: ${formatDateTime(d)}`;
      } else {
        lastSyncTimeEl.textContent = 'Last Sync: Never';
      }
    }

    const stats = await getLastSyncStats();
    if (stats) {
      if (foundEl) foundEl.textContent = String(stats.messagesFound ?? 0);
      if (processedEl) processedEl.textContent = String(stats.messagesFetched ?? 0);
      if (addedEl) addedEl.textContent = String(stats.newTransactions ?? 0);
      if (skippedEl) skippedEl.textContent = String(stats.duplicatesSkipped ?? 0);
      if (reviewEl) reviewEl.textContent = String(stats.needsReview ?? 0);
    }
  } catch (_) {}
}

function formatDateTime(d) {
  if (isNaN(d.getTime())) return 'Never';
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const mins = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${mins} ${ampm}`;
}

// ─── Recent Imported Transactions ─────────────────────────────

async function renderRecentTransactions(container) {
  const listEl = container.querySelector('#recent-gmail-txns-container');
  if (!listEl) return;

  try {
    const db = getDB();
    // Query local canonical transactions where source === 'gmail'
    const txns = await db.transactions
      .where('source')
      .equals('gmail')
      .reverse()
      .sortBy('date');

    const validTxns = txns.filter(t => !t.deletedAt).slice(0, 15);

    if (validTxns.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:var(--space-6) 0;">
          <div style="font-size:2rem;margin-bottom:var(--space-2);">📬</div>
          <div class="text-sm font-semibold">No Gmail transactions imported yet</div>
          <div class="text-xs text-muted" style="margin-top:2px;">Select a date range above and click "Sync Gmail" to fetch your financial emails.</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="table-responsive" style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="border-bottom:1px solid var(--color-border);text-align:left;color:var(--color-text-muted);">
              <th style="padding:var(--space-2) var(--space-1);font-weight:600;">DATE</th>
              <th style="padding:var(--space-2) var(--space-1);font-weight:600;">MERCHANT / PAYEE</th>
              <th style="padding:var(--space-2) var(--space-1);font-weight:600;">PAYMENT</th>
              <th style="padding:var(--space-2) var(--space-1);font-weight:600;">STATUS</th>
              <th style="padding:var(--space-2) var(--space-1);text-align:right;font-weight:600;">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            ${validTxns.map(t => {
              const isIncome = t.type === 'income';
              const dateOnly = t.date ? t.date.substring(0, 10) : '—';
              const isLowConfidence = t.confidence !== undefined && t.confidence < 0.5;
              return `
                <tr style="border-bottom:1px solid var(--color-border-subtle);transition:background var(--transition-fast);">
                  <td style="padding:var(--space-2) var(--space-1);font-family:var(--font-mono);white-space:nowrap;">${dateOnly}</td>
                  <td style="padding:var(--space-2) var(--space-1);max-width:180px;" class="truncate" title="${escapeHtml(t.merchant || t.description || 'Transaction')}">
                    <span style="font-weight:500;">${escapeHtml(t.merchant || t.description || 'Transaction')}</span>
                  </td>
                  <td style="padding:var(--space-2) var(--space-1);white-space:nowrap;">
                    <span class="badge badge-neutral" style="font-size:9px;text-transform:uppercase;">${t.paymentMethod || 'other'}</span>
                  </td>
                  <td style="padding:var(--space-2) var(--space-1);white-space:nowrap;">
                    ${isLowConfidence
                      ? `<span class="badge badge-warning" style="font-size:9px;">Review</span>`
                      : `<span class="badge badge-success" style="font-size:9px;">Verified</span>`}
                  </td>
                  <td style="padding:var(--space-2) var(--space-1);text-align:right;font-family:var(--font-mono);font-weight:600;white-space:nowrap;" class="${isIncome ? 'text-income' : 'text-expense'}">
                    ${formatCurrency(t.amount / 100, { sign: isIncome ? '+' : '-' })}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    listEl.innerHTML = `
      <div class="text-xs text-muted" style="text-align:center;padding:var(--space-4);">
        Could not load recent transactions.
      </div>
    `;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function iconRefresh() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
}
