// ============================================================
// AI Action Handler — Centralized Controlled Execution Layer
// ============================================================
//
// ARCHITECTURE:
//   GEMINI  →  { action: { type, ...params } }
//              ↓
//   handleAIAction(action)    ← THIS FILE
//              ↓
//   1. Validate action type (allowlist)
//   2. Validate action parameters (allowlist per type)
//   3. Call the appropriate app function
//   4. Return { success, message }
//              ↓
//   Application executes (navigate / IndexedDB write / etc.)
//
// SECURITY RULES:
//   • Never execute arbitrary code or eval()
//   • Never allow arbitrary URLs
//   • Never give Gemini direct browser/DOM access
//   • All allowed types and targets are explicitly whitelisted here
//   • Unknown types or targets are REJECTED — never silently passed through
//   • Gemini sends amounts in RUPEES; this handler converts to PAISE before writing
// ============================================================

import { navigate } from '../router.js';
import { renderPage } from '../app.js';
import {
  addTransaction,
  deleteTransaction,
  updateTransaction,
} from './transactionStore.js';

// ─── Allowed Navigation Targets ──────────────────────────────
//
// Maps every AI-facing name to the internal page ID used by
// renderPage() and router.js. Any name NOT in this map is rejected.
//
const NAVIGATE_TARGET_MAP = {
  // Primary targets
  dashboard:        'dashboard',
  chat:             'chat',
  transactions:     'transactions',
  reports:          'reports',
  settings:         'settings',

  // Aliases for "statements" page
  statements:       'statements',
  'income-statement': 'statements',
  income_statement: 'statements',
  statement:        'statements',

  // Common user aliases → mapped to canonical pages
  home:             'dashboard',
  overview:         'dashboard',
  summary:          'dashboard',
  expenses:         'transactions',
  history:          'transactions',
  analytics:        'reports',
  report:           'reports',
  preference:       'settings',
  preferences:      'settings',
  config:           'settings',
  // Receipt targets
  receipt:          'receipts',
  receipts:         'receipts',
  'scan-receipt':   'receipts',
  scan_receipt:     'receipts',
  scanner:          'receipts',
};

// ─── Allowed Action Types ─────────────────────────────────────

const ALLOWED_ACTION_TYPES = new Set([
  'navigate',
  'create_transaction',
  'delete_transaction',
  'update_transaction',
  'generate_report',
  'generate_statement',
  'generate_income_statement',
]);

// ─── Transaction Validation Constants ─────────────────────────

/** Types Gemini can specify. Anything else is rejected. */
const ALLOWED_TXN_TYPES = new Set(['income', 'expense']);

/** Payment methods Gemini can specify. Anything else → default 'upi'. */
const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'upi', 'card', 'bank']);

/** Fields that update_transaction is allowed to change. */
const ALLOWED_UPDATE_FIELDS = new Set([
  'amount', 'category', 'description', 'paymentMethod', 'date', 'type',
]);

// ─── Action Result Helpers ────────────────────────────────────

function success(message, extra = {}) {
  return { success: true, message, ...extra };
}

function failure(message) {
  return { success: false, message };
}

// ─── Core Handler ─────────────────────────────────────────────

/**
 * handleAIAction
 *
 * The ONLY entry point from the AI response to the application.
 * Validates the action against explicit allowlists before executing.
 * Returns a Promise so that async handlers (delete/update confirmations)
 * work uniformly.
 *
 * @param {object} action  - Structured action from AI (type + params)
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function handleAIAction(action) {
  // 1. Basic structural guard
  if (!action || typeof action !== 'object') {
    return failure('Invalid action: expected an object.');
  }

  const { type } = action;

  // 2. Validate action type against allowlist
  if (!type || typeof type !== 'string') {
    return failure('Invalid action: missing "type" field.');
  }

  if (!ALLOWED_ACTION_TYPES.has(type)) {
    console.warn(`[AIActionHandler] Rejected unknown action type: "${type}"`);
    return failure(`Action type "${type}" is not supported.`);
  }

  // 3. Dispatch to specific handler
  switch (type) {
    case 'navigate':
      return handleNavigate(action);

    case 'create_transaction':
      return handleCreateTransaction(action);

    case 'delete_transaction':
      return handleDeleteTransaction(action);

    case 'update_transaction':
      return handleUpdateTransaction(action);

    case 'generate_report':
      return handleGenerateReport(action);

    case 'generate_statement':
    case 'generate_income_statement':
      return handleGenerateStatement(action);

    default:
      // Safety net — should never be reached due to allowlist check above
      return failure(`Unhandled action type: "${type}"`);
  }
}

// ─── Navigate Handler ─────────────────────────────────────────

/**
 * Validates the navigation target against the explicit allowlist map
 * and delegates to the existing app navigation system.
 * Never creates a second router — reuses navigate() + renderPage().
 *
 * @param {{ type: string, target?: string, page?: string }} action
 * @returns {{ success: boolean, message: string }}
 */
