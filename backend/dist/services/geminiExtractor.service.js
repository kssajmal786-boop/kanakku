"use strict";
/**
 * Gemini Transaction Extractor Service
 * ─────────────────────────────────────────────────────────────────────────
 * Uses Google Gemini AI to extract structured transaction data from
 * financial email content.
 *
 * Design principle: CODE COMPUTES, GEMINI INTERPRETS.
 *   • Gemini ONLY extracts/interprets email text into structured JSON
 *   • All validation, calculations, dedup, storage are done by app code
 *   • Gemini never sees OAuth tokens, API keys, or unrelated emails
 *
 * Fallback: If Gemini is unavailable (no API key, rate limit, error),
 * the system falls back to the existing regex-based parser pipeline.
 *
 * Privacy:
 *   • Only relevant email content is sent to Gemini
 *   • No full email bodies are logged
 *   • Only metadata (messageId, subject, senderDomain) may appear in logs
 * ─────────────────────────────────────────────────────────────────────────
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTransactionWithGemini = extractTransactionWithGemini;
exports.extractBatchWithGemini = extractBatchWithGemini;
const uuid_1 = require("uuid");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const date_parser_1 = require("../parsers/date.parser");
// Stable namespace UUID for deterministic transaction IDs (same as email.parser.ts)
const TRANSACTION_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
// ─── Gemini Prompt ────────────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `You are a financial transaction email analyzer for an Indian personal finance application.

TASK: Analyze the email content below and extract transaction information as structured JSON.

RULES:
1. Return ONLY valid JSON — no markdown, no explanation, no code fences.
2. If the email IS a financial transaction (debit, credit, refund, reversal), set "isTransaction": true and fill all fields.
3. If the email is NOT a transaction (OTP, promotional, newsletter, failed transaction, security alert, login alert, balance-only notification, advertisement), set "isTransaction": false and provide a "reason".
4. Amount must be a positive number in the email's currency (typically INR). Do NOT multiply by 100.
5. Date must be in YYYY-MM-DD format. Time in HH:MM:SS format (24h).
6. Transaction types: "expense" (money debited), "income" (money credited), "refund" (refund credited), "reversal" (transaction reversed), "failed" (transaction failed — NOT a real transaction), "pending" (not yet completed), "unknown" (cannot determine).
7. Payment methods: "upi", "card", "cash", "bank", "atm", "netbanking", "unknown".
8. Category should be one of: food, transport, shopping, entertainment, health, education, utilities, rent, salary, investment, subscription, insurance, tax, refund, bank_transfer, upi_transfer, atm_withdrawal, other, uncategorized.
9. Confidence is a number between 0.0 and 1.0 indicating how sure you are about the extraction.
10. Extract the merchant/payee name if visible. For UPI, prefer the merchant name over the VPA.
11. Extract the bank reference number / UTR / transaction ID if available.
12. Identify the bank name from the sender or email content.

RESPONSE SCHEMA (for transactions):
{
  "isTransaction": true,
  "transactionType": "expense",
  "amount": 500,
  "currency": "INR",
  "merchant": "Swiggy",
  "date": "2026-09-05",
  "time": "14:32:00",
  "paymentMethod": "upi",
  "referenceId": "UTR123456789",
  "bank": "HDFC Bank",
  "category": "food",
  "confidence": 0.95
}

RESPONSE SCHEMA (for non-transactions):
{
  "isTransaction": false,
  "reason": "OTP verification email"
}

EMAIL CONTENT:
`;
// ─── Core Extraction ──────────────────────────────────────────────────────────
/**
 * Extract transaction data from a single parsed email using Gemini.
 * Returns null if Gemini is unavailable.
 */
