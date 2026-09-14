/**
 * Gmail & Email Types
 */
export interface GmailMessage {
    id: string;
    threadId: string;
    labelIds?: string[];
    snippet?: string;
    payload?: GmailMessagePayload;
    internalDate?: string;
}
export interface GmailMessagePayload {
    mimeType: string;
    headers: GmailHeader[];
    body?: GmailBody;
    parts?: GmailMessagePayload[];
}
export interface GmailHeader {
    name: string;
    value: string;
}
export interface GmailBody {
    data?: string;
    size: number;
}
export interface ParsedEmail {
    messageId: string;
    threadId: string;
    subject: string;
    from: string;
    senderEmail: string;
    senderDomain: string;
    date: string;
    textBody: string;
    htmlBody: string;
    /** Plain text extracted from HTML (fallback) */
    htmlAsText: string;
    /** Combined best-effort plain text */
    combinedBody: string;
}
export interface GmailSyncRequest {
    /** If provided, only fetch emails after this date (ISO string) */
    since?: string;
    /** Maximum emails to fetch (capped by server config) */
    maxResults?: number;
    /** Gmail label IDs to restrict search (default: INBOX) */
    labelIds?: string[];
}
export interface GmailSyncResponse {
    transactions: import('./transaction.types').CanonicalTransaction[];
    syncedAt: string;
    totalEmailsProcessed: number;
    totalTransactionsParsed: number;
    duplicatesSkipped: number;
    parseFailures: number;
    nextSyncToken?: string;
    extractionMethod?: 'gemini' | 'regex' | string;
    needsReview?: number;
    status?: 'completed' | 'partial' | 'quota_exceeded' | 'error';
    messagesFound?: number;
    messagesFetched?: number;
    messagesDeferred?: number;
    errorType?: string;
    syncMessage?: string;
}
export interface GmailSyncState {
    /** Gmail history ID for incremental sync */
    historyId: string | null;
    /** ISO timestamp of last successful sync */
    lastSyncAt: string | null;
}
