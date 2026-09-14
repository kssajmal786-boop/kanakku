// ============================================================
// Transactions Adapter — REAL local data (replaces transactions.mock.js)
// ============================================================
// The UI (pages/transactions.js) works with a simple, display-shaped
// transaction object and a simple add-form payload. The canonical
// ledger (transactionStore.js / db.js) uses the strict schema from
// the master spec (amount in paise, source, metadata, etc).
//
// This module is the ONLY place that translates between the two, so
// neither the UI code nor the storage layer needs to know about the
// other's shape.
// ============================================================

import {
  getAllTransactions,
  addTransaction    as storeAddTransaction,
  updateTransaction  as storeUpdateTransaction,
  deleteTransaction  as storeDeleteTransaction,
} from './transactionStore.js';
import { ICONS, toRupees } from './dashboardService.js';

// ─── Read ────────────────────────────────────────────────────

/**
 * @param {{type?: string, paymentMethod?: string, category?: string, query?: string}} filters
 */
export async function getTransactions(filters = {}) {
  const all = await getAllTransactions();

  const filtered = all.filter((t) => {
    if (filters.type && filters.type !== 'all' && t.type !== filters.type) return false;
    if (filters.paymentMethod && filters.paymentMethod !== 'all' && t.paymentMethod !== filters.paymentMethod) return false;
    if (filters.category && filters.category !== 'all' && t.category !== filters.category) return false;
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const haystack = `${t.merchant || ''} ${t.description || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return filtered.map(toUIShape);
}

function toUIShape(t) {
  return {
    id: t.id,
    category: t.category,
    icon: ICONS[t.category] || '💰',
    merchant: t.merchant || t.description || 'Transaction',
    date: t.date,
    amount: toRupees(t.amount),
    type: t.type,
    paymentMethod: t.paymentMethod,
    source: t.source,
    note: t.note || '',
  };
}

// ─── Add (manual entry, Phase 15) ───────────────────────────

/**
 * Accepts the simple form payload from the "Add Transaction" modal
 * and converts it into the canonical schema before saving.
 *
 * @param {{merchant: string, amount: string|number, type: 'income'|'expense',
 *          category: string, paymentMethod: string, date: string, icon?: string}} form
 */
export async function addTransaction(form) {
  const amountRupees = Number(form.amount);
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    throw new Error('Invalid amount');
  }
  if (!form.date || Number.isNaN(new Date(form.date).getTime())) {
    throw new Error('Invalid date');
  }

  const canonical = {
    id: generateId(),
    date: new Date(form.date).toISOString(),
    amount: Math.round(amountRupees * 100), // rupees -> paise
    type: form.type === 'income' ? 'income' : 'expense',
    category: form.category || 'other',
    paymentMethod: form.paymentMethod || 'cash',
    source: 'manual',
    description: form.merchant || '',
    merchant: form.merchant || '',
    note: form.note || '',
    reference: null,
    createdAt: new Date().toISOString(),
    metadata: {},
  };

  const added = await storeAddTransaction(canonical);
  if (!added) throw new Error('Transaction could not be saved (duplicate id)');
  return toUIShape(canonical);
}

/**
 * Update a manual transaction by id.
 * @param {string} id
 * @param {{merchant?,amount?,type?,category?,paymentMethod?,date?,note?}} form
 */
export async function updateTransaction(id, form) {
  const changes = {};
  if (form.amount !== undefined) {
    const amountRupees = Number(form.amount);
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) throw new Error('Invalid amount');
    changes.amount = Math.round(amountRupees * 100);
  }
  if (form.date) {
    if (Number.isNaN(new Date(form.date).getTime())) throw new Error('Invalid date');
    changes.date = new Date(form.date).toISOString();
  }
  if (form.type)          changes.type          = form.type;
  if (form.category)      changes.category      = form.category;
  if (form.paymentMethod) changes.paymentMethod = form.paymentMethod;
  if (form.merchant !== undefined) {
    changes.merchant    = form.merchant;
    changes.description = form.merchant;
  }
  if (form.note !== undefined) changes.note = form.note;

  await storeUpdateTransaction(id, changes);
}

// ─── Delete ──────────────────────────────────────────────────

export async function deleteTransaction(id) {
  return storeDeleteTransaction(id);
}

// ─── Receipt upload & OCR Extraction ────────────────────────
import { extractReceiptData } from './receiptOcr.js';

/**
 * Process a receipt image through local OCR and return extracted candidate transaction.
 * @param {Blob|File} file
 * @param {function({status: string, progress: number}): void} [onProgress]
 * @returns {Promise<{merchant: string, amount: number, date: string, paymentMethod: string, category: string, gstin: string|null, rawText: string}>}
 */
export async function processReceipt(file, onProgress = null) {
  if (!file) throw new Error('No receipt image provided');
  return extractReceiptData(file, onProgress);
}

// ─── Helpers ─────────────────────────────────────────────────

function generateId() {
  if (window.crypto?.randomUUID) return `tx_${window.crypto.randomUUID()}`;
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
