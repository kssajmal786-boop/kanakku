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
import type { CanonicalTransaction, TransactionType, PaymentMethod, TransactionCategory } from '../types/transaction.types';
export type ValidationResult = {
    valid: true;
    transaction: CanonicalTransaction;
} | {
    valid: false;
    errors: z.ZodIssue[];
};
/**
 * Apply normalisation rules to a raw transaction object.
 * Returns a cleaned copy — never mutates the input.
 */
export declare function normalizeTransaction(raw: Partial<CanonicalTransaction>): Partial<CanonicalTransaction>;
/**
 * Validate a (normalised) transaction against the canonical schema.
 */
export declare function validateTransaction(transaction: Partial<CanonicalTransaction>): ValidationResult;
/**
 * Normalise then validate a transaction.
 * Convenience wrapper for the full pipeline.
 */
export declare function normalizeAndValidate(raw: Partial<CanonicalTransaction>): ValidationResult;
/**
 * Validate a batch of transactions.
 * Returns valid ones and logs invalid ones (without financial data).
 */
export declare function validateBatch(transactions: Partial<CanonicalTransaction>[]): {
    valid: CanonicalTransaction[];
    invalidCount: number;
};
export interface ManualTransactionInput {
    date: string;
    amount: number;
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
export declare function buildManualTransaction(input: ManualTransactionInput, userId: string): Partial<CanonicalTransaction>;
