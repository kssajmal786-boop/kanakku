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

// Matches: ₹ | Rs. | Rs | INR | INR. followed by number
const AMOUNT_PATTERNS = [
  /(?:₹|Rs\.?|INR\.?)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /(?:Rs|INR)\s*\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
  // Amount after keyword
  /(?:amount|amt|for|of)\s*(?:₹|Rs\.?|INR\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  // Amount preceded by keyword
  /([\d,]+(?:\.\d{1,2})?)\s*(?:₹|Rs\.?|INR)/i,
];

/**
 * Extract the first monetary amount from a text string.
 * @returns Amount in paise (integer), or null if not found.
 */
export function extractAmount(text: string): { amountPaise: number; rawAmount: string } | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const rawAmount = match[0].trim();
      const numStr = match[1].replace(/,/g, '');
      const parsed = parseFloat(numStr);
      if (!isNaN(parsed) && parsed > 0) {
        return {
          amountPaise: Math.round(parsed * 100),
          rawAmount,
        };
      }
    }
  }
  return null;
}

/**
 * Extract all monetary amounts from text.
 * Useful for emails with multiple amounts (e.g., amount + available balance).
 */
export function extractAllAmounts(text: string): Array<{ amountPaise: number; rawAmount: string }> {
  const globalPattern = /(?:₹|Rs\.?|INR\.?)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  const results: Array<{ amountPaise: number; rawAmount: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = globalPattern.exec(text)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    const parsed = parseFloat(numStr);
    if (!isNaN(parsed) && parsed > 0) {
      results.push({
        amountPaise: Math.round(parsed * 100),
        rawAmount: match[0].trim(),
      });
    }
  }

  return results;
}

/**
 * Convert paise back to rupees string for display.
 */
export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * Format paise as readable currency string.
 */
export function formatCurrency(paise: number, currency = 'INR'): string {
  if (currency === 'INR') {
    return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }
  return `${currency} ${(paise / 100).toFixed(2)}`;
}
