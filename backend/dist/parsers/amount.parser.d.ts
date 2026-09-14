/**
 * Amount Parsing Utilities
 * ─────────────────────────────────────────────────────────────────────────
 * Extracts monetary amounts from various Indian banking email formats.
 * Returns amount in PAISE (integer) to avoid floating-point errors.
 *
 * Examples handled:
 *   ₹1,234.56  →  123456
 *   Rs.5000    →  500000
 *   INR 750    →  75000
 *   1,00,000   →  10000000  (Indian lakh format)
 * ─────────────────────────────────────────────────────────────────────────
 */
/**
 * Extract the first monetary amount from a text string.
 * @returns Amount in paise (integer), or null if not found.
 */
export declare function extractAmount(text: string): {
    amountPaise: number;
    rawAmount: string;
} | null;
/**
 * Extract all monetary amounts from text.
 * Useful for emails with multiple amounts (e.g., amount + available balance).
 */
export declare function extractAllAmounts(text: string): Array<{
    amountPaise: number;
    rawAmount: string;
}>;
/**
 * Convert paise back to rupees string for display.
 */
export declare function paiseToRupees(paise: number): string;
/**
 * Format paise as readable currency string.
 */
export declare function formatCurrency(paise: number, currency?: string): string;
