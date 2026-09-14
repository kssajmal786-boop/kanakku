// ============================================================
// Gmail Sync Service
// ============================================================
// Coordinates between:
//   1. Backend POST /gmail/sync  (fetches & parses emails)
//   2. Local IndexedDB           (stores canonical transactions)
//
// The server never persists transactions. It only processes
// emails and returns parsed transaction objects.
// ============================================================

import { api } from './apiClient.js';
import { getDB } from './db.js';
import { addTransactions, getDedupSignals } from './transactionStore.js';

const SYNC_META_KEY = 'gmail_sync';

// ─── Sync State Helpers ────────────────────────────────────────

async function getSyncMeta() {
  const db = getDB();
  try {
    const meta = await db.syncMeta.get(SYNC_META_KEY);
    return meta || { key: SYNC_META_KEY, historyId: null, lastSyncAt: null, totalSynced: 0 };
  } catch (_) {
    return { key: SYNC_META_KEY, historyId: null, lastSyncAt: null, totalSynced: 0 };
  }
}

async function saveSyncMeta(updates) {
  const db = getDB();
  const current = await getSyncMeta();
  await db.syncMeta.put({ ...current, ...updates, key: SYNC_META_KEY });
}

export async function getLastSyncTime() {
  const meta = await getSyncMeta();
  return meta.lastSyncAt;
}

export async function getLastSyncStats() {
  const meta = await getSyncMeta();
  return meta.lastSyncStats || null;
}

// ─── Date Range Sync ───────────────────────────────────────────

/**
 * Synchronize Gmail financial transactions within a specific date range [startDate, endDate].
 *
 * @param {object} params
 * @param {string} params.startDate YYYY-MM-DD
 * @param {string} params.endDate   YYYY-MM-DD
 * @param {Function} [params.onProgress]
 * @param {string} [params.query]
 * @param {boolean} [params.useGemini=true]
 * @returns {Promise<object>}
 */