async function handleNavigate(action) {
  // Accept both `target` and `page` for compatibility with AI output variations
  const rawTarget = (action.target || action.page || '').toString().trim().toLowerCase();

  if (!rawTarget) {
    return failure('Navigate action is missing a "target" or "page" field.');
  }

  // Look up in allowlist map — ONLY map entries are accepted
  const resolvedPage = NAVIGATE_TARGET_MAP[rawTarget];

  if (!resolvedPage) {
    console.warn(`[AIActionHandler] Rejected unknown navigation target: "${rawTarget}"`);
    return failure(`"${rawTarget}" is not a recognized page. Try: dashboard, transactions, reports, settings, statements, or chat.`);
  }

  if (resolvedPage === 'receipts') {
    try {
      const appModule = await import('../app.js');
      if (typeof appModule.showReceiptUpload === 'function') {
        appModule.showReceiptUpload();
        console.info('[AIActionHandler] Opened receipt scanner');
        return success('Opened receipt scanner.');
      } else {
        console.warn('[AIActionHandler] showReceiptUpload not available');
        return failure('Receipt scanner could not be opened. Please use the + button instead.');
      }
    } catch (err) {
      console.error('[AIActionHandler] Failed to open receipt scanner:', err);
      return failure('Receipt scanner could not be opened: ' + err.message);
    }
  }

  // Delegate to the app's existing navigation system
  // navigate() updates the hash URL; renderPage() renders the content
  navigate(`/${resolvedPage}`);
  renderPage(resolvedPage);

  console.info(`[AIActionHandler] Navigated to: ${resolvedPage} (from AI target: "${rawTarget}")`);
  return success(`Navigated to ${resolvedPage}.`);
}

// ─── Create Transaction Handler ───────────────────────────────

/**
 * Validates the transaction payload from Gemini, converts the amount
 * from RUPEES → PAISE (×100, integer), and writes to IndexedDB via
 * the existing addTransaction() store function.
 *
 * Gemini always sends amounts in rupees (e.g. 500).
 * IndexedDB always stores amounts in paise (e.g. 50000).
 * This is the ONLY place the conversion happens for AI-originated txns.
 *
 * @param {{ transaction: object }} action
 * @returns {Promise<{ success: boolean, message: string, txn?: object }>}
 */
async function handleCreateTransaction(action) {
  const raw = action.transaction;

  if (!raw || typeof raw !== 'object') {
    return failure('create_transaction: missing "transaction" object.');
  }

  // — Validate type —
  const type = (raw.type || '').toString().toLowerCase().trim();
  if (!ALLOWED_TXN_TYPES.has(type)) {
    return failure(`create_transaction: invalid type "${raw.type}". Must be "income" or "expense".`);
  }

  // — Validate and convert amount (rupees → paise) —
  const rawAmount = Number(raw.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return failure(`create_transaction: invalid amount "${raw.amount}". Must be a positive number.`);
  }
  // Integer paise — no floating-point financial arithmetic
  const amountPaise = Math.round(rawAmount * 100);

  // — Validate category (required) —
  const category = (raw.category || '').toString().trim();
  if (!category) {
    return failure('create_transaction: "category" is required. The AI should have asked the user for it.');
  }
  // Capitalise first letter, lowercase the rest for consistency
  const normCategory = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();

  // — Validate paymentMethod (optional, default 'upi') —
  const rawMethod = (raw.paymentMethod || 'upi').toString().toLowerCase().trim();
  const paymentMethod = ALLOWED_PAYMENT_METHODS.has(rawMethod) ? rawMethod : 'upi';

  // — Parse date —
  // Gemini may send: "today", a YYYY-MM-DD string, or omit it.
  let date;
  if (!raw.date || raw.date === 'today') {
    date = new Date().toISOString();
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    // Use local noon to avoid UTC-day-shift issues
    const d = new Date(`${raw.date}T12:00:00`);
    date = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } else {
    // Unexpected format — fall back to now
    date = new Date().toISOString();
  }

  const description = (raw.description || normCategory).toString().trim();

  const txn = {
    id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    amount:        amountPaise,   // ← paise
    type,
    category:      normCategory,
    description,
    merchant:      raw.merchant || description,
    paymentMethod,
    source:        'ai',
    date,
    createdAt:     new Date().toISOString(),
  };

  try {
    const added = await addTransaction(txn);
    if (!added) {
      return failure('Transaction could not be saved (possible duplicate ID — please try again).');
    }
    const rupeesDisplay = (amountPaise / 100).toLocaleString('en-IN');
    console.info(`[AIActionHandler] Transaction created: ${txn.id} | ₹${rupeesDisplay} | ${type} | ${normCategory}`);
    return success(
      `Saved: ${type === 'expense' ? 'Expense' : 'Income'} ₹${rupeesDisplay} · ${normCategory} · ${paymentMethod.toUpperCase()}`,
      { txn },
    );
  } catch (err) {
    console.error('[AIActionHandler] addTransaction failed:', err);
    return failure(`Failed to save transaction: ${err.message}`);
  }
}

