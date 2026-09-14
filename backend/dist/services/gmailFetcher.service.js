"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailQuotaExceededError = void 0;
exports.isQuotaError = isQuotaError;
exports.delay = delay;
exports.executeWithBackoff = executeWithBackoff;
exports.fetchQueue = fetchQueue;
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
class GmailQuotaExceededError extends Error {
    constructor(message, details) {
        super(message);
        this.isQuotaExceeded = true;
        this.errorType = 'GMAIL_QUOTA_EXCEEDED';
        this.retryable = true;
        this.name = 'GmailQuotaExceededError';
        if (details) {
            this.messagesFound = details.messagesFound;
            this.messagesFetched = details.messagesFetched;
            this.messagesDeferred = details.messagesDeferred;
        }
    }
}
exports.GmailQuotaExceededError = GmailQuotaExceededError;
/**
 * Detect whether an error from Google APIs indicates rate-limiting or quota exhaustion.
 */
function isQuotaError(err) {
    if (!err)
        return false;
    if (err instanceof GmailQuotaExceededError)
        return true;
    const error = err;
    const message = (error.message || '').toLowerCase();
    const code = error.code || error.status;
    // Check HTTP status code
    if (code === 429)
        return true;
    // Google APIs quota exceeded is usually returned as 403 Forbidden with specific reasons
    if (code === 403 || String(code) === '403') {
        if (message.includes('quota') ||
            message.includes('rate') ||
            message.includes('user rate limit') ||
            message.includes('query cost') ||
            message.includes('units per minute')) {
            return true;
        }
        if (error.errors && Array.isArray(error.errors)) {
            for (const e of error.errors) {
                const reason = (e.reason || '').toLowerCase();
                const msg = (e.message || '').toLowerCase();
                if (reason === 'ratequotaexceeded' ||
                    reason === 'useragentquotaexceeded' ||
                    reason === 'quotaperminute' ||
                    reason === 'userratelimitexceeded' ||
                    reason === 'dailyquotaexceeded' ||
                    msg.includes('quota') ||
                    msg.includes('rate limit')) {
                    return true;
                }
            }
        }
    }
    // Generic message checks
    return (message.includes('quota exceeded') ||
        message.includes('rate limit exceeded') ||
        message.includes('total query cost') ||
        message.includes('units per minute per user') ||
        message.includes('user rate limit exceeded') ||
        message.includes('resource exhausted'));
}
/**
 * Promise-based delay helper.
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Execute an asynchronous function with exponential backoff and jitter on quota errors.
 */
async function executeWithBackoff(fn, options = {}) {
    const maxRetries = options.maxRetries ?? config_1.config.gmail.retryLimit;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 10000;
    const label = options.label || 'Gmail operation';
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
            attempt++;
            const isQuota = isQuotaError(err);
            const isTerminalQuota = err instanceof GmailQuotaExceededError;
            if (isTerminalQuota || !isQuota || attempt > maxRetries) {
                if (isQuota && !isTerminalQuota) {
                    throw new GmailQuotaExceededError(`Gmail API quota exceeded after ${attempt - 1} retries for ${label}: ${err.message}`);
                }
                throw err;
            }
            // Exponential backoff: base * 2^(attempt-1) + jitter
            const expWait = baseDelayMs * Math.pow(2, attempt - 1);
            const jitter = Math.floor(Math.random() * 400);
            const waitMs = Math.min(expWait + jitter, maxDelayMs);
            logger_1.logger.warn(`Gmail API quota encountered during ${label}. Backing off...`, {
                attempt,
                maxRetries,
                waitMs,
                error: err.message,
            });
            if (options.onRetry) {
                options.onRetry(attempt, waitMs, err);
            }
            await delay(waitMs);
        }
    }
}
/**
 * Execute a task worker over a list of items using a controlled concurrency queue.
 * Stops immediately if a quota error occurs and preserves deferred items.
 */
async function fetchQueue(items, worker, options = {}) {
    const concurrency = Math.max(options.concurrency ?? config_1.config.gmail.fetchConcurrency, 1);
    const delayMs = Math.max(options.delayMs ?? config_1.config.gmail.fetchDelayMs, 0);
    const maxBudget = options.maxBudget ?? items.length;
    const label = options.label || 'Batch queue';
    const results = [];
    const processedItems = [];
    const errors = [];
    let quotaExceeded = false;
    let currentIndex = 0;
    const totalItems = items.length;
    logger_1.logger.info(`Starting ${label}`, {
        totalItems,
        concurrency,
        delayMs,
        maxBudget,
    });
    async function runner() {
        while (currentIndex < totalItems && !quotaExceeded) {
            if (results.length >= maxBudget) {
                // Fetch budget reached
                break;
            }
            const index = currentIndex++;
            const item = items[index];
            try {
                const res = await executeWithBackoff(() => worker(item, index), {
                    label: `${label} (item ${index + 1}/${totalItems})`,
                });
                if (res !== null && res !== undefined) {
                    results.push(res);
                }
                processedItems.push(item);
            }
            catch (err) {
                if (isQuotaError(err)) {
                    quotaExceeded = true;
                    logger_1.logger.warn(`Quota exceeded reached in ${label}. Halting queue.`, {
                        processedSoFar: processedItems.length,
                        remaining: totalItems - processedItems.length,
                    });
                    errors.push({ item, error: err });
                    break;
                }
                else {
                    errors.push({ item, error: err });
                }
            }
            if (delayMs > 0 && currentIndex < totalItems && !quotaExceeded) {
                await delay(delayMs);
            }
        }
    }
    // Spawn concurrency runners
    const workers = Array.from({ length: Math.min(concurrency, totalItems) }, () => runner());
    await Promise.all(workers);
    const processedSet = new Set(processedItems);
    const deferredItems = items.filter((item) => !processedSet.has(item));
    return {
        results,
        processedItems,
        deferredItems,
        errors,
        quotaExceeded,
    };
}
//# sourceMappingURL=gmailFetcher.service.js.map