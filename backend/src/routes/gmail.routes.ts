/**
 * Gmail Sync Routes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POST /gmail/sync        → Full or incremental Gmail sync
 * GET  /gmail/sync/status → Check sync availability / last sync info
 *
 * The sync result is returned directly to the client (no persistence).
 * The client is responsible for storing transactions locally (local-first).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { gmailSyncRateLimiter, generalRateLimiter } from '../middleware/rateLimit.middleware';
import { validateGmailSync } from '../middleware/validation.middleware';
import { createAuthenticatedClient } from '../services/auth.service';
import {
  fetchFinancialEmails,
  parseGmailMessage,
  listRecentMessages,
  searchMessages,
  searchGmailTransactionsByDate,
} from '../services/gmail.service';
import {
  getGmailConnectionStatus,
  getAuthenticatedClientForUser,
  disconnectGmail,
} from '../services/gmailConnection.service';
import { parseEmailBatch } from '../parsers/email.parser';
import { extractBatchWithGemini } from '../services/geminiExtractor.service';
import { deduplicateBatch } from '../services/deduplication.service';
import { validateBatch } from '../services/normalizer.service';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';
import { config } from '../config';
import { db } from '../db';
import { isQuotaError } from '../services/gmailFetcher.service';
import type { GmailSyncResponse } from '../types/gmail.types';
import type { CanonicalTransaction } from '../types/transaction.types';

const router = Router();

// All Gmail routes require authentication
router.use(requireAuth);

// ── POST /gmail/sync ──────────────────────────────────────────────────────────
/**
 * @description
 * Fetches financial emails from Gmail, parses them into transactions,
 * deduplicates against the client-provided existing transactions, and
 * returns the unique new transactions.
 *
 * Request body (optional):
 *   since           - ISO date; only fetch emails after this date
 *   maxResults      - Max emails to fetch (server-capped at 500)
 *   historyId       - Gmail history ID for incremental sync
 *   existingIds     - Array of existing transaction IDs (for deduplication)
 *   existingSignals - Array of lightweight dedup signals from existing local transactions
 *
 * Response:
 *   GmailSyncResponse containing unique parsed transactions
 */
