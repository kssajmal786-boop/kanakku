/**
 * Transaction Routes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POST /transactions/validate    → Validate a batch of transactions
 * POST /transactions/normalize   → Normalize + validate a batch
 * POST /transactions/deduplicate → Run deduplication check
 * POST /transactions/manual      → Build a manual transaction (no storage)
 * GET  /transactions/schema      → Return the canonical schema definition
 * GET  /transactions/categories  → Return available categories
 * GET  /transactions/methods     → Return available payment methods
 *
 * IMPORTANT: This backend does NOT store transactions.
 * These endpoints process transaction data on-the-fly and return the result.
 * All durable storage is the client's responsibility (local-first).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  validateTransactionInput,
  validateManualTransaction,
} from '../middleware/validation.middleware';
import {
  validateBatch,
  normalizeAndValidate,
  buildManualTransaction,
} from '../services/normalizer.service';
import { deduplicateBatch, checkDuplicate } from '../services/deduplication.service';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';
import type { CanonicalTransaction } from '../types/transaction.types';

const router = Router();

// All transaction routes require authentication
router.use(requireAuth);

// ── POST /transactions/validate ───────────────────────────────────────────────
/**
 * @description
 * Validates a batch of transactions against the canonical schema.
 * Returns validation results — does NOT store anything.
 *
 * Use case: Frontend or receipt module submitting transactions for
 * validation before storing locally.
 */
router.post(
  '/validate',
  validateTransactionInput,
  (req: Request, res: Response): void => {
    const { transactions } = req.body as {
      transactions: Partial<CanonicalTransaction>[];
    };

    const { valid, invalidCount } = validateBatch(transactions);

    logger.info('Transaction validation complete', {
      userId: req.user!.userId,
      submitted: transactions.length,
      valid: valid.length,
      invalid: invalidCount,
    });

    sendSuccess(res, {
      valid: valid.length,
      invalid: invalidCount,
      total: transactions.length,
      validTransactions: valid,
    });
  }
);

// ── POST /transactions/normalize ──────────────────────────────────────────────
/**
 * @description
 * Normalise and validate a single transaction.
 * Useful for third-party integrations (receipt module, statement parser).
 */