async function extractTransactionWithGemini(email) {
    const messageId = email.messageId;
    // Guard: Gemini must be available
    if (!config_1.config.gemini.isAvailable) {
        return {
            success: false,
            transaction: null,
            skipped: true,
            skipReason: 'Gemini API key not configured',
            needsReview: false,
            error: 'GEMINI_UNAVAILABLE',
            gmailMessageId: messageId,
        };
    }
    try {
        // Build focused content for Gemini (only what's needed)
        const emailContent = buildEmailContent(email);
        // Call Gemini
        const { GoogleGenAI } = await Promise.resolve().then(() => __importStar(require('@google/genai')));
        const ai = new GoogleGenAI({ apiKey: config_1.config.gemini.apiKey });
        const response = await ai.models.generateContent({
            model: config_1.config.gemini.model,
            contents: EXTRACTION_PROMPT + emailContent,
            config: {
                temperature: 0.1, // Low temperature for consistent structured output
                maxOutputTokens: 512,
            },
        });
        const rawText = response.text ?? '';
        // Parse Gemini's JSON response
        const extraction = parseGeminiResponse(rawText);
        if (!extraction) {
            logger_1.logger.warn('Gemini returned unparseable response', {
                messageId,
                senderDomain: email.senderDomain,
            });
            return {
                success: false,
                transaction: null,
                skipped: false,
                needsReview: false,
                error: 'Gemini returned malformed JSON',
                gmailMessageId: messageId,
            };
        }
        // Not a transaction? Skip it.
        if (!extraction.isTransaction) {
            return {
                success: true,
                transaction: null,
                skipped: true,
                skipReason: extraction.reason || 'Not a financial transaction',
                needsReview: false,
                gmailMessageId: messageId,
            };
        }
        // Skip failed/pending/unknown transaction types
        if (extraction.transactionType === 'failed' ||
            extraction.transactionType === 'pending' ||
            extraction.transactionType === 'unknown') {
            return {
                success: true,
                transaction: null,
                skipped: true,
                skipReason: `Transaction type: ${extraction.transactionType}`,
                needsReview: false,
                gmailMessageId: messageId,
            };
        }
        // Validate extraction before building transaction
        const validationErrors = validateExtraction(extraction);
        if (validationErrors.length > 0) {
            logger_1.logger.warn('Gemini extraction failed validation', {
                messageId,
                senderDomain: email.senderDomain,
                errors: validationErrors,
            });
            return {
                success: false,
                transaction: null,
                skipped: false,
                needsReview: false,
                error: `Validation failed: ${validationErrors.join(', ')}`,
                gmailMessageId: messageId,
            };
        }
        // Map to CanonicalTransaction
        const transaction = mapToCanonicalTransaction(extraction, email);
        const needsReview = (extraction.confidence ?? 0) < 0.5;
        return {
            success: true,
            transaction,
            skipped: false,
            needsReview,
            gmailMessageId: messageId,
        };
    }
    catch (err) {
        const error = err;
        logger_1.logger.error('Gemini extraction error', {
            messageId,
            senderDomain: email.senderDomain,
            error: error.message,
            status: error.status,
        });
        return {
            success: false,
            transaction: null,
            skipped: false,
            needsReview: false,
            error: error.message || 'Gemini API call failed',
            gmailMessageId: messageId,
        };
    }
}
/**
 * Process a batch of parsed emails through Gemini.
 * Errors are isolated per-email — one failure never crashes the batch.
 * Falls back to regex parser if Gemini is unavailable.
 */
async function extractBatchWithGemini(emails) {
    const processed = [];
    const needsReview = [];
    const errors = [];
    let skipped = 0;
    // If Gemini is not available, signal caller to use regex fallback
    if (!config_1.config.gemini.isAvailable) {
        logger_1.logger.info('Gemini unavailable — batch will use regex parser fallback');
        return {
            processed: [],
            skipped: 0,
            needsReview: [],
            errors: [],
            totalProcessed: 0,
            geminiUsed: false,
        };
    }
    logger_1.logger.info('Starting Gemini batch extraction', {
        emailCount: emails.length,
        model: config_1.config.gemini.model,
    });
    // Process emails sequentially to respect rate limits
    let consecutiveApiErrors = 0;
    const MAX_CONSECUTIVE_API_ERRORS = 3; // If 3 in a row fail with API errors, abort Gemini
    for (const email of emails) {
        try {
            const result = await extractTransactionWithGemini(email);
            if (result.skipped) {
                skipped++;
                consecutiveApiErrors = 0; // Reset on success/skip
                continue;
            }
            if (!result.success || !result.transaction) {
                // Check if this is an API-level error (403, quota, disabled)
                const isApiError = !!(result.error && (result.error.includes('403') ||
                    result.error.includes('quota') ||
                    result.error.includes('not been used') ||
                    result.error.includes('disabled') ||
                    result.error.includes('PERMISSION_DENIED') ||
                    result.error.includes('API_KEY_INVALID')));
                errors.push({
                    gmailMessageId: email.messageId,
                    subject: email.subject.substring(0, 100),
                    error: result.error || 'Extraction failed',
                });
                if (isApiError) {
                    consecutiveApiErrors++;
                    if (consecutiveApiErrors >= MAX_CONSECUTIVE_API_ERRORS) {
                        logger_1.logger.warn('Gemini API returning persistent errors — aborting Gemini extraction, regex fallback will handle remaining emails', {
                            consecutiveErrors: consecutiveApiErrors,
                            emailsProcessed: errors.length + processed.length + skipped,
                            emailsRemaining: emails.length - errors.length - processed.length - skipped,
                        });
                        // Mark as not used so gmail.routes.ts falls back entirely to regex
                        return {
                            processed,
                            skipped,
                            needsReview,
                            errors,
                            totalProcessed: emails.length,
                            geminiUsed: false, // <— tells routes.ts to use regex for ALL remaining
                        };
                    }
                }
                else {
                    consecutiveApiErrors = 0;
                }
                continue;
            }
            consecutiveApiErrors = 0;
            if (result.needsReview) {
                needsReview.push(result.transaction);
            }
            else {
                processed.push(result.transaction);
            }
        }
        catch (err) {
            // Isolate per-email errors
            errors.push({
                gmailMessageId: email.messageId,
                subject: email.subject.substring(0, 100),
                error: err.message || 'Unexpected error',
            });
        }
    }
    logger_1.logger.info('Gemini batch extraction complete', {
        total: emails.length,
        extracted: processed.length,
        needsReview: needsReview.length,
        skipped,
        errors: errors.length,
    });
    return {
        processed,
        skipped,
        needsReview,
        errors,
        totalProcessed: emails.length,
        geminiUsed: true,
    };
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Build focused email content for Gemini prompt.
 * Only includes what's needed for transaction extraction.
 */
function buildEmailContent(email) {
    const parts = [];
    parts.push(`From: ${email.from}`);
    parts.push(`Subject: ${email.subject}`);
    parts.push(`Date: ${email.date}`);
    parts.push('');
    // Use combined body (text preferred, HTML-as-text fallback)
    // Cap at 2000 chars to avoid excessive token usage
    const body = email.combinedBody.substring(0, 2000);
    parts.push(body);
    return parts.join('\n');
}
/**
 * Parse Gemini's response into structured JSON.
 * Handles various response formats (raw JSON, markdown-wrapped, etc.)
 */
function parseGeminiResponse(rawText) {
    if (!rawText || rawText.trim().length === 0)
        return null;
    let cleaned = rawText.trim();
    // Strip markdown code fences if present
    if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    }
    else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
    }
    cleaned = cleaned.trim();
    try {
        const parsed = JSON.parse(cleaned);
        // Basic structural validation
        if (typeof parsed.isTransaction !== 'boolean')
            return null;
        return parsed;
    }
    catch {
        // Try to extract JSON from surrounding text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (typeof parsed.isTransaction !== 'boolean')
                    return null;
                return parsed;
            }
            catch {
                return null;
            }
        }
        return null;
    }
}
/**
 * Validate the extracted data before mapping to CanonicalTransaction.
 * Returns an array of error messages (empty = valid).
 */
