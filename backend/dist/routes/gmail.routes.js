"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const rateLimit_middleware_1 = require("../middleware/rateLimit.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const auth_service_1 = require("../services/auth.service");
const gmail_service_1 = require("../services/gmail.service");
const gmailConnection_service_1 = require("../services/gmailConnection.service");
const email_parser_1 = require("../parsers/email.parser");
const geminiExtractor_service_1 = require("../services/geminiExtractor.service");
const deduplication_service_1 = require("../services/deduplication.service");
const normalizer_service_1 = require("../services/normalizer.service");
const response_1 = require("../utils/response");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const db_1 = require("../db");
const gmailFetcher_service_1 = require("../services/gmailFetcher.service");
const router = (0, express_1.Router)();
// All Gmail routes require authentication
router.use(auth_middleware_1.requireAuth);
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
router.post('/sync', rateLimit_middleware_1.gmailSyncRateLimiter, validation_middleware_1.validateGmailSync, async (req, res) => {
    const user = req.user;
    const { since, maxResults, historyId, existingTransactions = [], useGemini = true, // Default to Gemini; client can opt out
     } = req.body;
    logger_1.logger.info('Gmail sync started', {
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
            authClient = await (0, gmailConnection_service_1.getAuthenticatedClientForUser)(user.userId);
        }
        catch {
            // Persisted connection not available — use session-embedded token
            authClient = await (0, auth_service_1.createAuthenticatedClient)(user);
        }
        // ── 2. Fetch financial emails ────────────────────────────────────────
        const fetchResult = await (0, gmail_service_1.fetchFinancialEmails)(authClient, {
            userId: user.userId,
            since,
            maxResults,
            historyId,
        });
        const { messages, nextHistoryId, messagesFound, messagesFetched, messagesDeferred, quotaExceeded, errorType, syncStatus, syncMessage, } = fetchResult;
        if (messages.length === 0) {
            logger_1.logger.info('Gmail sync: no candidate emails fetched', {
                userId: user.userId,
                messagesFound,
                quotaExceeded,
            });
            const response = {
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
            (0, response_1.sendSuccess)(res, response);
            return;
        }
        logger_1.logger.info('Gmail sync: fetched candidate emails', {
            userId: user.userId,
            emailCount: messages.length,
            isIncremental: !!historyId,
        });
        // ── 3. Parse Gmail messages to ParsedEmail objects ───────────────────
        const parsedEmails = messages.map((msg) => {
            try {
                return (0, gmail_service_1.parseGmailMessage)(msg);
            }
            catch (err) {
                logger_1.logger.warn('Failed to parse Gmail message structure', {
                    messageId: msg.id,
                    error: err.message,
                });
                return null;
            }
        }).filter((e) => e !== null);
        logger_1.logger.info('Gmail sync: parsed email structures', {
            userId: user.userId,
            total: messages.length,
            parsedOk: parsedEmails.length,
            structureFailures: messages.length - parsedEmails.length,
        });
        // ── 4. Extract transactions (Gemini first, regex fallback) ──────────
        let allParsed = [];
        let parseFailureCount = 0;
        let needsReviewCount = 0;
        let extractionMethod = 'regex';
        if (useGemini) {
            // Try Gemini extraction
            const geminiResult = await (0, geminiExtractor_service_1.extractBatchWithGemini)(parsedEmails);
            if (geminiResult.geminiUsed) {
                extractionMethod = 'gemini';
                allParsed = [...geminiResult.processed, ...geminiResult.needsReview];
                needsReviewCount = geminiResult.needsReview.length;
                logger_1.logger.info('Gmail sync: Gemini extraction complete', {
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
                    logger_1.logger.info('Gmail sync: running regex fallback for Gemini-errored emails', {
                        userId: user.userId,
                        count: failedEmails.length,
                        errorReasons: geminiResult.errors.slice(0, 3).map((e) => e.error),
                    });
                    const { parsed: regexParsed, failures: regexFailures } = (0, email_parser_1.parseEmailBatch)(failedEmails);
                    allParsed = [...allParsed, ...regexParsed];
                    parseFailureCount = regexFailures.length; // Only regex failures are real failures now
                    extractionMethod = geminiResult.processed.length > 0 ? 'gemini+regex' : 'regex';
                    logger_1.logger.info('Gmail sync: regex fallback complete', {
                        userId: user.userId,
                        regexExtracted: regexParsed.length,
                        regexFailures: regexFailures.length,
                    });
                }
                else {
                    parseFailureCount = geminiResult.errors.length;
                }
            }
            else {
                // Gemini unavailable — fall back to regex
                logger_1.logger.info('Gmail sync: falling back to regex parser (Gemini unavailable)', {
                    userId: user.userId,
                });
                const { parsed, failures } = (0, email_parser_1.parseEmailBatch)(parsedEmails);
                allParsed = parsed;
                parseFailureCount = failures.length;
            }
        }
        else {
            // Client explicitly opted out of Gemini
            const { parsed, failures } = (0, email_parser_1.parseEmailBatch)(parsedEmails);
            allParsed = parsed;
            parseFailureCount = failures.length;
        }
        // ── 5. Validate & normalise ──────────────────────────────────────────
        const { valid: validTransactions, invalidCount } = (0, normalizer_service_1.validateBatch)(allParsed);
        // ── 6. Deduplicate against client-provided existing transactions ──────
        const { unique, duplicatesSkipped } = (0, deduplication_service_1.deduplicateBatch)(validTransactions, existingTransactions);
        logger_1.logger.info('Gmail sync complete', {
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
        const response = {
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
        (0, response_1.sendSuccess)(res, {
            ...response,
            extractionMethod,
            needsReview: needsReviewCount,
        });
    }
    catch (err) {
        if ((0, gmailFetcher_service_1.isQuotaError)(err)) {
            logger_1.logger.warn('Gmail sync stopped due to Google quota limit', {
                userId: user.userId,
                error: err.message,
            });
            (0, response_1.sendSuccess)(res, {
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
        const error = err;
        if ((error.message ?? '').includes('GMAIL_NOT_AVAILABLE')) {
            (0, response_1.sendError)(res, 'Gmail sync is only available for accounts signed in with Google.', 403, 'GMAIL_NOT_AVAILABLE');
            return;
        }
        if ((error.message ?? '').includes('GMAIL_NOT_CONNECTED')) {
            (0, response_1.sendError)(res, 'Gmail is not connected. Please connect Gmail first.', 409, 'GMAIL_NOT_CONNECTED');
            return;
        }
        if ((error.message ?? '').includes('GMAIL_ACCESS_REVOKED')) {
            (0, response_1.sendError)(res, 'Gmail access was revoked. Please reconnect Gmail.', 401, 'GMAIL_ACCESS_REVOKED');
            return;
        }
        if (error.code === 401 || (error.message ?? '').includes('invalid_grant')) {
            (0, response_1.sendError)(res, 'Gmail access expired. Please re-authenticate.', 401, 'GMAIL_AUTH_EXPIRED');
            return;
        }
        if (error.code === 403) {
            (0, response_1.sendError)(res, 'Gmail permission denied. Check OAuth scopes.', 403, 'GMAIL_PERMISSION_DENIED');
            return;
        }
        logger_1.logger.error('Gmail sync failed', {
            userId: user.userId,
            error: err.message,
        });
        (0, response_1.sendError)(res, 'Gmail sync failed. Please try again.', 500, 'SYNC_FAILED');
    }
});
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
router.post('/search-transactions', rateLimit_middleware_1.generalRateLimiter, async (req, res) => {
    const user = req.user;
    const { startDate, endDate, query, limit, existingTransactions = [], useGemini = true, } = req.body;
    if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
        (0, response_1.sendError)(res, 'startDate and endDate are required in YYYY-MM-DD format.', 400, 'INVALID_DATE_RANGE');
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        (0, response_1.sendError)(res, 'Dates must follow YYYY-MM-DD format.', 400, 'INVALID_DATE_FORMAT');
        return;
    }
    if (startDate > endDate) {
        (0, response_1.sendError)(res, 'startDate cannot be after endDate.', 400, 'INVALID_DATE_RANGE');
        return;
    }
    try {
        let authClient;
        try {
            authClient = await (0, gmailConnection_service_1.getAuthenticatedClientForUser)(user.userId);
        }
        catch {
            try {
                authClient = await (0, auth_service_1.createAuthenticatedClient)(user);
            }
            catch {
                (0, response_1.sendSuccess)(res, {
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
        const result = await (0, gmail_service_1.searchGmailTransactionsByDate)(authClient, {
            userId: user.userId,
            startDate,
            endDate,
            query,
            fetchBudget: limit ? Math.min(limit, config_1.config.gmail.maxMessageFetches) : config_1.config.gmail.maxMessageFetches,
            existingTransactions,
            useGemini,
        });
        await db_1.db.upsertGmailSyncState({
            user_id: user.userId,
            custom_start_date: startDate,
            custom_end_date: endDate,
        });
        (0, response_1.sendSuccess)(res, result);
    }
    catch (err) {
        if ((0, gmailFetcher_service_1.isQuotaError)(err)) {
            logger_1.logger.warn('Gmail date search hit quota limit', { userId: user.userId, error: err.message });
            (0, response_1.sendSuccess)(res, {
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
        const error = err;
        if ((error.message ?? '').includes('GMAIL_NOT_CONNECTED') ||
            (error.message ?? '').includes('GMAIL_NOT_AVAILABLE') ||
            (error.message ?? '').includes('GMAIL_ACCESS_REVOKED') ||
            error.code === 401 ||
            (error.message ?? '').includes('invalid_grant')) {
            (0, response_1.sendSuccess)(res, {
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
        logger_1.logger.error('Gmail date range search failed', {
            userId: user.userId,
            startDate,
            endDate,
            error: err.message,
        });
        (0, response_1.sendError)(res, 'Failed to search Gmail transactions for date range.', 500, 'SEARCH_FAILED');
    }
});
// ── GET /gmail/sync/status ────────────────────────────────────────────────────
/**
 * @description
 * Returns sync availability information.
 * The client uses this to determine whether a sync is appropriate.
 */
router.get('/sync/status', async (req, res) => {
    const userId = req.user?.userId;
    const syncState = userId ? await db_1.db.getGmailSyncState(userId) : null;
    (0, response_1.sendSuccess)(res, {
        available: true,
        serverTime: new Date().toISOString(),
        maxEmailsPerSync: config_1.config.gmail.maxEmailsPerSync,
        maxMessageFetches: config_1.config.gmail.maxMessageFetches,
        fetchConcurrency: config_1.config.gmail.fetchConcurrency,
        initialLookbackDays: config_1.config.gmail.initialLookbackDays,
        lastSyncState: syncState,
    });
});
// ── GET /gmail/sync/settings ──────────────────────────────────────────────────
/**
 * Returns the user's persisted custom date range and sync settings.
 */
router.get('/sync/settings', rateLimit_middleware_1.generalRateLimiter, async (req, res) => {
    const userId = req.user.userId;
    const syncState = await db_1.db.getGmailSyncState(userId);
    (0, response_1.sendSuccess)(res, {
        customStartDate: syncState?.custom_start_date || null,
        customEndDate: syncState?.custom_end_date || null,
        activePreset: syncState?.active_preset || null,
    });
});
// ── POST /gmail/sync/settings ─────────────────────────────────────────────────
/**
 * Persists the user's custom date range and sync settings.
 */
router.post('/sync/settings', rateLimit_middleware_1.generalRateLimiter, async (req, res) => {
    const userId = req.user.userId;
    const { customStartDate, customEndDate, activePreset } = req.body;
    const updated = await db_1.db.upsertGmailSyncState({
        user_id: userId,
        custom_start_date: customStartDate !== undefined ? customStartDate : undefined,
        custom_end_date: customEndDate !== undefined ? customEndDate : undefined,
        active_preset: activePreset !== undefined ? activePreset : undefined,
    });
    (0, response_1.sendSuccess)(res, {
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
router.get('/connect/status', rateLimit_middleware_1.generalRateLimiter, async (req, res) => {
    try {
        const status = await (0, gmailConnection_service_1.getGmailConnectionStatus)(req.user.userId);
        (0, response_1.sendSuccess)(res, status);
    }
    catch (err) {
        logger_1.logger.error('Failed to fetch Gmail connection status', { error: err.message });
        (0, response_1.sendError)(res, 'Failed to check Gmail connection status', 500);
    }
});
// ── POST /gmail/disconnect ────────────────────────────────────────────────────
/**
 * Disconnects Gmail: revokes the grant with Google (best-effort) and
 * deletes the stored credentials. Never touches the user's existing
 * Kanakku financial transactions (those live entirely on the client).
 */
router.post('/disconnect', rateLimit_middleware_1.generalRateLimiter, async (req, res) => {
    try {
        await (0, gmailConnection_service_1.disconnectGmail)(req.user.userId);
        logger_1.logger.info('Gmail disconnected', { userId: req.user.userId });
        (0, response_1.sendSuccess)(res, { connected: false });
    }
    catch (err) {
        logger_1.logger.error('Failed to disconnect Gmail', { userId: req.user.userId, error: err.message });
        (0, response_1.sendError)(res, 'Failed to disconnect Gmail', 500);
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
router.get('/messages', rateLimit_middleware_1.generalRateLimiter, async (req, res) => {
    const userId = req.user.userId;
    const maxResults = Math.min(parseInt(String(req.query.limit || '10'), 10) || 10, 25);
    try {
        const auth = await (0, gmailConnection_service_1.getAuthenticatedClientForUser)(userId);
        const messages = await (0, gmail_service_1.listRecentMessages)(auth, maxResults);
        (0, response_1.sendSuccess)(res, { messages, count: messages.length });
    }
    catch (err) {
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
router.get('/search', rateLimit_middleware_1.generalRateLimiter, async (req, res) => {
    const userId = req.user.userId;
    const query = String(req.query.q || '').trim();
    const maxResults = Math.min(parseInt(String(req.query.limit || '10'), 10) || 10, 25);
    if (!query) {
        (0, response_1.sendError)(res, 'A search query (?q=) is required, e.g. ?q=newer_than:30d', 400, 'MISSING_QUERY');
        return;
    }
    try {
        const auth = await (0, gmailConnection_service_1.getAuthenticatedClientForUser)(userId);
        const messages = await (0, gmail_service_1.searchMessages)(auth, query, maxResults);
        (0, response_1.sendSuccess)(res, { messages, count: messages.length, query });
    }
    catch (err) {
        handleGmailConnectionError(res, userId, err);
    }
});
function handleGmailConnectionError(res, userId, err) {
    const error = err;
    if (error.code === 'GMAIL_NOT_CONNECTED') {
        (0, response_1.sendError)(res, 'Gmail is not connected for this account.', 409, 'GMAIL_NOT_CONNECTED');
        return;
    }
    if (error.code === 'GMAIL_ACCESS_REVOKED') {
        (0, response_1.sendError)(res, 'Gmail access was revoked. Please reconnect.', 401, 'GMAIL_ACCESS_REVOKED');
        return;
    }
    if ((error.message || '').includes('insufficient') || (error.message || '').includes('403')) {
        (0, response_1.sendError)(res, 'Gmail permission denied. Please reconnect Gmail.', 403, 'GMAIL_PERMISSION_DENIED');
        return;
    }
    logger_1.logger.error('Gmail request failed', { userId, error: error.message });
    (0, response_1.sendError)(res, 'Could not reach Gmail. Please try again.', 500, 'GMAIL_REQUEST_FAILED');
}
exports.default = router;
//# sourceMappingURL=gmail.routes.js.map