// ─── Delete Transaction Handler ───────────────────────────────

/**
 * Soft-deletes a transaction identified by transactionId.
 * ALWAYS shows a window.confirm() dialog before executing.
 * If the user cancels, the action is aborted and the transaction is safe.
 *
 * @param {{ transactionId: string, description?: string }} action
 * @returns {Promise<{ success: boolean, message: string, cancelled?: boolean }>}
 */
async function handleDeleteTransaction(action) {
  const { transactionId, description } = action;

  if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
    return failure('delete_transaction: "transactionId" is required.');
  }

  const displayDesc = description
    ? `"${description}"`
    : `transaction ID: ${transactionId}`;

  const confirmed = window.confirm(
    `Delete transaction?\n\n${displayDesc}\n\nThe transaction will be marked as deleted. This can be recovered from the database if needed.`
  );

  if (!confirmed) {
    console.info('[AIActionHandler] Delete cancelled by user:', transactionId);
    return { success: false, message: 'Deletion cancelled.', cancelled: true };
  }

  try {
    await deleteTransaction(transactionId.trim());
    console.info('[AIActionHandler] Transaction deleted (soft):', transactionId);
    return success(`Deleted: ${displayDesc}`);
  } catch (err) {
    console.error('[AIActionHandler] deleteTransaction failed:', err);
    return failure(`Failed to delete transaction: ${err.message}`);
  }
}

// ─── Update Transaction Handler ───────────────────────────────

/**
 * Updates specific fields of an existing transaction.
 * Validates that only allowed fields are changed; converts amount
 * from rupees → paise if it is being updated.
 * ALWAYS shows a window.confirm() dialog before executing.
 *
 * @param {{ transactionId: string, changes: object, description?: string }} action
 * @returns {Promise<{ success: boolean, message: string, cancelled?: boolean }>}
 */
async function handleUpdateTransaction(action) {
  const { transactionId, changes, description } = action;

  if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
    return failure('update_transaction: "transactionId" is required.');
  }
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
    return failure('update_transaction: "changes" object is required and must not be empty.');
  }

  // — Allowlist check: only approved fields may be changed —
  const badFields = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.has(k));
  if (badFields.length > 0) {
    return failure(`update_transaction: rejected — unknown field(s): ${badFields.join(', ')}`);
  }

  // — Deep-validate + normalise each change —
  const sanitised = { ...changes };

  if ('amount' in sanitised) {
    const n = Number(sanitised.amount);
    if (!Number.isFinite(n) || n <= 0) {
      return failure(`update_transaction: invalid amount "${sanitised.amount}".`);
    }
    sanitised.amount = Math.round(n * 100); // rupees → paise
  }

  if ('type' in sanitised) {
    const t = (sanitised.type || '').toString().toLowerCase();
    if (!ALLOWED_TXN_TYPES.has(t)) {
      return failure(`update_transaction: invalid type "${sanitised.type}".`);
    }
    sanitised.type = t;
  }

  if ('paymentMethod' in sanitised) {
    const m = (sanitised.paymentMethod || '').toString().toLowerCase();
    if (!ALLOWED_PAYMENT_METHODS.has(m)) {
      return failure(`update_transaction: invalid paymentMethod "${sanitised.paymentMethod}".`);
    }
    sanitised.paymentMethod = m;
  }

  if ('category' in sanitised && sanitised.category) {
    const c = sanitised.category.toString().trim();
    sanitised.category = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
  }

  if ('date' in sanitised) {
    if (!sanitised.date || sanitised.date === 'today') {
      sanitised.date = new Date().toISOString();
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(sanitised.date)) {
      const d = new Date(`${sanitised.date}T12:00:00`);
      sanitised.date = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
  }

  // — Build human-readable change summary for the dialog —
  const changeSummary = Object.entries(sanitised)
    .map(([k, v]) => {
      if (k === 'amount') return `amount: ₹${(v / 100).toLocaleString('en-IN')}`;
      return `${k}: ${v}`;
    })
    .join(', ');

  const displayDesc = description
    ? `"${description}"`
    : `transaction ID: ${transactionId}`;

  const confirmed = window.confirm(
    `Update transaction?\n\n${displayDesc}\n\nChanges: ${changeSummary}\n\nConfirm?`
  );

  if (!confirmed) {
    console.info('[AIActionHandler] Update cancelled by user:', transactionId);
    return { success: false, message: 'Update cancelled.', cancelled: true };
  }

  try {
    await updateTransaction(transactionId.trim(), sanitised);
    console.info('[AIActionHandler] Transaction updated:', transactionId, sanitised);
    return success(`Updated ${displayDesc}: ${changeSummary}`);
  } catch (err) {
    console.error('[AIActionHandler] updateTransaction failed:', err);
    return failure(`Failed to update transaction: ${err.message}`);
  }
}

