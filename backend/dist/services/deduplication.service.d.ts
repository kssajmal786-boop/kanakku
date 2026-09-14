/**
 * Transaction Deduplication Engine
 * ─────────────────────────────────────────────────────────────────────────
 * The same financial transaction can arrive through multiple sources:
 *   • Gmail alert email
 *   • Manual entry by the user
 *   • Uploaded receipt
 *   • Bank statement import (future)
 *
 * This engine:
 *   1. Assigns a confidence score to each potential duplicate pair
 *   2. Provides a clear reason for each decision
 *   3. Does NOT blindly merge — only marks duplicates, callers decide
 *
 * Signal weights used:
 *   Amount (exact)       → 40 pts
 *   Reference (exact)    → 35 pts  (highest single signal if present)
 *   Gmail Message ID     → 30 pts  (guaranteed unique if same email)
 *   Date (same day)      → 20 pts
 *   Merchant (fuzzy)     → 15 pts
 *   Payment method       → 10 pts
 *
 * Thresholds:
 *   ≥ 85 pts → Definite duplicate   (confidence 1.0)
 *   ≥ 65 pts → Likely duplicate     (confidence 0.75 – 0.99)
 *   ≥ 45 pts → Possible duplicate   (confidence 0.50 – 0.74)
 *   <  45 pts → Not a duplicate
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { CanonicalTransaction, DeduplicationResult } from '../types/transaction.types';
/**
 * Check if a single incoming transaction is a duplicate of any existing one.
 */
export declare function checkDuplicate(incoming: CanonicalTransaction, existingTransactions: CanonicalTransaction[]): DeduplicationResult;
/**
 * Deduplicate a batch of incoming transactions against each other
 * AND against an optional list of existing transactions.
 *
 * Two-pass process:
 *   Pass 1: Check each incoming txn against existing (already stored) ones
 *   Pass 2: Check each incoming txn against others in the same batch
 *
 * Returns only the unique transactions.
 */
export declare function deduplicateBatch(incoming: CanonicalTransaction[], existing?: CanonicalTransaction[]): {
    unique: CanonicalTransaction[];
    duplicatesSkipped: number;
    duplicateDetails: Array<{
        incomingId: string;
        reason: string;
        matchedId: string | null;
    }>;
};