function validateExtraction(extraction) {
    const errors = [];
    if (extraction.amount === undefined || extraction.amount === null) {
        errors.push('Missing amount');
    }
    else if (typeof extraction.amount !== 'number' || extraction.amount <= 0) {
        errors.push(`Invalid amount: ${extraction.amount}`);
    }
    if (!extraction.transactionType) {
        errors.push('Missing transaction type');
    }
    if (!extraction.date) {
        errors.push('Missing date');
    }
    else if (!/^\d{4}-\d{2}-\d{2}/.test(extraction.date)) {
        errors.push(`Invalid date format: ${extraction.date}`);
    }
    const validCurrencies = ['INR', 'USD', 'EUR', 'GBP'];
    if (extraction.currency && !validCurrencies.includes(extraction.currency.toUpperCase())) {
        // Not fatal — default to INR
    }
    return errors;
}
/**
 * Map Gemini's extraction result to a CanonicalTransaction.
 * APPLICATION CODE does the mapping — Gemini only interprets.
 */
function mapToCanonicalTransaction(extraction, email) {
    // Map Gemini transaction type → canonical TransactionType
    const type = mapTransactionType(extraction.transactionType);
    // Map payment method
    const paymentMethod = mapPaymentMethod(extraction.paymentMethod);
    // Map category
    const category = mapCategory(extraction.category, type);
    // Convert amount from rupees to paise (integer)
    const amountPaise = Math.round((extraction.amount ?? 0) * 100);
    // Build date string
    const dateStr = extraction.date || email.date;
    const timeStr = extraction.time || '';
    const fullDate = timeStr
        ? `${dateStr}T${timeStr}`
        : dateStr;
    // Generate stable deterministic ID
    const id = generateTransactionId({
        gmailMessageId: email.messageId,
        amount: amountPaise,
        dateOnly: (0, date_parser_1.toDateOnly)(fullDate),
        paymentMethod,
    });
    // Build description
    const description = buildDescription(extraction, type);
    // Reference
    const reference = extraction.referenceId?.trim().toUpperCase() || null;
    const confidence = Math.max(0, Math.min(1, extraction.confidence ?? 0.7));
    const transaction = {
        id,
        date: fullDate,
        amount: amountPaise,
        currency: (extraction.currency || 'INR').toUpperCase(),
        type,
        category,
        paymentMethod,
        source: 'gmail',
        description,
        merchant: extraction.merchant?.trim().substring(0, 100) || null,
        reference,
        createdAt: new Date().toISOString(),
        linkedTxnId: null,
        confidence,
        parseStatus: (confidence >= 0.7 ? 'success' : confidence >= 0.4 ? 'partial' : 'failed'),
        rawAmount: extraction.amount ? `₹${extraction.amount.toLocaleString('en-IN')}` : null,
        tags: buildTags(extraction),
        metadata: {
            gmailMessageId: email.messageId,
            gmailThreadId: email.threadId,
            senderEmail: email.senderEmail,
            bankName: extraction.bank || inferBankFromDomain(email.senderDomain),
            upiVpa: undefined,
            emailSubject: email.subject.substring(0, 150),
            parserNotes: `gemini:${config_1.config.gemini.model}`,
            extractionMethod: 'gemini',
        },
    };
    return transaction;
}
/**
 * Map Gemini's transaction type to the canonical TransactionType.
 * refund/reversal → income; failed/pending/unknown → expense (should be filtered out before here)
 */