// ─── Generate Report Handler ──────────────────────────────────

/**
 * Handles report generation requests.
 * Resolves period (daily, monthly, 6month, annual, custom),
 * navigates to /reports via Task 1 router, and triggers report rendering.
 *
 * @param {{ type: string, period?: string, startDate?: string, endDate?: string, from?: string, to?: string }} action
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function handleGenerateReport(action) {
  const rawPeriod = (action.period || '').toString().toLowerCase().trim();
  const startDate = action.startDate || action.from || '';
  const endDate = action.endDate || action.to || '';

  let tab = 'monthly';
  let customRange = null;
  let label = 'Monthly';

  if (rawPeriod === 'daily' || rawPeriod === 'today') {
    tab = 'daily';
    label = 'Today';
  } else if (rawPeriod === 'monthly' || rawPeriod === 'month' || rawPeriod === 'this_month') {
    tab = 'monthly';
    label = 'This Month';
  } else if (rawPeriod === '6month' || rawPeriod === '6-month' || rawPeriod === '6_month' || rawPeriod === 'six_month' || rawPeriod === '3month') {
    tab = '6month';
    label = 'Last 6 Months';
  } else if (rawPeriod === 'annual' || rawPeriod === 'year' || rawPeriod === 'this_year' || rawPeriod === 'yearly') {
    tab = 'annual';
    label = 'This Year';
  } else if (rawPeriod === 'custom' || (startDate && endDate)) {
    tab = 'custom';
    const todayStr = new Date().toISOString().split('T')[0];
    const fromStr = startDate || todayStr;
    const toStr = endDate || todayStr;
    customRange = { from: fromStr, to: toStr };
    label = `${fromStr} to ${toStr}`;
  }

  // Navigate to reports using Task 1 router and render with resolved options
  navigate('/reports');
  renderPage('reports', { tab, customRange });

  console.info(`[AIActionHandler] Generated report: ${label} (tab: ${tab})`);
  return success(`Generated and displayed ${label} report.`);
}

// ─── Generate Statement Handler ───────────────────────────────

/**
 * Handles income statement & PDF download requests.
 * Resolves the requested period into dates, invokes the existing
 * generateStatement() PDF service, and navigates to the statements page.
 *
 * @param {{ type: string, period?: string, startDate?: string, endDate?: string, from?: string, to?: string, label?: string }} action
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function handleGenerateStatement(action) {
  const rawPeriod = (action.period || 'monthly').toString().toLowerCase().trim();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  let startDate = action.startDate || action.from;
  let endDate = action.endDate || action.to;
  let label = action.label || '';

  if (!startDate || !endDate) {
    if (rawPeriod === '3month' || rawPeriod === '3-month') {
      startDate = new Date(y, m - 2, 1).toISOString().split('T')[0];
      endDate = new Date(y, m + 1, 0).toISOString().split('T')[0];
      if (!label) label = 'Last 3 Months';
    } else if (rawPeriod === '6month' || rawPeriod === '6-month' || rawPeriod === '6_month' || rawPeriod === 'six_month') {
      startDate = new Date(y, m - 5, 1).toISOString().split('T')[0];
      endDate = new Date(y, m + 1, 0).toISOString().split('T')[0];
      if (!label) label = 'Last 6 Months';
    } else if (rawPeriod === 'annual' || rawPeriod === 'year' || rawPeriod === 'this_year' || rawPeriod === 'yearly') {
      startDate = new Date(y, 0, 1).toISOString().split('T')[0];
      endDate = new Date(y, 11, 31).toISOString().split('T')[0];
      if (!label) label = `Year ${y}`;
    } else {
      // Default: monthly
      startDate = new Date(y, m, 1).toISOString().split('T')[0];
      endDate = new Date(y, m + 1, 0).toISOString().split('T')[0];
      if (!label) label = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    }
  } else if (!label) {
    label = `${startDate} to ${endDate}`;
  }

  try {
    const { generateStatement } = await import('./pdfService.js');
    await generateStatement(startDate, endDate, label);
    navigate('/statements');
    renderPage('statements');
    console.info(`[AIActionHandler] Income statement generated & downloaded for: ${label}`);
    return success(`Downloaded ${label} income statement PDF.`);
  } catch (err) {
    console.error('[AIActionHandler] generateStatement failed:', err);
    return failure(`Failed to generate statement: ${err.message}`);
  }
}


