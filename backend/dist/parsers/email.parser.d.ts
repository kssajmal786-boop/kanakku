/**
 * Core Email Parser
 * ─────────────────────────────────────────────────────────────────────────
 * Converts a ParsedEmail into a CanonicalTransaction using:
 *  1. Classification  → determine transaction type & payment method
 *  2. Amount parsing  → extract amount in paise
 *  3. Date parsing    → extract transaction date
 *  4. Merchant        → extract payee/merchant name
 *  5. Reference       → extract bank/UPI reference number
 *  6. Category        → classify spending category
 *  7. ID generation   → stable UUID-v5 from dedup signals
 *
 * Errors are caught per-email — one bad email never crashes the batch.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { ParsedEmail } from '../types/gmail.types';
import type { CanonicalTransaction, ParseResult, ParseFailure } from '../types/transaction.types';
/**
 * Parse a single financial email into a CanonicalTransaction.
 */
export declare function parseEmail(email: ParsedEmail): ParseResult;
/**
 * Parse a batch of emails. Errors are isolated per-email.
 */
export declare function parseEmailBatch(emails: ParsedEmail[]): {
    parsed: CanonicalTransaction[];
    failures: ParseFailure[];
};
