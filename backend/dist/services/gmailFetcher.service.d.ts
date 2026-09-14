/**
 * Gmail Fetcher & Quota Management Service
 * ─────────────────────────────────────────────────────────────────────────
 * Provides resilient, rate-limited, and quota-aware retrieval for Gmail API:
 *  • Concurrency-controlled execution queue
 *  • Inter-request throttling
 *  • Explicit Google API quota error detection
 *  • Exponential backoff with jitter
 *  • Request budget enforcement
 *  • Graceful degradation on quota exhaustion
 * ─────────────────────────────────────────────────────────────────────────
 */
export declare class GmailQuotaExceededError extends Error {
    readonly isQuotaExceeded = true;
    readonly errorType = "GMAIL_QUOTA_EXCEEDED";
    readonly retryable = true;
    messagesFound?: number;
    messagesFetched?: number;
    messagesDeferred?: number;
    constructor(message: string, details?: {
        messagesFound?: number;
        messagesFetched?: number;
        messagesDeferred?: number;
    });
}
/**
 * Detect whether an error from Google APIs indicates rate-limiting or quota exhaustion.
 */
export declare function isQuotaError(err: unknown): boolean;
/**
 * Promise-based delay helper.
 */
export declare function delay(ms: number): Promise<void>;
export interface BackoffOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    label?: string;
    onRetry?: (attempt: number, delayMs: number, err: Error) => void;
}
/**
 * Execute an asynchronous function with exponential backoff and jitter on quota errors.
 */
export declare function executeWithBackoff<T>(fn: () => Promise<T>, options?: BackoffOptions): Promise<T>;
export interface FetchQueueOptions {
    concurrency?: number;
    delayMs?: number;
    maxBudget?: number;
    label?: string;
}
export interface FetchQueueResult<T, R> {
    results: R[];
    processedItems: T[];
    deferredItems: T[];
    errors: Array<{
        item: T;
        error: Error;
    }>;
    quotaExceeded: boolean;
}
/**
 * Execute a task worker over a list of items using a controlled concurrency queue.
 * Stops immediately if a quota error occurs and preserves deferred items.
 */
export declare function fetchQueue<T, R>(items: T[], worker: (item: T, index: number) => Promise<R | null>, options?: FetchQueueOptions): Promise<FetchQueueResult<T, R>>;