router.post(
  '/sync',
  gmailSyncRateLimiter,
  validateGmailSync,
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;

    const {
      since,
      maxResults,
      historyId,
      existingTransactions = [],
      useGemini = true,  // Default to Gemini; client can opt out
    } = req.body as {
      since?: string;
      maxResults?: number;
      historyId?: string;
      existingTransactions?: Partial<CanonicalTransaction>[];
      useGemini?: boolean;
    };

    logger.info('Gmail sync started', {
      userId: user.userId,
      isIncremental: !!historyId,
      existingCount: existingTransactions.length,
      useGemini,
    });

    try {
      // ── 1. Create authenticated Gmail client ─────────────────────────────
      // Try persisted Gmail connection first, fall back to session token
      let authClient;
      try {
        authClient = await getAuthenticatedClientForUser(user.userId);
      } catch {
        // Persisted connection not available — use session-embedded token
        authClient = await createAuthenticatedClient(user);
      }

      // ── 2. Fetch financial emails ────────────────────────────────────────
      const fetchResult = await fetchFinancialEmails(authClient, {
        userId: user.userId,
        since,
        maxResults,
        historyId,
      });

      const {
        messages,
        nextHistoryId,
        messagesFound,
        messagesFetched,
        messagesDeferred,
        quotaExceeded,
        errorType,
        syncStatus,
        syncMessage,
      } = fetchResult;

      if (messages.length === 0) {
        logger.info('Gmail sync: no candidate emails fetched', {
          userId: user.userId,
          messagesFound,
          quotaExceeded,
        });
        const response: GmailSyncResponse = {
          transactions: [],
          syncedAt: new Date().toISOString(),
          totalEmailsProcessed: 0,
          totalTransactionsParsed: 0,
          duplicatesSkipped: 0,
          parseFailures: 0,
          nextSyncToken: nextHistoryId ?? undefined,
          status: syncStatus,
          messagesFound,
          messagesFetched: 0,
          messagesDeferred,
          errorType,
          syncMessage: syncMessage || (quotaExceeded
            ? 'Google temporarily limited Gmail message retrieval. Pending emails will be retrieved on next sync.'
            : 'No new financial emails found matching search query.'),
        };
        sendSuccess(res, response);
        return;
      }

      logger.info('Gmail sync: fetched candidate emails', {
        userId: user.userId,
        emailCount: messages.length,
        isIncremental: !!historyId,
      });

      // ── 3. Parse Gmail messages to ParsedEmail objects ───────────────────
      const parsedEmails = messages.map((msg) => {
        try {
          return parseGmailMessage(msg);
        } catch (err) {
          logger.warn('Failed to parse Gmail message structure', {
            messageId: msg.id,
            error: (err as Error).message,
          });
          return null;
        }
      }).filter((e): e is NonNullable<typeof e> => e !== null);

      logger.info('Gmail sync: parsed email structures', {
        userId: user.userId,
        total: messages.length,
        parsedOk: parsedEmails.length,
        structureFailures: messages.length - parsedEmails.length,
      });

      // ── 4. Extract transactions (Gemini first, regex fallback) ──────────
      let allParsed: CanonicalTransaction[] = [];
      let parseFailureCount = 0;
      let needsReviewCount = 0;
      let extractionMethod = 'regex';

      if (useGemini) {
        // Try Gemini extraction
        const geminiResult = await extractBatchWithGemini(parsedEmails);

        if (geminiResult.geminiUsed) {
          extractionMethod = 'gemini';
          allParsed = [...geminiResult.processed, ...geminiResult.needsReview];
          needsReviewCount = geminiResult.needsReview.length;

          logger.info('Gmail sync: Gemini extraction complete', {
            userId: user.userId,
            extracted: geminiResult.processed.length,
            needsReview: geminiResult.needsReview.length,
            skipped: geminiResult.skipped,
            errors: geminiResult.errors.length,
          });

          // ── CRITICAL: Regex fallback for Gemini-errored emails ──────────
          // When Gemini returns 403/quota/model errors, affected emails land
          // in geminiResult.errors. Without this fallback those emails produce
          // zero transactions. Run the regex parser on every failed email so
          // we don't lose real transactions just because Gemini had an error.
          if (geminiResult.errors.length > 0) {
            const failedIds = new Set(geminiResult.errors.map((e) => e.gmailMessageId));
            const failedEmails = parsedEmails.filter((e) => failedIds.has(e.messageId));

            logger.info('Gmail sync: running regex fallback for Gemini-errored emails', {
              userId: user.userId,
              count: failedEmails.length,
              errorReasons: geminiResult.errors.slice(0, 3).map((e) => e.error),
            });

            const { parsed: regexParsed, failures: regexFailures } = parseEmailBatch(failedEmails);
            allParsed = [...allParsed, ...regexParsed];
            parseFailureCount = regexFailures.length; // Only regex failures are real failures now
            extractionMethod = geminiResult.processed.length > 0 ? 'gemini+regex' : 'regex';

            logger.info('Gmail sync: regex fallback complete', {
              userId: user.userId,
              regexExtracted: regexParsed.length,
              regexFailures: regexFailures.length,
            });
          } else {
            parseFailureCount = geminiResult.errors.length;
          }
        } else {
          // Gemini unavailable — fall back to regex
          logger.info('Gmail sync: falling back to regex parser (Gemini unavailable)', {
            userId: user.userId,
          });
          const { parsed, failures } = parseEmailBatch(parsedEmails);
          allParsed = parsed;
          parseFailureCount = failures.length;
        }
      } else {
        // Client explicitly opted out of Gemini
        const { parsed, failures } = parseEmailBatch(parsedEmails);
        allParsed = parsed;
        parseFailureCount = failures.length;
      }

      // ── 5. Validate & normalise ──────────────────────────────────────────
      const { valid: validTransactions, invalidCount } = validateBatch(allParsed);

      // ── 6. Deduplicate against client-provided existing transactions ──────
      const { unique, duplicatesSkipped } = deduplicateBatch(
        validTransactions,
        existingTransactions as CanonicalTransaction[]
      );

      logger.info('Gmail sync complete', {
        userId: user.userId,
        emailsFetched: messages.length,
        parsed: allParsed.length,
        valid: validTransactions.length,
        invalid: invalidCount,
        unique: unique.length,
        duplicatesSkipped,
        parseFailures: parseFailureCount,
        needsReview: needsReviewCount,
        extractionMethod,
      });

      const response: GmailSyncResponse = {
        transactions: unique,
        syncedAt: new Date().toISOString(),
        totalEmailsProcessed: messages.length,
        totalTransactionsParsed: unique.length,
        duplicatesSkipped,
        parseFailures: parseFailureCount,
        nextSyncToken: nextHistoryId ?? undefined,
        status: syncStatus,
        messagesFound,
        messagesFetched: messages.length,
        messagesDeferred,
        errorType,
        syncMessage,
      };

      sendSuccess(res, {
        ...response,
        extractionMethod,
        needsReview: needsReviewCount,
      });
    } catch (err: unknown) {
      if (isQuotaError(err)) {
        logger.warn('Gmail sync stopped due to Google quota limit', {
          userId: user.userId,
          error: (err as Error).message,
        });
        sendSuccess(res, {
          transactions: [],
          syncedAt: new Date().toISOString(),
          totalEmailsProcessed: 0,
          totalTransactionsParsed: 0,
          duplicatesSkipped: 0,
          parseFailures: 0,
          status: 'quota_exceeded',
          errorType: 'GMAIL_QUOTA_EXCEEDED',
          syncMessage: 'Google temporarily rate-limited message retrieval. Pending emails will be retrieved during the next sync.',
        });
        return;
      }

      const error = err as { code?: number; message?: string };

      if ((error.message ?? '').includes('GMAIL_NOT_AVAILABLE')) {
        sendError(res, 'Gmail sync is only available for accounts signed in with Google.', 403, 'GMAIL_NOT_AVAILABLE');
        return;
      }

      if ((error.message ?? '').includes('GMAIL_NOT_CONNECTED')) {
        sendError(res, 'Gmail is not connected. Please connect Gmail first.', 409, 'GMAIL_NOT_CONNECTED');
        return;
      }

      if ((error.message ?? '').includes('GMAIL_ACCESS_REVOKED')) {
        sendError(res, 'Gmail access was revoked. Please reconnect Gmail.', 401, 'GMAIL_ACCESS_REVOKED');
        return;
      }

      if (error.code === 401 || (error.message ?? '').includes('invalid_grant')) {
        sendError(res, 'Gmail access expired. Please re-authenticate.', 401, 'GMAIL_AUTH_EXPIRED');
        return;
      }

      if (error.code === 403) {
        sendError(res, 'Gmail permission denied. Check OAuth scopes.', 403, 'GMAIL_PERMISSION_DENIED');
        return;
      }

      logger.error('Gmail sync failed', {
        userId: user.userId,
        error: (err as Error).message,
      });

      sendError(res, 'Gmail sync failed. Please try again.', 500, 'SYNC_FAILED');
    }
  }
);