function mapTransactionType(geminiType) {
    switch (geminiType) {
        case 'income':
            return 'income';
        case 'expense':
            return 'expense';
        case 'refund':
        case 'reversal':
            return 'income'; // Refunds/reversals are money coming back
        default:
            return 'expense';
    }
}
/**
 * Map Gemini's payment method to canonical PaymentMethod.
 */
function mapPaymentMethod(method) {
    const valid = ['upi', 'card', 'cash', 'bank', 'atm', 'netbanking', 'unknown'];
    if (method && valid.includes(method)) {
        return method;
    }
    return 'unknown';
}
/**
 * Map Gemini's category to canonical TransactionCategory.
 */
function mapCategory(category, type) {
    const validCategories = [
        'food', 'transport', 'shopping', 'entertainment', 'health', 'education',
        'utilities', 'rent', 'salary', 'investment', 'atm_withdrawal', 'bank_transfer',
        'upi_transfer', 'refund', 'subscription', 'insurance', 'tax', 'other', 'uncategorized',
    ];
    if (category && validCategories.includes(category)) {
        return category;
    }
    // Reasonable defaults based on type
    if (type === 'income')
        return 'salary';
    return 'uncategorized';
}
/**
 * Build human-readable description from extraction.
 */
function buildDescription(extraction, type) {
    const merchant = extraction.merchant;
    const geminiType = extraction.transactionType;
    if (geminiType === 'refund' && merchant) {
        return `Refund from ${merchant}`;
    }
    if (geminiType === 'reversal' && merchant) {
        return `Reversal from ${merchant}`;
    }
    if (type === 'income' && merchant) {
        return `Received from ${merchant}`;
    }
    if (merchant) {
        return `Payment to ${merchant}`;
    }
    // Fallback
    if (type === 'income')
        return 'Income received';
    return 'Payment';
}
/**
 * Build tags from extraction.
 */
function buildTags(extraction) {
    const tags = [];
    if (extraction.paymentMethod === 'upi')
        tags.push('upi');
    if (extraction.paymentMethod === 'card')
        tags.push('card');
    if (extraction.paymentMethod === 'atm')
        tags.push('atm', 'cash-out');
    if (extraction.transactionType === 'refund')
        tags.push('refund');
    if (extraction.transactionType === 'reversal')
        tags.push('reversal');
    tags.push('gemini-extracted');
    return tags;
}
/**
 * Generate a deterministic transaction ID from dedup signals.
 */
function generateTransactionId(signals) {
    const seed = `${signals.gmailMessageId}:${signals.amount}:${signals.dateOnly}:${signals.paymentMethod}`;
    return (0, uuid_1.v5)(seed, TRANSACTION_ID_NAMESPACE);
}
/**
 * Infer bank name from sender domain.
 */
function inferBankFromDomain(domain) {
    const BANK_NAMES = {
        'hdfcbank.com': 'HDFC Bank',
        'icicibank.com': 'ICICI Bank',
        'axisbank.com': 'Axis Bank',
        'sbi.co.in': 'State Bank of India',
        'onlinesbi.com': 'State Bank of India',
        'kotak.com': 'Kotak Mahindra Bank',
        'kotakbank.com': 'Kotak Mahindra Bank',
        'pnb.co.in': 'Punjab National Bank',
        'bankofbaroda.com': 'Bank of Baroda',
        'canarabank.com': 'Canara Bank',
        'indusind.com': 'IndusInd Bank',
        'yesbank.in': 'Yes Bank',
        'paytmbank.com': 'Paytm Payments Bank',
        'paytm.com': 'Paytm',
        'phonepe.com': 'PhonePe',
        'unionbankofindia.com': 'Union Bank of India',
        'federalbank.co.in': 'Federal Bank',
        'rblbank.com': 'RBL Bank',
        'southindianbank.com': 'South Indian Bank',
    };
    return BANK_NAMES[domain];
}
//# sourceMappingURL=geminiExtractor.service.js.map