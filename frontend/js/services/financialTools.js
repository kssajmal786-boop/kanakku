// ============================================================
// Financial Tools — Controlled Data Access Layer for Kanakku AI
// ============================================================
//
// ARCHITECTURE:
//   Gemini emits  →  [TOOL_CALL: { "tool": "...", "params": {...} }]
//                    ↓
//   chatService.js  → executeFinancialTool(name, params)   ← routes here
//                    ↓
//   One of the tool functions below (all read-only, no mutations)
//                    ↓
//   Returns a plain JS object with pre-computed, deterministic results
//                    ↓
//   chatService.js  → formats result → sends back to Gemini
//
// SECURITY RULES:
//   • READ-ONLY: No function here modifies any data.
//   • No arbitrary table access — only `transactions` table via
//     existing transactionStore.js helpers.
//   • All arithmetic (totals, averages, percentages) is done here in JS.
//     Gemini receives only formatted strings or structured objects —
//     it NEVER does financial arithmetic.
//   • Amounts are converted from paise (internal) to rupees (AI-facing)
//     before returning, so Gemini always works in rupee units.
//   • Gmail tools call approved backend endpoints only — tokens are
//     NEVER returned to Gemini or logged.
//
// ALLOWED TOOLS (explicit allowlist enforced in executeFinancialTool):
//   1.  getTodaySummary
//   2.  getDateRangeSummary
//   3.  getSpendingByCategory
//   4.  getIncome
//   5.  getExpenses
//   6.  getTransactionCount
//   7.  getTransactions
//   8.  checkGmailConnection      ← Gmail tools below
//   9.  syncGmailTransactions
//   10. searchGmailTransactions
//   11. getGmailTransaction
// ============================================================

import {
  getTransactionsForRange,
  getDailySummary,
  getPeriodSummary,
  getTransactionCount as _dbCount,
  addTransactions,
} from './transactionStore.js';
import { api } from './apiClient.js';
import { syncGmail } from './gmailSync.js';

// ─── Amount Helpers ───────────────────────────────────────────

/** Convert paise (internal storage unit) to rupees for AI consumption. */
function toRupees(paise) {
  return Math.round(paise) / 100;
}

// ─── Date Helpers ──────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().substring(0, 10);
}

function monthStartStr() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().substring(0, 10);
}

/** Validate and normalise a YYYY-MM-DD string. Returns null on invalid input. */
function normaliseDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return raw;
}

// ─── Tool 1: getTodaySummary ──────────────────────────────────

/**
 * Return a complete financial summary for today.
 * Includes income, expenses, net flow, transaction count,
 * full category breakdown, and payment method breakdown.
 */
export async function getTodaySummary() {
  const date = todayStr();
  const summary = await getDailySummary(date);

  return {
    date,
    totalIncome: toRupees(summary.totalIncome),
    totalExpenses: toRupees(summary.totalExpenses),
    netCashFlow: toRupees(summary.netCashFlow),
    transactionCount: summary.transactionCount,
    incomeCount: summary.incomeCount,
    expenseCount: summary.expenseCount,
    categories: summary.topCategories.map((c) => ({
      name: c.name,
      amount: toRupees(c.amount),
      percentage: c.percentage,
    })),
    paymentMethods: summary.paymentMethods.map((m) => ({
      method: m.method,
      amount: toRupees(m.amount),
    })),
  };
}

// ─── Tool 2: getDateRangeSummary ──────────────────────────────

/**
 * Return financial totals for any custom date range.
 * Defaults to this month if startDate/endDate are omitted.
 *
 * @param {string} [startDate] YYYY-MM-DD
 * @param {string} [endDate]   YYYY-MM-DD
 */
export async function getDateRangeSummary(startDate, endDate) {
  const start = normaliseDate(startDate) || monthStartStr();
  const end = normaliseDate(endDate) || todayStr();

  const summary = await getPeriodSummary(start, end, `${start} to ${end}`);

  return {
    startDate: start,
    endDate: end,
    totalIncome: toRupees(summary.totalIncome),
    totalExpenses: toRupees(summary.totalExpenses),
    netCashFlow: toRupees(summary.netCashFlow),
    transactionCount: summary.transactionCount,
    avgDailyExpense: toRupees(summary.avgDailyExpense),
    categories: summary.topCategories.map((c) => ({
      name: c.name,
      amount: toRupees(c.amount),
      percentage: c.percentage,
    })),
    largestExpense: summary.largestExpense
      ? {
          amount: toRupees(summary.largestExpense.amount),
          description: summary.largestExpense.description,
          date: summary.largestExpense.date,
        }
      : null,
    largestIncome: summary.largestIncome
      ? {
          amount: toRupees(summary.largestIncome.amount),
          description: summary.largestIncome.description,
          date: summary.largestIncome.date,
        }
      : null,
  };
}

