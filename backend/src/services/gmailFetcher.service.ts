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

import { logger } from '../utils/logger';
import { config } from '../config';

export class GmailQuotaExceededError extends Error {
  public readonly isQuotaExceeded = true;
  public readonly errorType = 'GMAIL_QUOTA_EXCEEDED';
  public readonly retryable = true;
  public messagesFound?: number;
  public messagesFetched?: number;
  public messagesDeferred?: number;

  constructor(message: string, details?: { messagesFound?: number; messagesFetched?: number; messagesDeferred?: number }) {
    super(message);
    this.name = 'GmailQuotaExceededError';
    if (details) {
      this.messagesFound = details.messagesFound;
      this.messagesFetched = details.messagesFetched;
      this.messagesDeferred = details.messagesDeferred;
    }
  }
}

/**
 * Detect whether an error from Google APIs indicates rate-limiting or quota exhaustion.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof GmailQuotaExceededError) return true;

  const error = err as { code?: number | string; status?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> };
  const message = (error.message || '').toLowerCase();
  const code = error.code || error.status;

  // Check HTTP status code
  if (code === 429) return true;

  // Google APIs quota exceeded is usually returned as 403 Forbidden with specific reasons
  if (code === 403 || String(code) === '403') {
    if (
      message.includes('quota') ||
      message.includes('rate') ||
      message.includes('user rate limit') ||
      message.includes('query cost') ||
      message.includes('units per minute')
    ) {
      return true;
    }

    if (error.errors && Array.isArray(error.errors)) {
      for (const e of error.errors) {
        const reason = (e.reason || '').toLowerCase();
        const msg = (e.message || '').toLowerCase();
        if (
          reason === 'ratequotaexceeded' ||
          reason === 'useragentquotaexceeded' ||
          reason === 'quotaperminute' ||
          reason === 'userratelimitexceeded' ||
          reason === 'dailyquotaexceeded' ||
          msg.includes('quota') ||
          msg.includes('rate limit')
        ) {
          return true;
        }
      }
    }
  }

  // Generic message checks
  return (
    message.includes('quota exceeded') ||
    message.includes('rate limit exceeded') ||
    message.includes('total query cost') ||
    message.includes('units per minute per user') ||
    message.includes('user rate limit exceeded') ||
    message.includes('resource exhausted')
  );
}

/**
 * Promise-based delay helper.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
export async function executeWithBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? config.gmail.retryLimit;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const label = options.label || 'Gmail operation';

  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      const isQuota = isQuotaError(err);
      const isTerminalQuota = err instanceof GmailQuotaExceededError;

      if (isTerminalQuota || !isQuota || attempt > maxRetries) {
        if (isQuota && !isTerminalQuota) {
          throw new GmailQuotaExceededError(
            `Gmail API quota exceeded after ${attempt - 1} retries for ${label}: ${(err as Error).message}`
          );
        }
        throw err;
      }

      // Exponential backoff: base * 2^(attempt-1) + jitter
      const expWait = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 400);
      const waitMs = Math.min(expWait + jitter, maxDelayMs);

      logger.warn(`Gmail API quota encountered during ${label}. Backing off...`, {
        attempt,
        maxRetries,
        waitMs,
        error: (err as Error).message,
      });

      if (options.onRetry) {
        options.onRetry(attempt, waitMs, err as Error);
      }

      await delay(waitMs);
    }
  }
}

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
  errors: Array<{ item: T; error: Error }>;
  quotaExceeded: boolean;
}

/**
 * Execute a task worker over a list of items using a controlled concurrency queue.
 * Stops immediately if a quota error occurs and preserves deferred items.
 */
export async function fetchQueue<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R | null>,
  options: FetchQueueOptions = {}
): Promise<FetchQueueResult<T, R>> {
  const concurrency = Math.max(options.concurrency ?? config.gmail.fetchConcurrency, 1);
  const delayMs = Math.max(options.delayMs ?? config.gmail.fetchDelayMs, 0);
  const maxBudget = options.maxBudget ?? items.length;
  const label = options.label || 'Batch queue';

  const results: R[] = [];
  const processedItems: T[] = [];
  const errors: Array<{ item: T; error: Error }> = [];
  let quotaExceeded = false;

  let currentIndex = 0;
  const totalItems = items.length;

  logger.info(`Starting ${label}`, {
    totalItems,
    concurrency,
    delayMs,
    maxBudget,
  });

  async function runner(): Promise<void> {
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
      } catch (err: unknown) {
        if (isQuotaError(err)) {
          quotaExceeded = true;
          logger.warn(`Quota exceeded reached in ${label}. Halting queue.`, {
            processedSoFar: processedItems.length,
            remaining: totalItems - processedItems.length,
          });
          errors.push({ item, error: err as Error });
          break;
        } else {
          errors.push({ item, error: err as Error });
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
