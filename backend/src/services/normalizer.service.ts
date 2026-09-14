/**
 * Transaction Normalizer & Validator
 * ─────────────────────────────────────────────────────────────────────────
 * Validates and normalises transactions before they are returned to the
 * client.  This is the final gate before data leaves the backend.
 *
 * Responsibilities:
 *   • Schema validation via Zod
 *   • Sanitisation (trim strings, clamp amounts, normalise dates)
 *   • ATM transfer type enforcement (never 'expense')
 *   • Confidence floor enforcement
 *   • Currency normalisation
 * ─────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type {
  CanonicalTransaction,
  TransactionType,
  PaymentMethod,
  TransactionSource,
  ParseStatus,
  TransactionCategory,
} from '../types/transaction.types';
import { logger } from '../utils/logger';

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const TransactionTypeEnum = z.enum(['income', 'expense', 'transfer']);
const PaymentMethodEnum = z.enum(['upi', 'card', 'cash', 'bank', 'atm', 'netbanking', 'unknown']);
const SourceEnum = z.enum(['gmail', 'manual', 'receipt', 'statement']);
const ParseStatusEnum = z.enum(['success', 'partial', 'failed']);

const CanonicalTransactionSchema = z.object({
  id: z.string().uuid('Transaction ID must be a valid UUID'),
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be ISO format')),
  amount: z.number().int('Amount must be integer paise').min(1, 'Amount must be positive'),
  currency: z.string().length(3, 'Currency must be 3-character ISO code').default('INR'),
  type: TransactionTypeEnum,
  category: z.string().min(1),
  paymentMethod: PaymentMethodEnum,
  source: SourceEnum,
  description: z.string().min(1).max(500),
  merchant: z.string().max(100).nullable(),
  reference: z.string().max(50).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  linkedTxnId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  parseStatus: ParseStatusEnum,
  rawAmount: z.string().max(50).nullable(),
  tags: z.array(z.string().max(30)),
  metadata: z.record(z.unknown()),
});

export type ValidationResult =
  | { valid: true; transaction: CanonicalTransaction }
  | { valid: false; errors: z.ZodIssue[] };

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Apply normalisation rules to a raw transaction object.
 * Returns a cleaned copy — never mutates the input.
 */
export function normalizeTransaction(raw: Partial<CanonicalTransaction>): Partial<CanonicalTransaction> {
  const clone = { ...raw };

  // Strings: trim whitespace
  if (typeof clone.description === 'string') {
    clone.description = clone.description.trim().substring(0, 500);
  }
  if (typeof clone.merchant === 'string') {
    clone.merchant = clone.merchant.trim().substring(0, 100) || null;
  }
  if (typeof clone.reference === 'string') {
    clone.reference = clone.reference.trim().toUpperCase().substring(0, 50) || null;
  }

  // Currency: uppercase
  if (typeof clone.currency === 'string') {
    clone.currency = clone.currency.toUpperCase();
  } else {
    clone.currency = 'INR';
  }

  // Amount: must be positive integer (paise)
  if (typeof clone.amount === 'number') {
    clone.amount = Math.abs(Math.round(clone.amount));
  }

  // Confidence: clamp to [0, 1]
  if (typeof clone.confidence === 'number') {
    clone.confidence = Math.max(0, Math.min(1, clone.confidence));
  }

  // ATM withdrawals MUST be 'transfer' type (Bank → Cash)
  if (clone.paymentMethod === 'atm' || clone.category === 'atm_withdrawal') {
    if (clone.type !== 'transfer') {
      logger.warn('ATM transaction had incorrect type; correcting to transfer', {
        id: clone.id,
        originalType: clone.type,
      });
      clone.type = 'transfer';
    }
  }

  // Tags: deduplicate and sanitise
  if (Array.isArray(clone.tags)) {
    clone.tags = [...new Set(clone.tags.map((t) => String(t).trim().toLowerCase()))].filter(Boolean);
  } else {
    clone.tags = [];
  }

  // Metadata: never allow raw email body in metadata passed to client
  if (clone.metadata && typeof clone.metadata === 'object') {
    const meta = { ...clone.metadata } as Record<string, unknown>;
    delete meta['body'];
    delete meta['textBody'];
    delete meta['htmlBody'];
    delete meta['combinedBody'];
    clone.metadata = meta;
  }

  return clone;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a (normalised) transaction against the canonical schema.
 */
export function validateTransaction(transaction: Partial<CanonicalTransaction>): ValidationResult {
  const result = CanonicalTransactionSchema.safeParse(transaction);

  if (result.success) {
    return { valid: true, transaction: result.data as CanonicalTransaction };
  }

  return { valid: false, errors: result.error.issues };
}

/**
 * Normalise then validate a transaction.
 * Convenience wrapper for the full pipeline.
 */
export function normalizeAndValidate(raw: Partial<CanonicalTransaction>): ValidationResult {
  const normalized = normalizeTransaction(raw);
  return validateTransaction(normalized);
}

/**
 * Validate a batch of transactions.
 * Returns valid ones and logs invalid ones (without financial data).
 */
export function validateBatch(
  transactions: Partial<CanonicalTransaction>[]
): {
  valid: CanonicalTransaction[];
  invalidCount: number;
} {
  const valid: CanonicalTransaction[] = [];
  let invalidCount = 0;

  for (const txn of transactions) {
    const result = normalizeAndValidate(txn);
    if (result.valid) {
      valid.push(result.transaction);
    } else {
      invalidCount++;
      logger.warn('Transaction failed validation', {
        id: txn.id ?? 'unknown',
        errorCount: result.errors.length,
        fields: result.errors.map((e) => e.path.join('.')),
      });
    }
  }

  return { valid, invalidCount };
}

// ─── Manual transaction builder ───────────────────────────────────────────────

export interface ManualTransactionInput {
  date: string;
  amount: number;          // Paise
  currency?: string;
  type: TransactionType;
  category: TransactionCategory;
  paymentMethod: PaymentMethod;
  description: string;
  merchant?: string;
  reference?: string;
  tags?: string[];
}

/**
 * Create a canonical transaction from a manual user entry.
 * Used by the /transactions endpoint for manual additions.
 */
export function buildManualTransaction(
  input: ManualTransactionInput,
  userId: string
): Partial<CanonicalTransaction> {
  const raw: Partial<CanonicalTransaction> = {
    id: uuidv4(),
    date: input.date,
    amount: input.amount,
    currency: input.currency ?? 'INR',
    type: input.type,
    category: input.category,
    paymentMethod: input.paymentMethod,
    source: 'manual',
    description: input.description,
    merchant: input.merchant ?? null,
    reference: input.reference ?? null,
    createdAt: new Date().toISOString(),
    linkedTxnId: null,
    confidence: 1.0,          // Manual entries are 100% confident
    parseStatus: 'success',
    rawAmount: `₹${(input.amount / 100).toFixed(2)}`,
    tags: input.tags ?? [],
    metadata: { userId },
  };

  return raw;
}
