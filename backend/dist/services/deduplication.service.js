"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDuplicate = checkDuplicate;
exports.deduplicateBatch = deduplicateBatch;
const date_parser_1 = require("../parsers/date.parser");
// ─── Signal scoring ───────────────────────────────────────────────────────────
const SIGNALS = {
    GMAIL_MESSAGE_ID: 30,
    REFERENCE_EXACT: 35,
    AMOUNT_EXACT: 40,
    DATE_SAME_DAY: 20,
    MERCHANT_FUZZY: 15,
    PAYMENT_METHOD: 10,
};
const THRESHOLD_DEFINITE = 85;
const THRESHOLD_LIKELY = 70;
const THRESHOLD_POSSIBLE = 45;
// ─── Fuzzy string match ───────────────────────────────────────────────────────
/**
 * Simple normalised edit-distance similarity [0, 1].
 * Sufficient for merchant names (no need for heavy libraries).
 */
function stringSimilarity(a, b) {
    const s1 = a.toLowerCase().trim();
    const s2 = b.toLowerCase().trim();
    if (s1 === s2)
        return 1;
    if (s1.length === 0 || s2.length === 0)
        return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.includes(shorter))
        return 0.9; // One is a substring of the other
    // Levenshtein distance
    const dist = levenshtein(s1, s2);
    return 1 - dist / Math.max(s1.length, s2.length);
}
function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[a.length][b.length];
}
function scoreTransactionPair(incoming, existing) {
    const signals = [];
    let score = 0;
    // Gmail Message ID — guaranteed unique; identical ID = same email
    const incomingMsgId = incoming.metadata?.gmailMessageId;
    const existingMsgId = existing.metadata?.gmailMessageId;
    const isMsgIdMatch = !!(incomingMsgId && existingMsgId && incomingMsgId === existingMsgId);
    if (isMsgIdMatch) {
        score += SIGNALS.GMAIL_MESSAGE_ID;
        signals.push({ name: 'gmail_message_id', points: SIGNALS.GMAIL_MESSAGE_ID, matched: true });
    }
    else {
        signals.push({ name: 'gmail_message_id', points: 0, matched: false });
    }
    // Reference number
    const isRefMatch = !!(incoming.reference &&
        existing.reference &&
        incoming.reference.toUpperCase() === existing.reference.toUpperCase());
    if (isRefMatch) {
        score += SIGNALS.REFERENCE_EXACT;
        signals.push({ name: 'reference_exact', points: SIGNALS.REFERENCE_EXACT, matched: true });
    }
    else {
        signals.push({ name: 'reference_exact', points: 0, matched: false });
    }
    // Amount (exact match in paise)
    const isAmountMatch = incoming.amount === existing.amount && incoming.currency === existing.currency;
    if (isAmountMatch) {
        score += SIGNALS.AMOUNT_EXACT;
        signals.push({ name: 'amount_exact', points: SIGNALS.AMOUNT_EXACT, matched: true });
    }
    else {
        signals.push({ name: 'amount_exact', points: 0, matched: false });
    }
    // Hard gate: If not same message ID, different amounts can never be a duplicate!
    if (!isMsgIdMatch && !isAmountMatch) {
        return { score: 0, signals };
    }
    // Date (same calendar day)
    const incomingDay = (0, date_parser_1.toDateOnly)(incoming.date);
    const existingDay = (0, date_parser_1.toDateOnly)(existing.date);
    if (incomingDay === existingDay) {
        score += SIGNALS.DATE_SAME_DAY;
        signals.push({ name: 'date_same_day', points: SIGNALS.DATE_SAME_DAY, matched: true });
    }
    else {
        signals.push({ name: 'date_same_day', points: 0, matched: false });
    }
    // Merchant fuzzy match
    if (incoming.merchant && existing.merchant) {
        const similarity = stringSimilarity(incoming.merchant, existing.merchant);
        if (similarity >= 0.8) {
            const pts = Math.round(SIGNALS.MERCHANT_FUZZY * similarity);
            score += pts;
            signals.push({ name: 'merchant_fuzzy', points: pts, matched: true });
        }
        else {
            signals.push({ name: 'merchant_fuzzy', points: 0, matched: false });
        }
    }
    else {
        signals.push({ name: 'merchant_fuzzy', points: 0, matched: false });
    }
    // Payment method
    if (incoming.paymentMethod === existing.paymentMethod) {
        score += SIGNALS.PAYMENT_METHOD;
        signals.push({ name: 'payment_method', points: SIGNALS.PAYMENT_METHOD, matched: true });
    }
    else {
        signals.push({ name: 'payment_method', points: 0, matched: false });
    }
    return { score, signals };
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Check if a single incoming transaction is a duplicate of any existing one.
 */
function checkDuplicate(incoming, existingTransactions) {
    let bestScore = 0;
    let bestMatchId = null;
    let bestReason = '';
    for (const existing of existingTransactions) {
        // Skip if same ID (already deduplicated)
        if (existing.id === incoming.id) {
            return {
                isDuplicate: true,
                confidence: 1.0,
                matchedId: existing.id,
                reason: 'Identical transaction ID',
            };
        }
        const { score, signals } = scoreTransactionPair(incoming, existing);
        if (score > bestScore) {
            bestScore = score;
            bestMatchId = existing.id;
            const matchedSignals = signals.filter((s) => s.matched).map((s) => s.name);
            bestReason = `Matched signals: ${matchedSignals.join(', ')} (score: ${score})`;
        }
    }
    if (bestScore >= THRESHOLD_DEFINITE) {
        return {
            isDuplicate: true,
            confidence: 1.0,
            matchedId: bestMatchId,
            reason: bestReason,
        };
    }
    if (bestScore >= THRESHOLD_LIKELY) {
        const confidence = 0.75 + ((bestScore - THRESHOLD_LIKELY) / (THRESHOLD_DEFINITE - THRESHOLD_LIKELY)) * 0.24;
        return {
            isDuplicate: true,
            confidence: Math.min(0.99, confidence),
            matchedId: bestMatchId,
            reason: bestReason,
        };
    }
    if (bestScore >= THRESHOLD_POSSIBLE) {
        // Possible — flag for review but don't mark as definite duplicate
        const confidence = 0.5 + ((bestScore - THRESHOLD_POSSIBLE) / (THRESHOLD_LIKELY - THRESHOLD_POSSIBLE)) * 0.24;
        return {
            isDuplicate: false, // Let the client decide
            confidence,
            matchedId: bestMatchId,
            reason: `Possible duplicate (score: ${bestScore}) — review recommended`,
        };
    }
    return {
        isDuplicate: false,
        confidence: 0,
        matchedId: null,
        reason: 'No duplicate found',
    };
}
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
function deduplicateBatch(incoming, existing = []) {
    const accepted = [];
    const duplicateDetails = [];
    let duplicatesSkipped = 0;
    for (const txn of incoming) {
        // Check against already-stored transactions
        const vsExisting = checkDuplicate(txn, existing);
        if (vsExisting.isDuplicate && vsExisting.confidence >= 0.75) {
            duplicatesSkipped++;
            duplicateDetails.push({ incomingId: txn.id, reason: vsExisting.reason, matchedId: vsExisting.matchedId });
            continue;
        }
        // Check against already-accepted new transactions in this batch
        const vsBatch = checkDuplicate(txn, accepted);
        if (vsBatch.isDuplicate && vsBatch.confidence >= 0.75) {
            duplicatesSkipped++;
            duplicateDetails.push({ incomingId: txn.id, reason: vsBatch.reason, matchedId: vsBatch.matchedId });
            continue;
        }
        accepted.push(txn);
    }
    return { unique: accepted, duplicatesSkipped, duplicateDetails };
}
//# sourceMappingURL=deduplication.service.js.map