// ============================================================
// Transaction Store — All local transaction operations
// ============================================================
// Wraps the IndexedDB transactions store with higher-level
// operations. All amounts are in PAISE (integer).
// ============================================================

import { getDB } from './db.js';

// ─── Add / Import ─────────────────────────────────────────────

/**
 * Add a single transaction. Silently skips duplicates (by id).
 * Returns true if added, false if already exists.
 */
export async function addTransaction(txn) {
  const db = getDB();
  try {
    await db.transactions.add(txn);
    return true;
  } catch (err) {
    // Dexie throws ConstraintError on duplicate primary key
    if (err.name === 'ConstraintError') return false;
    throw err;
  }
}

/**
 * Add a batch of transactions. Returns { added, skipped }.
 * Uses individual adds so duplicates don't abort the batch.
 */
export async function addTransactions(txns) {
  if (!txns || txns.length === 0) return { added: 0, skipped: 0 };
  let added = 0;
  let skipped = 0;
  for (const txn of txns) {
    const wasAdded = await addTransaction(txn);
    if (wasAdded) added++;
    else skipped++;
  }
  return { added, skipped };
}

/**
 * Update a transaction by id. Only updates provided fields.
 */
export async function updateTransaction(id, changes) {
  const db = getDB();
  return db.transactions.update(id, {
    ...changes,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Soft-delete a transaction (marks as deleted, does not remove).
 * For permanent deletion, use hardDeleteTransaction.
 */
export async function deleteTransaction(id) {
  const db = getDB();
  return db.transactions.update(id, {
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function hardDeleteTransaction(id) {
  const db = getDB();
  return db.transactions.delete(id);
}

// ─── Queries ──────────────────────────────────────────────────

/**
 * Get all non-deleted transactions, newest first.
 */
export async function getAllTransactions() {
  const db = getDB();
  const all = await db.transactions.orderBy('date').reverse().toArray();
  return all.filter((t) => !t.deletedAt);
}

/**
 * Get transactions for a date range.
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate   YYYY-MM-DD (inclusive)
 */
export async function getTransactionsForRange(startDate, endDate) {
  const db = getDB();
  // Date field is ISO string — lexicographic comparison works for YYYY-MM-DD prefix
  const txns = await db.transactions
    .where('date')
    .between(startDate, endDate + 'T23:59:59.999Z', true, true)
    .toArray();
  return txns.filter((t) => !t.deletedAt);
}

/**
 * Get transactions for a specific calendar day.
 * @param {string} dateStr YYYY-MM-DD
 */
export async function getTransactionsForDay(dateStr) {
  return getTransactionsForRange(dateStr, dateStr);
}

/**
 * Get the most recent N transactions across all time.
 */
export async function getRecentTransactions(limit = 10) {
  const db = getDB();
  const all = await db.transactions.orderBy('date').reverse().limit(limit * 2).toArray();
  return all.filter((t) => !t.deletedAt).slice(0, limit);
}

/**
 * Get all Gmail message IDs from stored transactions.
 * Used for server-side deduplication during Gmail sync.
 */
export async function getStoredGmailIds() {
  const db = getDB();
  const txns = await db.transactions
    .filter((t) => !!t.metadata?.gmailMessageId && !t.deletedAt)
    .toArray();
  return txns.map((t) => t.metadata.gmailMessageId).filter(Boolean);
}

/**
 * Get a lightweight dedup signal array for sending to the backend.
 * Contains only non-sensitive dedup signals (no financial body content).
 */
export async function getDedupSignals() {
  const db = getDB();
  const txns = await db.transactions.filter((t) => !t.deletedAt).toArray();
  return txns.map((t) => ({
    id: t.id,
    amount: t.amount,
    date: t.date.substring(0, 10),
    paymentMethod: t.paymentMethod,
    reference: t.reference,
    merchant: t.merchant,
    gmailMessageId: t.metadata?.gmailMessageId,
  }));
}

// ─── Daily Summary ────────────────────────────────────────────

/**
 * Calculate the daily cash flow summary for a given date.
 * All amounts are returned in PAISE.
 *
 * @param {string} dateStr YYYY-MM-DD (defaults to today)
 * @returns {DailySummary}
 */
export async function getDailySummary(dateStr) {
  const date = dateStr || new Date().toISOString().substring(0, 10);
  const txns = await getTransactionsForDay(date);

  const income = txns.filter((t) => t.type === 'income');
  const expenses = txns.filter((t) => t.type === 'expense');
  // ATM withdrawals are 'transfer' — exclude from income/expense totals

  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
  const netCashFlow = totalIncome - totalExpenses;

  // Category breakdown (expenses only)
  const categoryMap = {};
  for (const t of expenses) {
    categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount;
  }
  const topCategories = Object.entries(categoryMap)
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Payment method breakdown
  const methodMap = {};
  for (const t of [...income, ...expenses]) {
    methodMap[t.paymentMethod] = (methodMap[t.paymentMethod] || 0) + t.amount;
  }
  const paymentMethods = Object.entries(methodMap)
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    date,
    totalIncome,
    totalExpenses,
    netCashFlow,
    transactionCount: txns.length,
    incomeCount: income.length,
    expenseCount: expenses.length,
    topCategories,
    paymentMethods,
    transactions: txns.sort((a, b) => new Date(b.date) - new Date(a.date)),
  };
}

// ─── Period Summary ───────────────────────────────────────────

/**
 * Calculate a summary for any date range.
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate   YYYY-MM-DD
 * @param {string} label     Human-readable label (e.g. "This Month")
 */
export async function getPeriodSummary(startDate, endDate, label = '') {
  const txns = await getTransactionsForRange(startDate, endDate);

  const income = txns.filter((t) => t.type === 'income');
  const expenses = txns.filter((t) => t.type === 'expense');

  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
  const netCashFlow = totalIncome - totalExpenses;

  // Days in period for average calculation
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailyExpense = totalExpenses / days;

  // Category breakdown
  const categoryMap = {};
  for (const t of expenses) {
    categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount;
  }
  const topCategories = Object.entries(categoryMap)
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  // Payment method breakdown
  const methodMap = {};
  for (const t of txns) {
    if (t.type !== 'transfer') {
      methodMap[t.paymentMethod] = (methodMap[t.paymentMethod] || 0) + t.amount;
    }
  }

  // Largest expense and income
  const largestExpense = expenses.length
    ? expenses.reduce((max, t) => (t.amount > max.amount ? t : max))
    : null;
  const largestIncome = income.length
    ? income.reduce((max, t) => (t.amount > max.amount ? t : max))
    : null;

  // Daily trend (for charts)
  const dailyTrend = buildDailyTrend(txns, startDate, endDate);

  return {
    label,
    startDate,
    endDate,
    totalIncome,
    totalExpenses,
    netCashFlow,
    transactionCount: txns.length,
    avgDailyExpense,
    topCategories,
    paymentMethods: Object.entries(methodMap)
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    largestExpense: largestExpense
      ? { amount: largestExpense.amount, description: largestExpense.description, date: largestExpense.date.substring(0, 10) }
      : null,
    largestIncome: largestIncome
      ? { amount: largestIncome.amount, description: largestIncome.description, date: largestIncome.date.substring(0, 10) }
      : null,
    dailyTrend,
  };
}

/**
 * Build a day-by-day trend array for charting.
 */
function buildDailyTrend(txns, startDate, endDate) {
  const days = {};
  const cur = new Date(startDate);
  const end = new Date(endDate);

  // Initialize all days to zero
  while (cur <= end) {
    const key = cur.toISOString().substring(0, 10);
    days[key] = { date: key, income: 0, expense: 0, net: 0 };
    cur.setDate(cur.getDate() + 1);
  }

  // Fill in actuals
  for (const t of txns) {
    const day = t.date.substring(0, 10);
    if (!days[day]) continue;
    if (t.type === 'income') days[day].income += t.amount;
    else if (t.type === 'expense') days[day].expense += t.amount;
    days[day].net = days[day].income - days[day].expense;
  }

  return Object.values(days);
}

// ─── Historical average ───────────────────────────────────────

/**
 * Get the average daily expense over the past N days (excluding today).
 * Used for "above/below average" insights.
 */
export async function getAverageDailyExpense(days = 30) {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 1); // Yesterday
  const start = new Date(today);
  start.setDate(start.getDate() - days);

  const startStr = start.toISOString().substring(0, 10);
  const endStr = end.toISOString().substring(0, 10);

  const txns = await getTransactionsForRange(startStr, endStr);
  const totalExpenses = txns
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  return days > 0 ? totalExpenses / days : 0;
}

// ─── Count helpers ────────────────────────────────────────────

export async function getTransactionCount() {
  const db = getDB();
  const all = await db.transactions.filter((t) => !t.deletedAt).count();
  return all;
}

export async function hasTransactions() {
  const count = await getTransactionCount();
  return count > 0;
}