// ── POST /gmail/search-transactions ──────────────────────────────────────────
/**
 * @description
 * Searches Gmail for transactions within a specific date range [startDate, endDate].
 * Uses rate-limited fetching, scoring, MIME parsing, Gemini/regex extraction,
 * validation, deduplication, and caching in gmail_processed_messages.
 *
 * Request body:
 *   startDate             - YYYY-MM-DD (required)
 *   endDate               - YYYY-MM-DD (required)
 *   query                 - optional Gmail query or merchant/text filter
 *   limit                 - optional fetch budget (server capped at config.gmail.maxMessageFetches)
 *   existingTransactions  - optional array of local CanonicalTransactions for deduplication
 *   useGemini             - optional boolean (default true)
 *
 * Response:
 *   SearchTransactionsByDateResult
 */
router.post(
  '/search-transactions',
  generalRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const {
      startDate,
      endDate,
      query,
      limit,
      existingTransactions = [],
      useGemini = true,
    } = req.body as {
      startDate?: string;
      endDate?: string;
      query?: string;
      limit?: number;
      existingTransactions?: CanonicalTransaction[];
      useGemini?: boolean;
    };

    if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
      sendError(res, 'startDate and endDate are required in YYYY-MM-DD format.', 400, 'INVALID_DATE_RANGE');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      sendError(res, 'Dates must follow YYYY-MM-DD format.', 400, 'INVALID_DATE_FORMAT');
      return;
    }

    if (startDate > endDate) {
      sendError(res, 'startDate cannot be after endDate.', 400, 'INVALID_DATE_RANGE');
      return;
    }

    try {
      let authClient;
      try {
        authClient = await getAuthenticatedClientForUser(user.userId);
      } catch {
        try {
          authClient = await createAuthenticatedClient(user);
        } catch {
          sendSuccess(res, {
            status: 'GMAIL_AUTH_REQUIRED',
            transactions: [],
            count: 0,
            totalAmount: 0,
            startDate,
            endDate,
            emailsFound: 0,
            emailsFetched: 0,
            syncMessage: 'Gmail is not connected. Please connect Gmail first in Settings.',
          });
          return;
        }
      }

      const result = await searchGmailTransactionsByDate(authClient, {
        userId: user.userId,
        startDate,
        endDate,
        query,
        fetchBudget: limit ? Math.min(limit, config.gmail.maxMessageFetches) : config.gmail.maxMessageFetches,
        existingTransactions,
        useGemini,
      });

      await db.upsertGmailSyncState({
        user_id: user.userId,
        custom_start_date: startDate,
        custom_end_date: endDate,
      });

      sendSuccess(res, result);
    } catch (err: unknown) {
      if (isQuotaError(err)) {
        logger.warn('Gmail date search hit quota limit', { userId: user.userId, error: (err as Error).message });
        sendSuccess(res, {
          status: 'QUOTA_EXCEEDED',
          transactions: [],
          count: 0,
          totalAmount: 0,
          startDate,
          endDate,
          emailsFound: 0,
          emailsFetched: 0,
          messagesFound: 0,
          messagesFetched: 0,
          messagesDeferred: 0,
          duplicatesSkipped: 0,
          parseFailures: 0,
          needsReview: 0,
          syncedAt: new Date().toISOString(),
          syncMessage: 'Google temporarily limited Gmail requests. Some emails are pending and can be processed during the next sync.',
        });
        return;
      }

      const error = err as { code?: number | string; message?: string };
      if (
        (error.message ?? '').includes('GMAIL_NOT_CONNECTED') ||
        (error.message ?? '').includes('GMAIL_NOT_AVAILABLE') ||
        (error.message ?? '').includes('GMAIL_ACCESS_REVOKED') ||
        error.code === 401 ||
        (error.message ?? '').includes('invalid_grant')
      ) {
        sendSuccess(res, {
          status: 'GMAIL_AUTH_REQUIRED',
          transactions: [],
          count: 0,
          totalAmount: 0,
          startDate,
          endDate,
          emailsFound: 0,
          emailsFetched: 0,
          syncMessage: 'Gmail authorization expired or not connected. Please reconnect Gmail.',
        });
        return;
      }

      logger.error('Gmail date range search failed', {
        userId: user.userId,
        startDate,
        endDate,
        error: (err as Error).message,
      });

      sendError(res, 'Failed to search Gmail transactions for date range.', 500, 'SEARCH_FAILED');
    }
  }
);