router.post(
  '/normalize',
  async (req: Request, res: Response): Promise<void> => {
    const { transaction } = req.body as { transaction: Partial<CanonicalTransaction> };

    if (!transaction || typeof transaction !== 'object') {
      sendError(res, 'transaction object is required', 400, 'MISSING_TRANSACTION');
      return;
    }

    const result = normalizeAndValidate(transaction);

    if (result.valid) {
      sendSuccess(res, { transaction: result.transaction });
    } else {
      res.status(422).json({
        success: false,
        error: 'Transaction failed validation',
        errors: result.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ── POST /transactions/deduplicate ────────────────────────────────────────────
/**
 * @description
 * Check a single incoming transaction against a list of existing ones.
 * Returns deduplication result with confidence score.
 *
 * Use case: Receipt module checking before storing a scanned receipt.
 */
router.post(
  '/deduplicate',
  async (req: Request, res: Response): Promise<void> => {
    const { incoming, existing = [] } = req.body as {
      incoming: Partial<CanonicalTransaction>;
      existing: Partial<CanonicalTransaction>[];
    };

    if (!incoming || typeof incoming !== 'object') {
      sendError(res, 'incoming transaction is required', 400, 'MISSING_INCOMING');
      return;
    }

    const result = normalizeAndValidate(incoming);
    if (!result.valid) {
      sendError(res, 'Incoming transaction is invalid', 422, 'INVALID_TRANSACTION');
      return;
    }

    const dedupResult = checkDuplicate(
      result.transaction,
      existing as CanonicalTransaction[]
    );

    sendSuccess(res, {
      deduplication: dedupResult,
      transaction: result.transaction,
    });
  }
);

// ── POST /transactions/manual ─────────────────────────────────────────────────
/**
 * @description
 * Build a properly-formed canonical transaction from user manual input.
 * Returns the transaction — does NOT store it (local-first).
 */
router.post(
  '/manual',
  validateManualTransaction,
  (req: Request, res: Response): void => {
    const user = req.user!;
    const input = req.body;

    const raw = buildManualTransaction(input, user.userId);
    const result = normalizeAndValidate(raw);

    if (result.valid) {
      logger.info('Manual transaction built', { userId: user.userId });
      sendSuccess(res, { transaction: result.transaction }, 201);
    } else {
      res.status(422).json({
        success: false,
        error: 'Manual transaction validation failed',
        errors: result.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ── GET /transactions/schema ──────────────────────────────────────────────────
/**
 * @description
 * Returns the canonical transaction schema definition.
 * Use by the frontend, receipt module, and AI assistant to understand
 * the data structure.
 */
router.get('/schema', (_req: Request, res: Response): void => {
  sendSuccess(res, {
    schema: {
      id: 'string (UUID v5, deterministic)',
      date: 'string (ISO 8601)',
      amount: 'integer (paise; divide by 100 for rupees)',
      currency: 'string (ISO 4217, default INR)',
      type: 'income | expense | transfer',
      category: 'string (see /transactions/categories)',
      paymentMethod: 'string (see /transactions/methods)',
      source: 'gmail | manual | receipt | statement',
      description: 'string',
      merchant: 'string | null',
      reference: 'string | null',
      createdAt: 'string (ISO 8601)',
      linkedTxnId: 'string (UUID) | null — for ATM→cash linkage',
      confidence: 'number [0-1] — parser confidence',
      parseStatus: 'success | partial | failed',
      rawAmount: 'string | null — original amount text',
      tags: 'string[]',
      metadata: 'object (bank name, UPI VPA, card last4, etc.)',
    },
    notes: {
      amount: 'Always stored as paise (integer) to avoid floating-point errors',
      atm: 'ATM withdrawals use type=transfer (Bank→Cash), not expense',
      linkedTxnId: 'ATM withdrawals link to subsequent cash expense transactions',
      confidence: 'Below 0.5 indicates partial parsing — show review UI to user',
    },
  });
});

// ── GET /transactions/categories ──────────────────────────────────────────────
router.get('/categories', (_req: Request, res: Response): void => {
  sendSuccess(res, {
    categories: [
      { id: 'food', label: 'Food & Dining', labelTa: 'உணவு', icon: '🍽️' },
      { id: 'transport', label: 'Transport', labelTa: 'போக்குவரத்து', icon: '🚗' },
      { id: 'shopping', label: 'Shopping', labelTa: 'கடை', icon: '🛍️' },
      { id: 'entertainment', label: 'Entertainment', labelTa: 'பொழுதுபோக்கு', icon: '🎬' },
      { id: 'health', label: 'Health', labelTa: 'உடல் நலம்', icon: '🏥' },
      { id: 'education', label: 'Education', labelTa: 'கல்வி', icon: '📚' },
      { id: 'utilities', label: 'Utilities & Bills', labelTa: 'பயன்பாடுகள்', icon: '⚡' },
      { id: 'rent', label: 'Rent', labelTa: 'வாடகை', icon: '🏠' },
      { id: 'salary', label: 'Salary / Income', labelTa: 'சம்பளம்', icon: '💰' },
      { id: 'investment', label: 'Investment', labelTa: 'முதலீடு', icon: '📈' },
      { id: 'atm_withdrawal', label: 'ATM Withdrawal (Bank→Cash)', labelTa: 'ஏடிஎம் பணம்', icon: '🏧' },
      { id: 'bank_transfer', label: 'Bank Transfer', labelTa: 'வங்கி பரிமாற்றம்', icon: '🏦' },
      { id: 'upi_transfer', label: 'UPI Transfer', labelTa: 'யுபிஐ பரிமாற்றம்', icon: '📱' },
      { id: 'refund', label: 'Refund', labelTa: 'திரும்பப் பெறுதல்', icon: '↩️' },
      { id: 'subscription', label: 'Subscription', labelTa: 'சந்தா', icon: '🔄' },
      { id: 'insurance', label: 'Insurance', labelTa: 'காப்பீடு', icon: '🛡️' },
      { id: 'tax', label: 'Tax', labelTa: 'வரி', icon: '📋' },
      { id: 'other', label: 'Other', labelTa: 'மற்றவை', icon: '📎' },
      { id: 'uncategorized', label: 'Uncategorized', labelTa: 'வகைப்படுத்தப்படவில்லை', icon: '❓' },
    ],
  });
});

// ── GET /transactions/methods ─────────────────────────────────────────────────
router.get('/methods', (_req: Request, res: Response): void => {
  sendSuccess(res, {
    paymentMethods: [
      { id: 'upi', label: 'UPI', labelTa: 'யுபிஐ', icon: '📱' },
      { id: 'card', label: 'Debit/Credit Card', labelTa: 'அட்டை', icon: '💳' },
      { id: 'cash', label: 'Cash', labelTa: 'ரொக்கம்', icon: '💵' },
      { id: 'bank', label: 'Bank Transfer / Net Banking', labelTa: 'வங்கி', icon: '🏦' },
      { id: 'atm', label: 'ATM', labelTa: 'ஏடிஎம்', icon: '🏧' },
      { id: 'netbanking', label: 'Net Banking', labelTa: 'இணைய வங்கி', icon: '🌐' },
      { id: 'unknown', label: 'Unknown', labelTa: 'தெரியாத', icon: '❓' },
    ],
  });
});

export default router;