// ─── Tool 3: getSpendingByCategory ────────────────────────────

/**
 * Return the complete expense breakdown by category, sorted by amount.
 * Optionally filtered to a date range (defaults to this month).
 *
 * @param {string} [startDate] YYYY-MM-DD
 * @param {string} [endDate]   YYYY-MM-DD
 * @param {string} [category]  If provided, return only this category's total
 */
export async function getSpendingByCategory(startDate, endDate, category) {
  const start = normaliseDate(startDate) || monthStartStr();
  const end = normaliseDate(endDate) || todayStr();

  const txns = await getTransactionsForRange(start, end);
  const expenses = txns.filter((t) => t.type === 'expense');

  const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);

  // Build category map
  const categoryMap = {};
  for (const t of expenses) {
    const key = (t.category || 'Other').trim();
    categoryMap[key] = (categoryMap[key] || 0) + t.amount;
  }

  let categories = Object.entries(categoryMap)
    .map(([name, amount]) => ({
      name,
      amount: toRupees(amount),
      percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // If a specific category was requested, filter to just that
  if (category && typeof category === 'string') {
    const needle = category.toLowerCase().trim();
    categories = categories.filter((c) => c.name.toLowerCase().includes(needle));
  }

  return {
    startDate: start,
    endDate: end,
    totalExpenses: toRupees(totalExpenses),
    categories,
    requestedCategory: category || null,
  };
}

// ─── Tool 4: getIncome ────────────────────────────────────────

/**
 * Return total income and top income sources for a date range.
 * Defaults to this month.
 *
 * @param {string} [startDate] YYYY-MM-DD
 * @param {string} [endDate]   YYYY-MM-DD
 */
export async function getIncome(startDate, endDate) {
  const start = normaliseDate(startDate) || monthStartStr();
  const end = normaliseDate(endDate) || todayStr();

  const txns = await getTransactionsForRange(start, end);
  const income = txns.filter((t) => t.type === 'income');

  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);

  // Group by category/source
  const sourceMap = {};
  for (const t of income) {
    const key = (t.category || t.source || 'Income').trim();
    sourceMap[key] = (sourceMap[key] || 0) + t.amount;
  }

  const sources = Object.entries(sourceMap)
    .map(([name, amount]) => ({
      name,
      amount: toRupees(amount),
      percentage: totalIncome > 0 ? Math.round((amount / totalIncome) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Largest single income
  const largest = income.length
    ? income.reduce((max, t) => (t.amount > max.amount ? t : max))
    : null;

  return {
    startDate: start,
    endDate: end,
    totalIncome: toRupees(totalIncome),
    transactionCount: income.length,
    sources,
    largestIncome: largest
      ? {
          amount: toRupees(largest.amount),
          description: largest.description || largest.merchant || '',
          date: largest.date.substring(0, 10),
        }
      : null,
  };
}

// ─── Tool 5: getExpenses ──────────────────────────────────────

/**
 * Return total expenses and top spending for a date range.
 * Defaults to this month.
 *
 * @param {string} [startDate] YYYY-MM-DD
 * @param {string} [endDate]   YYYY-MM-DD
 */
export async function getExpenses(startDate, endDate) {
  const start = normaliseDate(startDate) || monthStartStr();
  const end = normaliseDate(endDate) || todayStr();

  const txns = await getTransactionsForRange(start, end);
  const expenses = txns.filter((t) => t.type === 'expense');

  const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);

  // Top individual transactions
  const topExpenses = [...expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((t) => ({
      amount: toRupees(t.amount),
      description: t.description || t.merchant || 'Transaction',
      category: t.category || 'Other',
      date: t.date.substring(0, 10),
      paymentMethod: t.paymentMethod,
    }));

  // Category breakdown
  const categoryMap = {};
  for (const t of expenses) {
    const key = (t.category || 'Other').trim();
    categoryMap[key] = (categoryMap[key] || 0) + t.amount;
  }
  const categories = Object.entries(categoryMap)
    .map(([name, amount]) => ({
      name,
      amount: toRupees(amount),
      percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    startDate: start,
    endDate: end,
    totalExpenses: toRupees(totalExpenses),
    transactionCount: expenses.length,
    categories,
    topExpenses,
  };
}

// ─── Tool 6: getTransactionCount ──────────────────────────────

/**
 * Return the count of transactions, with optional date range and type filter.
 *
 * @param {string} [startDate] YYYY-MM-DD — if omitted, counts ALL transactions
 * @param {string} [endDate]   YYYY-MM-DD
 * @param {string} [type]      'income' | 'expense' | 'transfer' | 'all'
 */
export async function getTransactionCount(startDate, endDate, type) {
  // If no date range, count all transactions globally
  if (!startDate && !endDate) {
    const total = await _dbCount();
    return {
      startDate: null,
      endDate: null,
      type: type || 'all',
      count: total,
    };
  }

  const start = normaliseDate(startDate) || monthStartStr();
  const end = normaliseDate(endDate) || todayStr();
  const txns = await getTransactionsForRange(start, end);

  const filtered = type && type !== 'all'
    ? txns.filter((t) => t.type === type)
    : txns;

  return {
    startDate: start,
    endDate: end,
    type: type || 'all',
    count: filtered.length,
    incomeCount: txns.filter((t) => t.type === 'income').length,
    expenseCount: txns.filter((t) => t.type === 'expense').length,
    transferCount: txns.filter((t) => t.type === 'transfer').length,
  };
}

// ─── Tool 7: getTransactions ──────────────────────────────────

/**
 * Return a filtered list of transactions (max 20 for AI consumption).
 *
 * @param {string} [startDate] YYYY-MM-DD
 * @param {string} [endDate]   YYYY-MM-DD
 * @param {string} [type]      'income' | 'expense' | 'transfer'
 * @param {string} [category]  category name to filter on (partial match)
 */
export async function getTransactions(startDate, endDate, type, category) {
  const start = normaliseDate(startDate) || monthStartStr();
  const end = normaliseDate(endDate) || todayStr();

  let txns = await getTransactionsForRange(start, end);

  // Type filter
  if (type && type !== 'all') {
    txns = txns.filter((t) => t.type === type);
  }

  // Category filter (partial match, case-insensitive)
  if (category && typeof category === 'string') {
    const needle = category.toLowerCase().trim();
    txns = txns.filter((t) => (t.category || '').toLowerCase().includes(needle));
  }

  // Sort newest first, cap at 20 for AI context size
  const sorted = txns
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  return {
    startDate: start,
    endDate: end,
    filters: { type: type || 'all', category: category || null },
    totalCount: txns.length,
    transactions: sorted.map((t) => ({
      date: t.date.substring(0, 10),
      amount: toRupees(t.amount),
      type: t.type,
      category: t.category || 'Other',
      description: t.description || t.merchant || '',
      paymentMethod: t.paymentMethod,
    })),
  };
}

// ─── Tool 8: checkGmailConnection ────────────────────────────

/**
 * Check whether the user has a connected Gmail account.
 * Always call this before any other Gmail tool.
 * Returns { connected, email } — never tokens.
 */
export async function checkGmailConnection() {
  try {
    const status = await api.get('/gmail/connect/status');
    return {
      connected: !!status.connected,
      email: status.googleAccountEmail || null,
      connectedAt: status.connectedAt || null,
    };
  } catch (err) {
    console.warn('[FinancialTools] checkGmailConnection failed:', err.message);
    return { connected: false, email: null };
  }
}

// ─── Tool 9: syncGmailTransactions ───────────────────────────

/**
 * Trigger a Gmail sync (reuses existing gmailSync.js pipeline).
 * Returns a summary — no raw transactions to avoid context bloat.
 *
 * @param {boolean} [force] Force full re-sync even if historyId exists
 */
export async function syncGmailTransactions(force = false) {
  // Check connection first
  const status = await checkGmailConnection();
  if (!status.connected) {
    return { gmailConnectRequired: true };
  }

  const result = await syncGmail({ force: !!force });

  if (!result.success) {
    if (result.errorCode === 'AUTH_EXPIRED' || result.needsReauth) {
      return { gmailConnectRequired: true };
    }
    return {
      success: false,
      error: result.error || 'Gmail sync failed',
    };
  }

  return {
    success: true,
    newTransactions: result.newTransactions,
    duplicatesSkipped: result.duplicatesSkipped,
    totalEmailsProcessed: result.totalEmailsProcessed,
    syncedAt: result.syncedAt,
    isIncremental: result.isIncremental,
    extractionMethod: result.extractionMethod || 'unknown',
  };
}

// ─── Tool 10: searchGmailTransactions ────────────────────────

/**
 * Search Gmail for email subjects/snippets matching a query.
 * Returns ONLY safe metadata (subject, sender, date, snippet).
 * NEVER returns email bodies or raw financial data.
 *
 * @param {string} query  Gmail search query (e.g. "salary credited")
 * @param {number} [limit] Max emails to return (1–10, default 5)
 */
export async function searchGmailTransactions(query, limit = 5) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { error: 'A search query is required.' };
  }

  const status = await checkGmailConnection();
  if (!status.connected) {
    return { gmailConnectRequired: true };
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 10);

  try {
    const result = await api.get(`/gmail/search?q=${encodeURIComponent(query.trim())}&limit=${safeLimit}`);
    return {
      query: query.trim(),
      count: result.count || 0,
      // Return only safe metadata — no email bodies
      messages: (result.messages || []).map((m) => ({
        id: m.id,
        subject: m.subject || '(no subject)',
        from: m.from || '',
        date: m.date || '',
        snippet: m.snippet || '',
      })),
    };
  } catch (err) {
    console.warn('[FinancialTools] searchGmailTransactions failed:', err.message);
    return { error: 'Gmail search failed. Please try again.', count: 0, messages: [] };
  }
}

// ─── Tool 11: getGmailTransaction ────────────────────────────

/**
 * Query locally-stored transactions that were imported from Gmail.
 * These are transactions with extractionMethod === 'gemini' in IndexedDB.
 * No network call needed — reads local IndexedDB.
 *
 * @param {string} [startDate] YYYY-MM-DD
 * @param {string} [endDate]   YYYY-MM-DD
 * @param {string} [description] Partial match on description/merchant
 * @param {string} [type]      'income' | 'expense'
 */
export async function getGmailTransaction(startDate, endDate, description, type) {
  const today = new Date().toISOString().substring(0, 10);
  const d = new Date();
  d.setDate(1);
  const monthStart = d.toISOString().substring(0, 10);

  const start = startDate || monthStart;
  const end = endDate || today;

  let txns = await getTransactionsForRange(start, end);

  // Filter to Gmail-synced (Gemini-extracted) transactions only
  txns = txns.filter((t) => t.extractionMethod === 'gemini' || t.source === 'gmail');

  // Type filter
  if (type && type !== 'all') {
    txns = txns.filter((t) => t.type === type);
  }

  // Description / merchant partial match
  if (description && typeof description === 'string') {
    const needle = description.toLowerCase().trim();
    txns = txns.filter((t) =>
      (t.description || '').toLowerCase().includes(needle) ||
      (t.merchant || '').toLowerCase().includes(needle)
    );
  }

  const sorted = txns
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  return {
    startDate: start,
    endDate: end,
    filters: { type: type || 'all', description: description || null },
    totalCount: txns.length,
    transactions: sorted.map((t) => ({
      date: (t.date || '').substring(0, 10),
      amount: toRupees(t.amount),
      type: t.type,
      category: t.category || 'Other',
      description: t.description || t.merchant || '',
      paymentMethod: t.paymentMethod,
      extractionMethod: t.extractionMethod || 'unknown',
      needsReview: !!t.needsReview,
    })),
  };
}

// ─── Tool 12: searchGmailTransactionsByDate ───────────────────

/**
 * Search Gmail for financial emails within a specific date range,
 * parse/extract canonical transactions, and persist new items into IndexedDB.
 *
 * Enforces "Ledger First, Gmail Second":
 * Checks existing local transactions to pass as deduplication signals.
 *
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate   YYYY-MM-DD
 * @param {string} [query]   Optional search terms (e.g. merchant or keywords)
 */
export async function searchGmailTransactionsByDate(startDate, endDate, query) {
  const start = normaliseDate(startDate);
  const end = normaliseDate(endDate);

  if (!start || !end) {
    return {
      status: 'FAILED',
      error: 'Invalid date format. Expected YYYY-MM-DD.',
      count: 0,
      transactions: [],
      totalAmount: 0,
    };
  }

  // 1. Check connection first
  const conn = await checkGmailConnection();
  if (!conn.connected) {
    return { gmailConnectRequired: true };
  }

  // 2. Fetch existing local transactions for this range to pass for backend deduplication
  const existingLocal = await getTransactionsForRange(start, end);

  // 3. Call backend endpoint
  try {
    const result = await api.post('/gmail/search-transactions', {
      startDate: start,
      endDate: end,
      query: query || undefined,
      existingTransactions: existingLocal,
      useGemini: true,
    });

    if (result.status === 'GMAIL_AUTH_REQUIRED') {
      return { gmailConnectRequired: true };
    }

    // 4. If new transactions found, save them into local IndexedDB
    let addedCount = 0;
    if (result.transactions && result.transactions.length > 0) {
      const storeRes = await addTransactions(result.transactions);
      addedCount = storeRes.added;
    }

    return {
      status: result.status,
      startDate: result.startDate || start,
      endDate: result.endDate || end,
      count: result.count || 0,
      totalAmount: result.totalAmount || 0,
      emailsFound: result.emailsFound || 0,
      emailsFetched: result.emailsFetched || 0,
      syncMessage: result.syncMessage,
      addedToLedger: addedCount,
      existingLocalCount: existingLocal.length,
      transactions: (result.transactions || []).map((t) => ({
        date: (t.date || '').substring(0, 10),
        amount: toRupees(t.amount),
        type: t.type,
        category: t.category || 'Other',
        description: t.description || t.merchant || '',
        paymentMethod: t.paymentMethod,
        extractionMethod: t.extractionMethod || 'unknown',
      })),
    };
  } catch (err) {
    console.error('[FinancialTools] searchGmailTransactionsByDate failed:', err);
    return {
      status: 'FAILED',
      error: err.message || 'Gmail search failed.',
      count: 0,
      transactions: [],
      totalAmount: 0,
    };
  }
}

// ─── Tool Dispatcher (Allowlist-Enforced) ─────────────────────

/**
 * Central dispatcher. Only tools in ALLOWED_TOOLS can be called.
 * Unknown tool names are rejected and an error object is returned.
 * This is the ONLY entry point — chatService.js calls this function.
 *
 * Special return: if a Gmail tool returns { gmailConnectRequired: true },
 * the dispatcher preserves it so chatService.js can show the connect prompt.
 *
 * @param {string} toolName
 * @param {object} params
 * @returns {Promise<{ success: boolean, data?: object, error?: string, gmailConnectRequired?: boolean }>}
 */

const ALLOWED_TOOLS = new Set([
  'getTodaySummary',
  'getDateRangeSummary',
  'getSpendingByCategory',
  'getIncome',
  'getExpenses',
  'getTransactionCount',
  'getTransactions',
  // Gmail tools
  'checkGmailConnection',
  'syncGmailTransactions',
  'searchGmailTransactions',
  'getGmailTransaction',
  'searchGmailTransactionsByDate',
]);

export async function executeFinancialTool(toolName, params = {}) {
  if (!ALLOWED_TOOLS.has(toolName)) {
    console.warn(`[FinancialTools] Rejected unknown tool: "${toolName}"`);
    return { success: false, error: `Tool "${toolName}" is not supported.` };
  }

  try {
    let result;

    switch (toolName) {
      case 'getTodaySummary':
        result = await getTodaySummary();
        break;

      case 'getDateRangeSummary':
        result = await getDateRangeSummary(params.startDate, params.endDate);
        break;

      case 'getSpendingByCategory':
        result = await getSpendingByCategory(params.startDate, params.endDate, params.category);
        break;

      case 'getIncome':
        result = await getIncome(params.startDate, params.endDate);
        break;

      case 'getExpenses':
        result = await getExpenses(params.startDate, params.endDate);
        break;

      case 'getTransactionCount':
        result = await getTransactionCount(params.startDate, params.endDate, params.type);
        break;

      case 'getTransactions':
        result = await getTransactions(params.startDate, params.endDate, params.type, params.category);
        break;

      // ── Gmail Tools ──────────────────────────────────────────
      case 'checkGmailConnection':
        result = await checkGmailConnection();
        break;

      case 'syncGmailTransactions':
        result = await syncGmailTransactions(params.force);
        break;

      case 'searchGmailTransactions':
        result = await searchGmailTransactions(params.query, params.limit);
        break;

      case 'getGmailTransaction':
        result = await getGmailTransaction(params.startDate, params.endDate, params.description, params.type);
        break;

      case 'searchGmailTransactionsByDate':
        result = await searchGmailTransactionsByDate(params.startDate, params.endDate, params.query);
        break;

      default:
        return { success: false, error: `Unhandled tool: "${toolName}"` };
    }

    // Special: Gmail tool indicates OAuth is needed — propagate the sentinel
    if (result && result.gmailConnectRequired) {
      console.info(`[FinancialTools] ${toolName} → Gmail not connected`);
      return { success: false, gmailConnectRequired: true, error: 'Gmail not connected' };
    }

    console.info(`[FinancialTools] ${toolName} executed successfully`, { params });
    return { success: true, data: result };

  } catch (err) {
    console.error(`[FinancialTools] ${toolName} failed:`, err);
    return { success: false, error: `Tool execution failed: ${err.message}` };
  }
}
