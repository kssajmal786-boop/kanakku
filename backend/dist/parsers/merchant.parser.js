"use strict";
/**
 * Merchant Extraction Utilities
 * ─────────────────────────────────────────────────────────────────────────
 * Extracts merchant / payee names from bank alert emails.
 * Handles UPI VPAs, POS merchant names, bank transfer targets, etc.
 * ─────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractUpiVpa = extractUpiVpa;
exports.extractMerchant = extractMerchant;
exports.extractReference = extractReference;
exports.extractAccountSuffix = extractAccountSuffix;
exports.extractAvailableBalance = extractAvailableBalance;
// ─── UPI VPA patterns ─────────────────────────────────────────────────────────
const UPI_VPA_PATTERN = /[\w.\-+]+@[\w]+/;
const UPI_MERCHANT_PATTERNS = [
    /(?:to|paid to|sent to|transfer to)\s+([A-Za-z0-9 ._'\-&@]+?)(?:\s*(?:on|via|using|ref|upi|vpa|amount|rs|₹|for|\n|$))/i,
    /(?:merchant|payee|beneficiary)\s*[:.]?\s*([A-Za-z0-9 ._'\-&]+?)(?:\s*(?:on|via|ref|\n|$))/i,
    /UPI[-/]([A-Za-z0-9 ._'\-&]+?)(?:\s*(?:on|via|ref|\n|$))/i,
];
const TRANSFER_RECIPIENT_PATTERNS = [
    /(?:to|beneficiary|recipient)\s*[:.]?\s*([A-Za-z ]{3,50})(?:\s*(?:a\/c|account|bank|\n|$))/i,
    /(?:transferred to|transfer to|sent to)\s+([A-Za-z ]{3,50})/i,
];
const POS_MERCHANT_PATTERNS = [
    /(?:at|merchant|pos merchant|store)\s*[:.]?\s*([A-Za-z0-9 ._'\-&*]{3,50})(?:\s*(?:on|via|ref|\n|$))/i,
    /(?:purchase at|used at|swipe at)\s+([A-Za-z0-9 ._'\-&*]{3,50})/i,
];
const DESCRIPTION_CONTEXT_PATTERNS = [
    /(?:for|towards|purpose)\s*[:.]?\s*([A-Za-z0-9 ._'\-&]{3,60})/i,
];
/**
 * Extract UPI VPA from text.
 */
function extractUpiVpa(text) {
    const match = text.match(UPI_VPA_PATTERN);
    return match ? match[0].toLowerCase() : null;
}
/**
 * Extract a human-readable merchant name from bank email text.
 * Returns null if no reliable merchant can be determined.
 */
function extractMerchant(text, emailClass) {
    const patternSets = emailClass.startsWith('upi')
        ? [...UPI_MERCHANT_PATTERNS, ...POS_MERCHANT_PATTERNS]
        : emailClass.startsWith('card') || emailClass === 'bank_debit'
            ? [...POS_MERCHANT_PATTERNS, ...UPI_MERCHANT_PATTERNS]
            : emailClass === 'neft_debit' || emailClass === 'rtgs_debit' || emailClass === 'imps_debit'
                ? TRANSFER_RECIPIENT_PATTERNS
                : [...UPI_MERCHANT_PATTERNS, ...POS_MERCHANT_PATTERNS, ...TRANSFER_RECIPIENT_PATTERNS];
    for (const pattern of patternSets) {
        const match = text.match(pattern);
        if (match?.[1]) {
            const cleaned = cleanMerchantName(match[1]);
            if (cleaned.length >= 2)
                return cleaned;
        }
    }
    // Fallback: description context
    for (const pattern of DESCRIPTION_CONTEXT_PATTERNS) {
        const match = text.match(pattern);
        if (match?.[1]) {
            const cleaned = cleanMerchantName(match[1]);
            if (cleaned.length >= 3)
                return cleaned;
        }
    }
    return null;
}
/**
 * Clean a raw merchant name string.
 */
function cleanMerchantName(raw) {
    return raw
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[*_]+/g, '') // Remove asterisks used as padding by some banks
        .replace(/\.$/, '') // Remove trailing period
        .substring(0, 60); // Cap length
}
/**
 * Extract bank reference / transaction ID.
 */
function extractReference(text) {
    const REF_PATTERNS = [
        /(?:ref(?:erence)?(?:\s*no\.?)?|transaction\s*(?:id|no\.?)|txn\s*(?:id|no\.?)|utr(?:\s*no\.?)?|rrn|approval\s*code)\s*[:.]?\s*([A-Z0-9xX]{6,30})/i,
        /([A-Z]{2,5}\d{8,20})/, // Common bank UTR formats (e.g., HDFC0123456789)
        /\b(\d{12,20})\b/, // Long numeric reference
    ];
    for (const pattern of REF_PATTERNS) {
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1].toUpperCase();
        }
    }
    return null;
}
/**
 * Extract account/card suffix (last 4 digits only – safe to display).
 */
function extractAccountSuffix(text) {
    const patterns = [
        /(?:a(?:ccount)?|ac|a\/c)\s*(?:no\.?|number)?\s*(?:[X*]{2,}\s*)?(\d{4})\b/i,
        /(?:card|debit card|credit card)\s*(?:no\.?|number)?\s*(?:[X*]{4,}\s*)+(\d{4})\b/i,
        /[Xx*]{4,}(\d{4})\b/,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1])
            return match[1];
    }
    return null;
}
/**
 * Extract available balance from email (some banks include this).
 * Returns amount in paise.
 */
function extractAvailableBalance(text) {
    const patterns = [
        /(?:available\s*balance|bal(?:ance)?)\s*(?:is|:)?\s*(?:₹|Rs\.?|INR\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
        /(?:avl\s*bal|avl\.?\s*balance)\s*[:.]?\s*(?:₹|Rs\.?|INR\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            const num = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(num))
                return Math.round(num * 100);
        }
    }
    return null;
}
//# sourceMappingURL=merchant.parser.js.map