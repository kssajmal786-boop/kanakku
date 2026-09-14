/**
 * Merchant Extraction Utilities
 * ─────────────────────────────────────────────────────────────────────────
 * Extracts merchant / payee names from bank alert emails.
 * Handles UPI VPAs, POS merchant names, bank transfer targets, etc.
 * ─────────────────────────────────────────────────────────────────────────
 */
/**
 * Extract UPI VPA from text.
 */
export declare function extractUpiVpa(text: string): string | null;
/**
 * Extract a human-readable merchant name from bank email text.
 * Returns null if no reliable merchant can be determined.
 */
export declare function extractMerchant(text: string, emailClass: string): string | null;
/**
 * Extract bank reference / transaction ID.
 */
export declare function extractReference(text: string): string | null;
/**
 * Extract account/card suffix (last 4 digits only – safe to display).
 */
export declare function extractAccountSuffix(text: string): string | null;
/**
 * Extract available balance from email (some banks include this).
 * Returns amount in paise.
 */
export declare function extractAvailableBalance(text: string): number | null;
