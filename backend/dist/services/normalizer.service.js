"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTransaction = normalizeTransaction;
exports.validateTransaction = validateTransaction;
exports.normalizeAndValidate = normalizeAndValidate;
exports.validateBatch = validateBatch;
exports.buildManualTransaction = buildManualTransaction;
const zod_1 = require("zod");
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
// ─── Zod Schema ───────────────────────────────────────────────────────────────
const TransactionTypeEnum = zod_1.z.enum(['income', 'expense', 'transfer']);
const PaymentMethodEnum = zod_1.z.enum(['upi', 'card', 'cash', 'bank', 'atm', 'netbanking', 'unknown']);
const SourceEnum = zod_1.z.enum(['gmail', 'manual', 'receipt', 'statement']);
const ParseStatusEnum = zod_1.z.enum(['success', 'partial', 'failed']);
const CanonicalTransactionSchema = zod_1.z.object({
    id: zod_1.z.string().uuid('Transaction ID must be a valid UUID'),
    date: zod_1.z.string().datetime({ offset: true }).or(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be ISO format')),
    amount: zod_1.z.number().int('Amount must be integer paise').min(1, 'Amount must be positive'),
    currency: zod_1.z.string().length(3, 'Currency must be 3-character ISO code').default('INR'),
    type: TransactionTypeEnum,
    category: zod_1.z.string().min(1),
    paymentMethod: PaymentMethodEnum,
    source: SourceEnum,
    description: zod_1.z.string().min(1).max(500),
    merchant: zod_1.z.string().max(100).nullable(),
    reference: zod_1.z.string().max(50).nullable(),
    createdAt: zod_1.z.string().datetime({ offset: true }),
    linkedTxnId: zod_1.z.string().uuid().nullable(),
    confidence: zod_1.z.number().min(0).max(1),
    parseStatus: ParseStatusEnum,
    rawAmount: zod_1.z.string().max(50).nullable(),
    tags: zod_1.z.array(zod_1.z.string().max(30)),
    metadata: zod_1.z.record(zod_1.z.unknown()),
});
// ─── Normalisation ────────────────────────────────────────────────────────────
/**
 * Apply normalisation rules to a raw transaction object.
 * Returns a cleaned copy — never mutates the input.
 */
function normalizeTransaction(raw) {
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
    }
    else {
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
            logger_1.logger.warn('ATM transaction had incorrect type; correcting to transfer', {
                id: clone.id,
                originalType: clone.type,
            });
            clone.type = 'transfer';
        }
    }
    // Tags: deduplicate and sanitise
    if (Array.isArray(clone.tags)) {
        clone.tags = [...new Set(clone.tags.map((t) => String(t).trim().toLowerCase()))].filter(Boolean);
    }
    else {
        clone.tags = [];
    }
    // Metadata: never allow raw email body in metadata passed to client
    if (clone.metadata && typeof clone.metadata === 'object') {
        const meta = { ...clone.metadata };
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
function validateTransaction(transaction) {
    const result = CanonicalTransactionSchema.safeParse(transaction);
    if (result.success) {
        return { valid: true, transaction: result.data };
    }
    return { valid: false, errors: result.error.issues };
}
/**
 * Normalise then validate a transaction.
 * Convenience wrapper for the full pipeline.
 */
function normalizeAndValidate(raw) {
    const normalized = normalizeTransaction(raw);
    return validateTransaction(normalized);
}
/**
 * Validate a batch of transactions.
 * Returns valid ones and logs invalid ones (without financial data).
 */
function validateBatch(transactions) {
    const valid = [];
    let invalidCount = 0;
    for (const txn of transactions) {
        const result = normalizeAndValidate(txn);
        if (result.valid) {
            valid.push(result.transaction);
        }
        else {
            invalidCount++;
            logger_1.logger.warn('Transaction failed validation', {
                id: txn.id ?? 'unknown',
                errorCount: result.errors.length,
                fields: result.errors.map((e) => e.path.join('.')),
            });
        }
    }
    return { valid, invalidCount };
}
/**
 * Create a canonical transaction from a manual user entry.
 * Used by the /transactions endpoint for manual additions.
 */
function buildManualTransaction(input, userId) {
    const raw = {
        id: (0, uuid_1.v4)(),
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
        confidence: 1.0, // Manual entries are 100% confident
        parseStatus: 'success',
        rawAmount: `₹${(input.amount / 100).toFixed(2)}`,
        tags: input.tags ?? [],
        metadata: { userId },
    };
    return raw;
}
//# sourceMappingURL=normalizer.service.js.map