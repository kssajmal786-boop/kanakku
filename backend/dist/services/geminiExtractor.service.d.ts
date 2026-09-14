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
import type { ParsedEmail } from '../types/gmail.types';
import type { CanonicalTransaction } from '../types/transaction.types';
/**
 * The structured JSON schema Gemini is asked to return.
 * This is the "interpretation" output that application code then validates.
 */
export interface GeminiExtractionResult {
    isTransaction: boolean;
    transactionType?: 'expense' | 'income' | 'refund' | 'reversal' | 'failed' | 'pending' | 'unknown';
    amount?: number;
    currency?: string;
    merchant?: string;
    date?: string;
    time?: string;
    paymentMethod?: 'upi' | 'card' | 'cash' | 'bank' | 'atm' | 'netbanking' | 'unknown';
    referenceId?: string;
    bank?: string;
    category?: string;
    confidence?: number;
    reason?: string;
}
/**
 * Result of processing a single email through Gemini.
 */
export interface GeminiProcessResult {
    success: boolean;
    transaction: CanonicalTransaction | null;
    skipped: boolean;
    skipReason?: string;
    needsReview: boolean;
    error?: string;
    gmailMessageId: string;
}
/**
 * Result of processing a batch of emails through Gemini.
 */
export interface GeminiBatchResult {
    processed: CanonicalTransaction[];
    skipped: number;
    needsReview: CanonicalTransaction[];
    errors: Array<{
        gmailMessageId: string;
        subject: string;
        error: string;
    }>;
    totalProcessed: number;
    geminiUsed: boolean;
}
/**
 * Extract transaction data from a single parsed email using Gemini.
 * Returns null if Gemini is unavailable.
 */
export declare function extractTransactionWithGemini(email: ParsedEmail): Promise<GeminiProcessResult>;
/**
 * Process a batch of parsed emails through Gemini.
 * Errors are isolated per-email — one failure never crashes the batch.
 * Falls back to regex parser if Gemini is unavailable.
 */
export declare function extractBatchWithGemini(emails: ParsedEmail[]): Promise<GeminiBatchResult>;