// ── GET /gmail/sync/status ────────────────────────────────────────────────────
/**
 * @description
 * Returns sync availability information.
 * The client uses this to determine whether a sync is appropriate.
 */
router.get('/sync/status', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId;
  const syncState = userId ? await db.getGmailSyncState(userId) : null;
  sendSuccess(res, {
    available: true,
    serverTime: new Date().toISOString(),
    maxEmailsPerSync: config.gmail.maxEmailsPerSync,
    maxMessageFetches: config.gmail.maxMessageFetches,
    fetchConcurrency: config.gmail.fetchConcurrency,
    initialLookbackDays: config.gmail.initialLookbackDays,
    lastSyncState: syncState,
  });
});

// ── GET /gmail/sync/settings ──────────────────────────────────────────────────
/**
 * Returns the user's persisted custom date range and sync settings.
 */
router.get('/sync/settings', generalRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const syncState = await db.getGmailSyncState(userId);
  sendSuccess(res, {
    customStartDate: syncState?.custom_start_date || null,
    customEndDate: syncState?.custom_end_date || null,
    activePreset: syncState?.active_preset || null,
  });
});

// ── POST /gmail/sync/settings ─────────────────────────────────────────────────
/**
 * Persists the user's custom date range and sync settings.
 */
router.post('/sync/settings', generalRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { customStartDate, customEndDate, activePreset } = req.body as {
    customStartDate?: string;
    customEndDate?: string;
    activePreset?: string;
  };

  const updated = await db.upsertGmailSyncState({
    user_id: userId,
    custom_start_date: customStartDate !== undefined ? customStartDate : undefined,
    custom_end_date: customEndDate !== undefined ? customEndDate : undefined,
    active_preset: activePreset !== undefined ? activePreset : undefined,
  });

  sendSuccess(res, {
    customStartDate: updated.custom_start_date || null,
    customEndDate: updated.custom_end_date || null,
    activePreset: updated.active_preset || null,
  });
});

