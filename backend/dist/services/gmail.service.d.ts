/**
 * Gmail Service
 * ─────────────────────────────────────────────────────────────────────────
 * Responsible for:
 *  • Searching Gmail for financial alert emails with intelligent queries
 *  • Pre-filtering & ranking candidates via lightweight metadata
 *  • Fetching full email content using a rate-limited concurrency queue
 *  • Caching processed message IDs to avoid repeated API calls
 *  • Managing incremental sync and deferred candidate resumption
 *  • Providing quota-safe search and message listing
 *
 * Privacy rules:
 *  • Email body contents are NEVER logged
 *  • Only metadata (messageId, subject, senderDomain) may appear in logs
 *  • No raw email body data is persisted on the server
 * ─────────────────────────────────────────────────────────────────────────
 */
import { OAuth2Client } from 'google-auth-library';
import type { GmailMessage, ParsedEmail } from '../types/gmail.types';
import type { CanonicalTransaction } from '../types/transaction.types';
export declare const FINANCIAL_SEARCH_QUERY: string;
/**
 * Score a candidate email based on subject, snippet, and sender domain.
 * Positive score = high probability of transaction.
 * Negative score = non-transaction (OTP, statement, marketing).
 */
export declare function scoreCandidate(snippet: string, subject?: string, from?: string): number;
/**
 * Convert YYYY-MM-DD startDate and endDate into inclusive Gmail search query syntax.
 *
 * Gmail's 'after:YYYY/MM/DD' is exclusive of that day's start (finds messages sent after midnight).
 * Therefore, to inclusively capture all transactions on startDate, we use (startDate - 1 day).
 *
 * Gmail's 'before:YYYY/MM/DD' is exclusive of that day's end (finds messages sent before midnight).
 * Therefore, to inclusively capture all transactions on endDate, we use (endDate + 1 day).
 *
 * For single-day searches (startDate === endDate === '2026-09-01'), this generates:
 * after:2026/08/31 before:2026/09/02
 */
export declare function buildGmailDateQuery(startDate: string, endDate: string): {
    afterDate: string;
    beforeDate: string;
    queryFragment: string;
};
export interface FetchEmailsOptions {
    userId?: string;
    since?: string;
    startDate?: string;
    endDate?: string;
    maxResults?: number;
    historyId?: string;
    fetchBudget?: number;
    forceFullScan?: boolean;
    lookbackDays?: number;
}
export interface FetchEmailsResult {
    messages: GmailMessage[];
    nextHistoryId: string | null;
    messagesFound: number;
    messagesFetched: number;
    messagesDeferred: number;
    quotaExceeded: boolean;
    errorType?: string;
    syncStatus: 'completed' | 'partial' | 'quota_exceeded';
    syncMessage?: string;
}
/**
 * Fetch financial emails with rate-limiting, message caching, candidate ranking,
 * and deferred message cursor support.
 */
export declare function fetchFinancialEmails(auth: OAuth2Client, options?: FetchEmailsOptions): Promise<FetchEmailsResult>;
/**
 * Convert a raw GmailMessage into a structured ParsedEmail.
 * Extracts headers, decodes MIME parts, and strips HTML.
 */
export declare function parseGmailMessage(message: GmailMessage): ParsedEmail;
export interface SafeMessageSummary {
    id: string;
    threadId: string;
    from: string;
    subject: string;
    receivedAt: string | null;
    snippet: string;
}
/**
 * Retrieve recent messages' safe metadata with concurrency control.
 */
export declare function listRecentMessages(auth: OAuth2Client, maxResults?: number): Promise<SafeMessageSummary[]>;
/**
 * Search Gmail with a caller-supplied query, returning safe metadata with concurrency control.
 */
export declare function searchMessages(auth: OAuth2Client, query: string, maxResults?: number): Promise<SafeMessageSummary[]>;
export interface SearchTransactionsByDateOptions {
    userId: string;
    startDate: string;
    endDate: string;
    query?: string;
    fetchBudget?: number;
    existingTransactions?: CanonicalTransaction[];
    useGemini?: boolean;
}
export interface SearchTransactionsByDateResult {
    status: 'SUCCESS' | 'NO_MATCHES' | 'QUOTA_EXCEEDED' | 'GMAIL_AUTH_REQUIRED' | 'FAILED';
    transactions: CanonicalTransaction[];
    count: number;
    totalAmount: number;
    startDate: string;
    endDate: string;
    emailsFound: number;
    emailsFetched: number;
    messagesFound?: number;
    messagesFetched?: number;
    messagesDeferred?: number;
    duplicatesSkipped?: number;
    parseFailures?: number;
    needsReview?: number;
    extractionMethod?: string;
    syncedAt?: string;
    syncMessage: string;
}
/**
 * Search Gmail for transactions in a specific date range, using the existing
 * rate-limited fetch, ranking, extraction, validation, and deduplication pipeline.
 */
export declare function searchGmailTransactionsByDate(auth: OAuth2Client, options: SearchTransactionsByDateOptions): Promise<SearchTransactionsByDateResult>;
