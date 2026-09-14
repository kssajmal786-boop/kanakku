/**
 * Date Parsing Utilities
 * ─────────────────────────────────────────────────────────────────────────
 * Extracts dates from bank email formats common in India.
 *
 * Formats handled:
 *   17-Aug-2024
 *   17/08/2024
 *   Aug 17, 2024
 *   17 August 2024
 *   2024-08-17
 *   17-08-2024 12:34:56
 *   17 Aug 24, 12:34 PM
 * ─────────────────────────────────────────────────────────────────────────
 */
/**
 * Extract a date from a bank email body.
 * @returns ISO 8601 string, or null if no date found.
 */
export declare function extractDate(text: string): string | null;
/**
 * Return YYYY-MM-DD from an ISO string (for dedup comparison).
 */
export declare function toDateOnly(isoString: string): string;
/**
 * Check if a date string is within the allowed lookback window.
 */
export declare function isWithinLookback(dateStr: string, lookbackDays: number): boolean;