export async function syncGmailDateRange({
  startDate,
  endDate,
  onProgress,
  query,
  useGemini = true,
} = {}) {
  const progress = (msg) => { if (onProgress) onProgress(msg); };

  // Validate dates
  if (!startDate || !endDate) {
    return {
      success: false,
      error: 'Start and end dates are required.',
      errorCode: 'INVALID_DATE_RANGE',
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return {
      success: false,
      error: 'Dates must follow YYYY-MM-DD format.',
      errorCode: 'INVALID_DATE_FORMAT',
    };
  }
  if (startDate > endDate) {
    return {
      success: false,
      error: 'Start date must be before or equal to end date.',
      errorCode: 'INVALID_DATE_RANGE',
    };
  }

  progress({ status: 'starting', message: `Searching Gmail for ${startDate} to ${endDate}...` });

  // Deduplication signals
  progress({ status: 'preparing', message: 'Checking existing transactions...' });
  let existingSignals = [];
  try {
    existingSignals = await getDedupSignals();
  } catch (_) {}

  progress({
    status: 'fetching',
    message: `Searching financial emails from ${startDate} to ${endDate}...`,
  });

  let searchResult;
  try {
    searchResult = await api.post('/gmail/search-transactions', {
      startDate,
      endDate,
      query,
      existingTransactions: existingSignals.slice(0, 1000),
      useGemini,
    });
  } catch (err) {
    if (err.message.includes('GMAIL_AUTH_EXPIRED') || err.message.includes('auth expired')) {
      return {
        success: false,
        error: 'Gmail access expired',
        errorCode: 'AUTH_EXPIRED',
        needsReauth: true,
      };
    }
    if (err.message.includes('GMAIL_NOT_CONNECTED')) {
      return {
        success: false,
        error: 'Gmail is not connected. Please connect Gmail first in Settings.',
        errorCode: 'NOT_CONNECTED',
        needsReauth: true,
      };
    }
    if (err.message.includes('GMAIL_PERMISSION_DENIED')) {
      return {
        success: false,
        error: 'Gmail permission denied. Please reconnect Gmail.',
        errorCode: 'PERMISSION_DENIED',
        needsReauth: true,
      };
    }
    return {
      success: false,
      error: err.message || 'Gmail date-range sync failed',
      errorCode: 'SEARCH_FAILED',
    };
  }

  const {
    status = 'SUCCESS',
    transactions = [],
    count = 0,
    totalAmount = 0,
    emailsFound = 0,
    emailsFetched = 0,
    messagesFound = emailsFound,
    messagesFetched = emailsFetched,
    messagesDeferred = 0,
    duplicatesSkipped = 0,
    parseFailures = 0,
    needsReview = 0,
    extractionMethod = 'regex',
    syncedAt = new Date().toISOString(),
    syncMessage,
  } = searchResult;

  if (status === 'QUOTA_EXCEEDED') {
    progress({ status: 'done', message: 'Quota limit reached' });
    return {
      success: false,
      isQuotaExceeded: true,
      error: syncMessage || 'Google temporarily limited Gmail requests. Some emails are pending and can be processed during the next sync.',
      errorCode: 'GMAIL_QUOTA_EXCEEDED',
      messagesFound,
      messagesFetched,
      messagesDeferred,
      newTransactions: 0,
      duplicatesSkipped: 0,
      totalEmailsProcessed: messagesFetched,
      parseFailures: 0,
      needsReview: 0,
    };
  }

  if (status === 'GMAIL_AUTH_REQUIRED') {
    return {
      success: false,
      error: syncMessage || 'Gmail is not connected or authorization expired.',
      errorCode: 'AUTH_REQUIRED',
      needsReauth: true,
    };
  }

  progress({
    status: 'storing',
    message: transactions.length > 0
      ? `Found ${transactions.length} new transaction${transactions.length !== 1 ? 's' : ''}. Saving...`
      : 'No new transactions to save.',
  });

  // Store transactions locally
  let storeResult = { added: 0, skipped: 0 };
  if (transactions.length > 0) {
    try {
      storeResult = await addTransactions(transactions);
    } catch (err) {
      return {
        success: false,
        error: 'Failed to save transactions locally',
        errorCode: 'STORAGE_FAILED',
      };
    }
  }

  // Update sync metadata
  const meta = await getSyncMeta();
  await saveSyncMeta({
    lastSyncAt: syncedAt,
    totalSynced: (meta.totalSynced || 0) + storeResult.added,
    lastSyncStats: {
      messagesFound,
      messagesFetched,
      messagesDeferred,
      newTransactions: storeResult.added,
      duplicatesSkipped: duplicatesSkipped + storeResult.skipped,
      parseFailures,
      needsReview,
      startDate,
      endDate,
    },
  });

  progress({ status: 'done', message: 'Sync complete' });

  return {
    success: true,
    status,
    syncMessage,
    startDate,
    endDate,
    messagesFound,
    messagesFetched,
    messagesDeferred,
    newTransactions: storeResult.added,
    duplicatesSkipped: duplicatesSkipped + storeResult.skipped,
    parseFailures,
    needsReview,
    extractionMethod,
    syncedAt,
    totalAmount,
    totalEmailsProcessed: messagesFetched,
  };
}

// ─── Main Sync ─────────────────────────────────────────────────

/**
 * Synchronize Gmail financial emails.
 *
 * On first sync: fetches up to 90 days of financial emails.
 * On subsequent syncs: uses Gmail historyId for incremental sync.
 * If startDate and endDate are provided: uses date range sync.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force]  Force full re-sync even if historyId exists
 * @param {string} [opts.startDate] YYYY-MM-DD
 * @param {string} [opts.endDate]   YYYY-MM-DD
 * @param {Function} [opts.onProgress]  Called with progress updates
 * @returns {Promise<object>}
 */
export async function syncGmail({ force = false, startDate, endDate, onProgress, query, useGemini } = {}) {
  if (startDate && endDate) {
    return syncGmailDateRange({ startDate, endDate, onProgress, query, useGemini });
  }

  const progress = (msg) => { if (onProgress) onProgress(msg); };

  progress({ status: 'starting', message: 'Checking Gmail for financial emails...' });

  // Get current sync state
  const meta = await getSyncMeta();
  const historyId = force ? null : meta.historyId;

  // Get existing transaction dedup signals to send to server
  // (lightweight — no financial content, just IDs/amounts/dates)
  progress({ status: 'preparing', message: 'Preparing sync...' });
  let existingSignals = [];
  try {
    existingSignals = await getDedupSignals();
  } catch (_) {}

  progress({
    status: 'fetching',
    message: historyId
      ? 'Checking for new financial emails...'
      : 'Scanning your Gmail for financial emails (this may take a moment)...',
  });

  // Call backend sync endpoint
  let syncResponse;
  try {
    syncResponse = await api.post('/gmail/sync', {
      historyId: historyId || undefined,
      since: force ? undefined : (meta.lastSyncAt || undefined),
      existingTransactions: existingSignals.slice(0, 500), // cap at 500 for request size
    });
  } catch (err) {
    // Handle specific errors
    if (err.message.includes('GMAIL_AUTH_EXPIRED') || err.message.includes('auth expired')) {
      return {
        success: false,
        error: 'Gmail access expired',
        errorCode: 'AUTH_EXPIRED',
        needsReauth: true,
      };
    }
    if (err.message.includes('GMAIL_PERMISSION_DENIED')) {
      return {
        success: false,
        error: 'Gmail permission denied. Please reconnect Gmail.',
        errorCode: 'PERMISSION_DENIED',
        needsReauth: true,
      };
    }
    return {
      success: false,
      error: err.message || 'Gmail sync failed',
      errorCode: 'SYNC_FAILED',
    };
  }

  const {
    transactions = [],
    syncedAt,
    totalEmailsProcessed = 0,
    duplicatesSkipped = 0,
    parseFailures = 0,
    nextSyncToken,
    extractionMethod,
    needsReview = 0,
    status = 'completed',
    messagesFound = 0,
    messagesFetched = 0,
    messagesDeferred = 0,
    errorType,
    syncMessage,
  } = syncResponse;

  // Handle immediate quota exhaustion with 0 transactions
  if (status === 'quota_exceeded' && transactions.length === 0) {
    progress({ status: 'done', message: 'Quota limit reached' });
    return {
      success: false,
      isQuotaExceeded: true,
      error: syncMessage || 'Google temporarily limited message retrieval. Pending emails will be retrieved during the next sync.',
      errorCode: 'GMAIL_QUOTA_EXCEEDED',
      messagesFound,
      messagesFetched,
      messagesDeferred,
      newTransactions: 0,
      duplicatesSkipped: 0,
      totalEmailsProcessed: 0,
      parseFailures: 0,
    };
  }

  progress({
    status: 'storing',
    message: `Found ${transactions.length} new transaction${transactions.length !== 1 ? 's' : ''}. Saving...`,
  });

  // Store transactions locally
  let storeResult = { added: 0, skipped: 0 };
  if (transactions.length > 0) {
    try {
      storeResult = await addTransactions(transactions);
    } catch (err) {
      return {
        success: false,
        error: 'Failed to save transactions locally',
        errorCode: 'STORAGE_FAILED',
      };
    }
  }

  // Update sync metadata
  await saveSyncMeta({
    historyId: nextSyncToken || meta.historyId,
    lastSyncAt: syncedAt || new Date().toISOString(),
    totalSynced: (meta.totalSynced || 0) + storeResult.added,
    lastSyncStats: {
      messagesFound: messagesFound || totalEmailsProcessed,
      messagesFetched: messagesFetched || totalEmailsProcessed,
      messagesDeferred,
      newTransactions: storeResult.added,
      duplicatesSkipped: duplicatesSkipped + storeResult.skipped,
      parseFailures,
      needsReview,
    },
  });

  progress({ status: 'done', message: status === 'partial' ? 'Sync partially complete' : 'Sync complete' });

  return {
    success: true,
    status,
    isPartial: status === 'partial',
    isQuotaExceeded: status === 'quota_exceeded' || errorType === 'GMAIL_QUOTA_EXCEEDED',
    syncMessage,
    messagesFound: messagesFound || totalEmailsProcessed,
    messagesFetched: messagesFetched || totalEmailsProcessed,
    messagesDeferred,
    newTransactions: storeResult.added,
    duplicatesSkipped: duplicatesSkipped + storeResult.skipped,
    parseFailures,
    totalEmailsProcessed,
    syncedAt,
    isIncremental: !force && (!!historyId || !!meta.lastSyncAt),
    extractionMethod,
    needsReview,
  };
}

// ─── Auto-sync on app open ─────────────────────────────────────

let _lastAutoSync = 0;
const AUTO_SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Auto-sync if the cooldown has elapsed.
 * Call on app open and when returning to foreground.
 */
export async function autoSync(opts = {}) {
  const now = Date.now();
  if (now - _lastAutoSync < AUTO_SYNC_COOLDOWN_MS) {
    return { skipped: true, reason: 'cooldown' };
  }
  _lastAutoSync = now;
  return syncGmail(opts);
}

// ─── Page visibility sync ──────────────────────────────────────

let _visibilityBound = false;

/**
 * Set up automatic sync when the app returns to the foreground.
 * Safe to call multiple times.
 */
export function setupAutoSyncOnFocus(onSyncComplete) {
  if (_visibilityBound) return;
  _visibilityBound = true;

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      const result = await autoSync();
      if (onSyncComplete && !result.skipped) {
        onSyncComplete(result);
      }
    }
  });
}