// ── GET /gmail/connect/status ─────────────────────────────────────────────────
/**
 * Whether the current user has a persisted Gmail connection (independent
 * of how they logged into Kanakku). Returns only safe metadata — never
 * tokens.
 */
router.get('/connect/status', generalRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const status = await getGmailConnectionStatus(req.user!.userId);
    sendSuccess(res, status);
  } catch (err) {
    logger.error('Failed to fetch Gmail connection status', { error: (err as Error).message });
    sendError(res, 'Failed to check Gmail connection status', 500);
  }
});

// ── POST /gmail/disconnect ────────────────────────────────────────────────────
/**
 * Disconnects Gmail: revokes the grant with Google (best-effort) and
 * deletes the stored credentials. Never touches the user's existing
 * Kanakku financial transactions (those live entirely on the client).
 */
router.post('/disconnect', generalRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    await disconnectGmail(req.user!.userId);
    logger.info('Gmail disconnected', { userId: req.user!.userId });
    sendSuccess(res, { connected: false });
  } catch (err) {
    logger.error('Failed to disconnect Gmail', { userId: req.user!.userId, error: (err as Error).message });
    sendError(res, 'Failed to disconnect Gmail', 500);
  }
});

// ── GET /gmail/messages ───────────────────────────────────────────────────────
/**
 * Test endpoint: retrieves the latest N messages' SAFE metadata only
 * (sender, subject, received date, id, threadId, snippet). No email
 * bodies, no attachments, no bank/transaction parsing — this only
 * proves the connect → authenticate → read pipeline works end to end.
 *
 * Uses the PERSISTED Gmail connection (gmail_connections table), not
 * the login-session's embedded token — so this works the same whether
 * the user logged in via Google or via email/password, as long as
 * they've connected Gmail via /auth/gmail/connect.
 */
router.get('/messages', generalRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const maxResults = Math.min(parseInt(String(req.query.limit || '10'), 10) || 10, 25);

  try {
    const auth = await getAuthenticatedClientForUser(userId);
    const messages = await listRecentMessages(auth, maxResults);
    sendSuccess(res, { messages, count: messages.length });
  } catch (err) {
    handleGmailConnectionError(res, userId, err);
  }
});

// ── GET /gmail/search ─────────────────────────────────────────────────────────
/**
 * Test endpoint: searches Gmail with a caller-supplied query (e.g.
 * "newer_than:30d", "from:bank.com"), returning SAFE metadata only.
 * Proves search capability for a future transaction-detection stage —
 * no bank-specific parsing happens here.
 */
router.get('/search', generalRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const query = String(req.query.q || '').trim();
  const maxResults = Math.min(parseInt(String(req.query.limit || '10'), 10) || 10, 25);

  if (!query) {
    sendError(res, 'A search query (?q=) is required, e.g. ?q=newer_than:30d', 400, 'MISSING_QUERY');
    return;
  }

  try {
    const auth = await getAuthenticatedClientForUser(userId);
    const messages = await searchMessages(auth, query, maxResults);
    sendSuccess(res, { messages, count: messages.length, query });
  } catch (err) {
    handleGmailConnectionError(res, userId, err);
  }
});

function handleGmailConnectionError(res: Response, userId: string, err: unknown): void {
  const error = err as { code?: string; message?: string };

  if (error.code === 'GMAIL_NOT_CONNECTED') {
    sendError(res, 'Gmail is not connected for this account.', 409, 'GMAIL_NOT_CONNECTED');
    return;
  }
  if (error.code === 'GMAIL_ACCESS_REVOKED') {
    sendError(res, 'Gmail access was revoked. Please reconnect.', 401, 'GMAIL_ACCESS_REVOKED');
    return;
  }
  if ((error.message || '').includes('insufficient') || (error.message || '').includes('403')) {
    sendError(res, 'Gmail permission denied. Please reconnect Gmail.', 403, 'GMAIL_PERMISSION_DENIED');
    return;
  }

  logger.error('Gmail request failed', { userId, error: error.message });
  sendError(res, 'Could not reach Gmail. Please try again.', 500, 'GMAIL_REQUEST_FAILED');
}

export default router;
