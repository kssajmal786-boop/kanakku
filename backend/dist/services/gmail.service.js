"use strict";
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
exports.FINANCIAL_SEARCH_QUERY = void 0;
exports.scoreCandidate = scoreCandidate;
exports.buildGmailDateQuery = buildGmailDateQuery;
exports.fetchFinancialEmails = fetchFinancialEmails;
exports.parseGmailMessage = parseGmailMessage;
exports.listRecentMessages = listRecentMessages;
exports.searchMessages = searchMessages;
exports.searchGmailTransactionsByDate = searchGmailTransactionsByDate;
const googleapis_1 = require("googleapis");
const html_entities_1 = require("html-entities");
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const db_1 = require("../db");
const gmailFetcher_service_1 = require("./gmailFetcher.service");
const email_parser_1 = require("../parsers/email.parser");
const geminiExtractor_service_1 = require("./geminiExtractor.service");
const deduplication_service_1 = require("./deduplication.service");
const normalizer_service_1 = require("./normalizer.service");
// ─── Financial Email Search Query ─────────────────────────────────────────────
/**
 * Positive financial keywords to identify bank, UPI, card, and transfer emails.
 */
const FINANCIAL_SEARCH_KEYWORDS = [
    // Core debit/credit keywords
    '{debited credited "account debited" "account credited"',
    '"amount debited" "amount credited" "has been debited" "has been credited"}',
    // UPI
    '{UPI "upi payment" "upi transfer" "upi credit" "upi debit"',
    '"paid via upi" "received via upi" "sent via upi"}',
    // Card transactions
    '{"card used" "card transaction" "card payment" "card purchase"',
    '"online purchase" "pos transaction" "card debited"}',
    // Bank transfers
    '{NEFT IMPS RTGS "fund transfer" "bank transfer" "transfer successful"}',
    // ATM
    '{"atm withdrawal" "cash withdrawal" "atm cash" "atm transaction"}',
    // Generic financial alerts
    '{"transaction alert" "payment alert" "bank alert" "banking alert"',
    '"money sent" "money received" "payment successful" "payment made"',
    '"transaction successful" "txn alert" "debit alert" "credit alert"}',
].join(' OR ');
/**
 * Negative keywords to immediately exclude non-transaction noise at the Gmail API query level.
 * Prevents marketing offers, security alerts, and OTPs from cluttering candidates.
 */
const FINANCIAL_EXCLUSIONS = [
    '-{"statement available"',
    '"e-statement"',
    '"account statement"',
    '"special offer"',
    '"pre-approved"',
    '"apply now"',
    '"credit card offer"',
    '"personal loan"',
    '"congratulations"',
    '"login alert"',
    '"security alert"',
    '"OTP"',
    '"one time password"',
    '"verification code"}',
].join(' ');
exports.FINANCIAL_SEARCH_QUERY = `(${FINANCIAL_SEARCH_KEYWORDS}) ${FINANCIAL_EXCLUSIONS}`;
// ─── Candidate Ranking & Pre-filtering ───────────────────────────────────────
/**
 * Score a candidate email based on subject, snippet, and sender domain.
 * Positive score = high probability of transaction.
 * Negative score = non-transaction (OTP, statement, marketing).
 */
function scoreCandidate(snippet, subject = '', from = '') {
    const text = `${subject} ${snippet} ${from}`.toLowerCase();
    // Immediate negative disqualifiers
    if (text.includes('otp') ||
        text.includes('one time password') ||
        text.includes('verification code') ||
        text.includes('login alert') ||
        text.includes('new login') ||
        text.includes('logged in from') ||
        text.includes('security alert') ||
        text.includes('password reset')) {
        return -20;
    }
    // Statements and promotional marketing
    if (text.includes('statement available') || text.includes('e-statement') || text.includes('monthly statement')) {
        return -10;
    }
    if (text.includes('pre-approved') ||
        text.includes('loan offer') ||
        text.includes('credit card offer') ||
        text.includes('apply now') ||
        text.includes('reward points') ||
        text.includes('special offer')) {
        return -8;
    }
    let score = 0;
    // Currency indicators
    if (text.includes('₹') || text.includes('rs.') || text.includes('inr')) {
        score += 5;
    }
    // Core debit/credit actions
    if (text.includes('debited') || text.includes('account debited') || text.includes('amount debited'))
        score += 10;
    if (text.includes('credited') || text.includes('account credited') || text.includes('amount credited'))
        score += 10;
    if (text.includes('upi payment') || text.includes('upi credit') || text.includes('paid via upi') || text.includes('received via upi'))
        score += 10;
    if (text.includes('card used') || text.includes('pos transaction') || text.includes('card debited'))
        score += 8;
    if (text.includes('neft') || text.includes('imps') || text.includes('rtgs') || text.includes('fund transfer'))
        score += 8;
    if (text.includes('atm withdrawal') || text.includes('cash withdrawal'))
        score += 10;
    if (text.includes('transaction successful') || text.includes('txn alert') || text.includes('payment successful'))
        score += 7;
    return score;
}
// ─── Date Query Utilities ───────────────────────────────────────────────────
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
function buildGmailDateQuery(startDate, endDate) {
    let start = new Date(startDate.substring(0, 10));
    let end = new Date(endDate.substring(0, 10));
    // If startDate > endDate, swap them gracefully
    if (start.getTime() > end.getTime()) {
        const temp = start;
        start = end;
        end = temp;
    }
    // Subtract 1 day from start date for inclusive after:
    const dayBefore = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const afterDate = dayBefore.toISOString().substring(0, 10).replace(/-/g, '/');
    // Add 1 day to end date for inclusive before:
    const dayAfter = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    const beforeDate = dayAfter.toISOString().substring(0, 10).replace(/-/g, '/');
    return {
        afterDate,
        beforeDate,
        queryFragment: `after:${afterDate} before:${beforeDate}`,
    };
}
// ─── Gmail API Wrapper ────────────────────────────────────────────────────────
function createGmailClient(auth) {
    return googleapis_1.google.gmail({ version: 'v1', auth });
}
/**
 * Fetch financial emails with rate-limiting, message caching, candidate ranking,
 * and deferred message cursor support.
 */
async function fetchFinancialEmails(auth, options = {}) {
    const gmail = createGmailClient(auth);
    const userId = options.userId || 'anonymous';
    const fetchBudget = options.fetchBudget ?? config_1.config.gmail.maxMessageFetches;
    const maxDiscoveryLimit = Math.min(options.maxResults ?? config_1.config.gmail.maxEmailsPerSync, 500);
    // 1. Retrieve existing sync state for user (if available)
    const existingSyncState = await db_1.db.getGmailSyncState(userId);
    // 2. Build intelligent date query
    let query = exports.FINANCIAL_SEARCH_QUERY;
    let queryDateUsed = null;
    if (options.startDate && options.endDate) {
        // A. Explicit date-range query
        const { afterDate, beforeDate, queryFragment } = buildGmailDateQuery(options.startDate, options.endDate);
        query += ` ${queryFragment}`;
        queryDateUsed = `${afterDate} to ${beforeDate}`;
    }
    else if (options.since) {
        // B. Explicit "since" query: ensure day is inclusive
        const sinceDate = new Date(options.since.substring(0, 10));
        const dayBefore = new Date(sinceDate.getTime() - 24 * 60 * 60 * 1000);
        const dateStr = dayBefore.toISOString().substring(0, 10).replace(/-/g, '/');
        query += ` after:${dateStr}`;
        queryDateUsed = dateStr;
    }
    else if (!options.forceFullScan &&
        existingSyncState?.last_successful_message_date) {
        // C. Incremental sync from last successfully synced message date (with 2-day safety overlap buffer)
        const lastMsgDate = new Date(existingSyncState.last_successful_message_date.substring(0, 10));
        const boundary = new Date(lastMsgDate.getTime() - 2 * 24 * 60 * 60 * 1000);
        // Bound by maximum lookback window so we never search older than lookbackDays (e.g. 30 days)
        const lookbackLimit = new Date();
        lookbackLimit.setDate(lookbackLimit.getDate() - (options.lookbackDays ?? config_1.config.gmail.initialLookbackDays));
        const effectiveDate = boundary > lookbackLimit ? boundary : lookbackLimit;
        const dateStr = effectiveDate.toISOString().substring(0, 10).replace(/-/g, '/');
        query += ` after:${dateStr}`;
        queryDateUsed = dateStr;
    }
    else {
        // D. Initial sync / Full historical sync: strictly use lookbackDays (default 30 days)
        const lookbackDays = options.lookbackDays ?? config_1.config.gmail.initialLookbackDays;
        const lookback = new Date();
        lookback.setDate(lookback.getDate() - lookbackDays);
        const dateStr = lookback.toISOString().substring(0, 10).replace(/-/g, '/');
        query += ` after:${dateStr}`;
        queryDateUsed = dateStr;
    }
    // 3. Check for deferred candidates from a previous partial/quota-exceeded sync
    let deferredFromPrior = [];
    if (existingSyncState?.deferred_message_ids) {
        try {
            const parsed = JSON.parse(existingSyncState.deferred_message_ids);
            if (Array.isArray(parsed)) {
                deferredFromPrior = parsed;
            }
        }
        catch {
            deferredFromPrior = [];
        }
    }
    // 4. Candidate Discovery via Gmail search
    const discoveredMessageIds = [];
    let pageToken;
    logger_1.logger.info('GMAIL SYNC START', {
        userId,
        queryDate: queryDateUsed,
        lookbackDays: config_1.config.gmail.initialLookbackDays,
        fetchBudget,
        priorDeferred: deferredFromPrior.length,
        concurrency: config_1.config.gmail.fetchConcurrency,
    });
    try {
        do {
            const listResponse = await (0, gmailFetcher_service_1.executeWithBackoff)(() => gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: Math.min(maxDiscoveryLimit - discoveredMessageIds.length, 100),
                pageToken,
            }), { label: 'Gmail messages.list' });
            const msgs = listResponse.data.messages ?? [];
            discoveredMessageIds.push(...msgs.map((m) => m.id).filter(Boolean));
            pageToken = listResponse.data.nextPageToken ?? undefined;
        } while (pageToken && discoveredMessageIds.length < maxDiscoveryLimit);
    }
    catch (err) {
        if ((0, gmailFetcher_service_1.isQuotaError)(err)) {
            logger_1.logger.warn('Gmail search encountered quota limit during message discovery');
            return {
                messages: [],
                nextHistoryId: null,
                messagesFound: deferredFromPrior.length,
                messagesFetched: 0,
                messagesDeferred: deferredFromPrior.length,
                quotaExceeded: true,
                errorType: 'GMAIL_QUOTA_EXCEEDED',
                syncStatus: 'quota_exceeded',
                syncMessage: 'Google temporarily limited Gmail search requests. Please wait a few moments before syncing again.',
            };
        }
        throw err;
    }
    // Combine discovered messages with previously deferred messages (preserving order, deduplicating IDs)
    const combinedIds = Array.from(new Set([...deferredFromPrior, ...discoveredMessageIds]));
    const totalFound = combinedIds.length;
    if (totalFound === 0) {
        logger_1.logger.info('GMAIL SYNC COMPLETE: no candidate messages found');
        const profileResponse = await gmail.users.getProfile({ userId: 'me' }).catch(() => null);
        const nextHistoryId = profileResponse?.data.historyId ?? null;
        return {
            messages: [],
            nextHistoryId,
            messagesFound: 0,
            messagesFetched: 0,
            messagesDeferred: 0,
            quotaExceeded: false,
            syncStatus: 'completed',
        };
    }
    // 5. CACHE FILTER: Filter out already-processed message IDs
    const alreadyProcessed = await db_1.db.getProcessedMessageIds(userId, combinedIds);
    const unprocessedIds = combinedIds.filter((id) => !alreadyProcessed.has(id));
    logger_1.logger.info('GMAIL DISCOVERY CANDIDATES', {
        totalFound,
        alreadyProcessed: alreadyProcessed.size,
        unprocessedCount: unprocessedIds.length,
    });
    if (unprocessedIds.length === 0) {
        logger_1.logger.info('GMAIL SYNC COMPLETE: all candidates already processed');
        const profileResponse = await gmail.users.getProfile({ userId: 'me' }).catch(() => null);
        const nextHistoryId = profileResponse?.data.historyId ?? null;
        await db_1.db.upsertGmailSyncState({
            user_id: userId,
            last_sync_completed_at: new Date().toISOString(),
            messages_found: totalFound,
            messages_processed: 0,
            messages_deferred: 0,
            deferred_message_ids: '[]',
            status: 'completed',
        });
        return {
            messages: [],
            nextHistoryId,
            messagesFound: totalFound,
            messagesFetched: 0,
            messagesDeferred: 0,
            quotaExceeded: false,
            syncStatus: 'completed',
        };
    }
    // 6. CANDIDATE METADATA & RANKING
    // Inspect metadata for a candidate slice (up to 30 items) to rank highest-probability transactions
    const inspectionSlice = unprocessedIds.slice(0, Math.min(unprocessedIds.length, Math.max(fetchBudget * 2, 30)));
    const remainingUninspected = unprocessedIds.slice(inspectionSlice.length);
    const { results: scoredCandidates, quotaExceeded: metadataQuotaHit } = await (0, gmailFetcher_service_1.fetchQueue)(inspectionSlice, async (id) => {
        const resp = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
        });
        const headers = resp.data.payload?.headers || [];
        const getHeader = (name) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
        const subject = getHeader('Subject');
        const from = getHeader('From');
        const snippet = resp.data.snippet || '';
        const score = scoreCandidate(snippet, subject, from);
        return { id, score, subject, snippet };
    }, {
        concurrency: config_1.config.gmail.fetchConcurrency,
        delayMs: config_1.config.gmail.fetchDelayMs,
        label: 'Gmail metadata ranking',
    });
    // Mark immediate non-transaction noise as 'skipped' so we never re-fetch them
    const toSkip = scoredCandidates.filter((c) => c.score <= -10);
    if (toSkip.length > 0) {
        const skipRecords = toSkip.map((c) => ({
            id: `gpm_${userId}_${c.id}`,
            user_id: userId,
            gmail_message_id: c.id,
            processed_at: new Date().toISOString(),
            status: 'skipped',
            transaction_id: null,
        }));
        await db_1.db.recordProcessedMessages(skipRecords);
        logger_1.logger.info(`Skipped ${toSkip.length} non-transaction emails (OTPs, statements, alerts)`);
    }
    // Sort candidate messages: highest score first
    const viableCandidates = scoredCandidates.filter((c) => c.score > -10);
    viableCandidates.sort((a, b) => b.score - a.score);
    // Selected candidate IDs for full body fetch up to fetchBudget
    const selectedForFetch = viableCandidates.slice(0, fetchBudget).map((c) => c.id);
    const deferredViable = viableCandidates.slice(fetchBudget).map((c) => c.id);
    const allDeferred = [...deferredViable, ...remainingUninspected];
    // 7. CONTROLLED FULL MESSAGE FETCH
    const fetchedMessages = [];
    let fullFetchQuotaExceeded = metadataQuotaHit;
    if (selectedForFetch.length > 0 && !fullFetchQuotaExceeded) {
        const queueResult = await (0, gmailFetcher_service_1.fetchQueue)(selectedForFetch, async (id) => {
            const resp = await gmail.users.messages.get({
                userId: 'me',
                id,
                format: 'full',
            });
            return resp.data;
        }, {
            concurrency: config_1.config.gmail.fetchConcurrency,
            delayMs: config_1.config.gmail.fetchDelayMs,
            maxBudget: fetchBudget,
            label: 'Gmail full message fetch',
        });
        fetchedMessages.push(...queueResult.results);
        fullFetchQuotaExceeded = queueResult.quotaExceeded;
        // Any items from selectedForFetch that failed or were not fetched are deferred
        if (queueResult.deferredItems.length > 0) {
            allDeferred.unshift(...queueResult.deferredItems);
        }
    }
    // Record successfully fetched messages in processed cache
    if (fetchedMessages.length > 0) {
        const processedRecords = fetchedMessages.map((msg) => ({
            id: `gpm_${userId}_${msg.id}`,
            user_id: userId,
            gmail_message_id: msg.id,
            processed_at: new Date().toISOString(),
            status: 'processed',
            transaction_id: null,
        }));
        await db_1.db.recordProcessedMessages(processedRecords);
    }
    // Find latest message date among fetched messages if any
    let latestMsgDate = existingSyncState?.last_successful_message_date ?? null;
    for (const m of fetchedMessages) {
        const internalDate = m.internalDate ? new Date(parseInt(m.internalDate, 10)).toISOString() : null;
        if (internalDate && (!latestMsgDate || internalDate > latestMsgDate)) {
            latestMsgDate = internalDate;
        }
    }
    // 8. Update sync state
    const syncStatus = fullFetchQuotaExceeded
        ? fetchedMessages.length > 0 ? 'partial' : 'quota_exceeded'
        : allDeferred.length > 0 ? 'partial' : 'completed';
    const profileResponse = await gmail.users.getProfile({ userId: 'me' }).catch(() => null);
    const nextHistoryId = profileResponse?.data.historyId ?? null;
    await db_1.db.upsertGmailSyncState({
        user_id: userId,
        last_sync_completed_at: new Date().toISOString(),
        last_successful_message_date: latestMsgDate,
        history_id: nextHistoryId,
        messages_found: totalFound,
        messages_processed: fetchedMessages.length,
        messages_deferred: allDeferred.length,
        deferred_message_ids: JSON.stringify(allDeferred),
        status: syncStatus,
    });
    // 9. AGGREGATE LOGGING
    logger_1.logger.info('GMAIL FETCH SUMMARY', {
        totalCandidates: totalFound,
        processed: fetchedMessages.length,
        deferred: allDeferred.length,
        quotaHit: fullFetchQuotaExceeded,
        syncStatus,
    });
    let syncMessage;
    if (fullFetchQuotaExceeded) {
        syncMessage = `Gmail found ${totalFound} candidate emails. Due to Google API rate limits, ${fetchedMessages.length} were processed and ${allDeferred.length} remain pending for the next sync.`;
    }
    else if (syncStatus === 'partial') {
        syncMessage = `Gmail found ${totalFound} candidate emails. Processed ${fetchedMessages.length} within the sync batch; ${allDeferred.length} deferred for subsequent sync.`;
    }
    return {
        messages: fetchedMessages,
        nextHistoryId,
        messagesFound: totalFound,
        messagesFetched: fetchedMessages.length,
        messagesDeferred: allDeferred.length,
        quotaExceeded: fullFetchQuotaExceeded,
        errorType: fullFetchQuotaExceeded ? 'GMAIL_QUOTA_EXCEEDED' : undefined,
        syncStatus,
        syncMessage,
    };
}
// ─── Email Parsing ────────────────────────────────────────────────────────────
/**
 * Convert a raw GmailMessage into a structured ParsedEmail.
 * Extracts headers, decodes MIME parts, and strips HTML.
 */
function parseGmailMessage(message) {
    const headers = message.payload?.headers ?? [];
    const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
    const subject = getHeader('Subject');
    const from = getHeader('From');
    const dateStr = getHeader('Date');
    // Extract sender email and domain
    const emailMatch = from.match(/[\w.+-]+@[\w.-]+\.\w+/);
    const senderEmail = emailMatch ? emailMatch[0].toLowerCase() : '';
    const senderDomain = senderEmail.split('@')[1] ?? '';
    // Parse date
    const date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
    // Extract MIME parts
    const { textBody, htmlBody } = extractMimeParts(message.payload);
    const htmlAsText = htmlToText(htmlBody);
    // Best-effort combined body (text preferred, HTML-as-text fallback)
    const combinedBody = textBody.trim() || htmlAsText.trim();
    return {
        messageId: message.id ?? '',
        threadId: message.threadId ?? '',
        subject,
        from,
        senderEmail,
        senderDomain,
        date,
        textBody,
        htmlBody,
        htmlAsText,
        combinedBody,
    };
}
/**
 * Recursively extract text/plain and text/html parts from a MIME payload.
 */
function extractMimeParts(payload) {
    if (!payload)
        return { textBody: '', htmlBody: '' };
    let textBody = '';
    let htmlBody = '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
        textBody = decodeBase64Url(payload.body.data);
    }
    else if (payload.mimeType === 'text/html' && payload.body?.data) {
        htmlBody = decodeBase64Url(payload.body.data);
    }
    for (const part of payload.parts ?? []) {
        const { textBody: t, htmlBody: h } = extractMimeParts(part);
        textBody += t;
        htmlBody += h;
    }
    return { textBody, htmlBody };
}
function decodeBase64Url(data) {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf8');
}
/**
 * Convert HTML email body to plain text.
 */
function htmlToText(html) {
    if (!html)
        return '';
    const $ = cheerio.load(html);
    // Remove non-content elements
    $('style, script, head, meta, link').remove();
    // Replace block elements with newlines
    $('br, p, div, tr, li, h1, h2, h3, h4, h5, h6').each((_, el) => {
        $(el).prepend('\n');
    });
    const text = $.root().text();
    return (0, html_entities_1.decode)(text)
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
async function listMessageIds(auth, query, maxResults) {
    const gmail = createGmailClient(auth);
    const capped = Math.min(Math.max(maxResults, 1), 25);
    const response = await (0, gmailFetcher_service_1.executeWithBackoff)(() => gmail.users.messages.list({
        userId: 'me',
        q: query || undefined,
        maxResults: capped,
    }), { label: 'listMessageIds' });
    return (response.data.messages || [])
        .map((m) => m.id)
        .filter((id) => !!id);
}
async function fetchSafeMetadata(auth, messageId) {
    const gmail = createGmailClient(auth);
    const { data } = await (0, gmailFetcher_service_1.executeWithBackoff)(() => gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
    }), { label: `fetchSafeMetadata (${messageId})` });
    if (!data.id)
        return null;
    const headers = data.payload?.headers || [];
    const getHeader = (name) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
    return {
        id: data.id,
        threadId: data.threadId || '',
        from: getHeader('From'),
        subject: getHeader('Subject') || '(no subject)',
        receivedAt: getHeader('Date') || null,
        snippet: data.snippet || '',
    };
}
/**
 * Retrieve recent messages' safe metadata with concurrency control.
 */
async function listRecentMessages(auth, maxResults = 10) {
    const ids = await listMessageIds(auth, '', maxResults);
    const queueResult = await (0, gmailFetcher_service_1.fetchQueue)(ids, async (id) => fetchSafeMetadata(auth, id), {
        concurrency: config_1.config.gmail.fetchConcurrency,
        delayMs: config_1.config.gmail.fetchDelayMs,
        label: 'listRecentMessages',
    });
    return queueResult.results;
}
/**
 * Search Gmail with a caller-supplied query, returning safe metadata with concurrency control.
 */
async function searchMessages(auth, query, maxResults = 10) {
    const ids = await listMessageIds(auth, query, maxResults);
    const queueResult = await (0, gmailFetcher_service_1.fetchQueue)(ids, async (id) => fetchSafeMetadata(auth, id), {
        concurrency: config_1.config.gmail.fetchConcurrency,
        delayMs: config_1.config.gmail.fetchDelayMs,
        label: 'searchMessages',
    });
    return queueResult.results;
}
/**
 * Search Gmail for transactions in a specific date range, using the existing
 * rate-limited fetch, ranking, extraction, validation, and deduplication pipeline.
 */
async function searchGmailTransactionsByDate(auth, options) {
    const { userId, startDate, endDate, query: userQuery, fetchBudget = config_1.config.gmail.maxMessageFetches, existingTransactions = [], useGemini = true, } = options;
    // Validate dates
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return {
            status: 'FAILED',
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
            syncMessage: 'Invalid date format. Dates must be YYYY-MM-DD.',
        };
    }
    // 1. Build inclusive date query
    const { queryFragment } = buildGmailDateQuery(startDate, endDate);
    let searchQuery = `(${exports.FINANCIAL_SEARCH_QUERY}) ${queryFragment}`;
    if (userQuery && userQuery.trim()) {
        searchQuery += ` (${userQuery.trim()})`;
    }
    logger_1.logger.info('GMAIL DATE-RANGE SEARCH START', {
        userId,
        startDate,
        endDate,
        userQuery,
        searchQueryPreview: searchQuery.substring(0, 100),
    });
    const gmail = createGmailClient(auth);
    let candidateIds = [];
    // 2. Discover candidates
    try {
        const listResp = await (0, gmailFetcher_service_1.executeWithBackoff)(() => gmail.users.messages.list({
            userId: 'me',
            q: searchQuery,
            maxResults: 50,
        }), { label: `searchTransactionsByDate:list (${startDate} to ${endDate})` });
        candidateIds = (listResp.data.messages || []).map((m) => m.id).filter(Boolean);
    }
    catch (err) {
        if ((0, gmailFetcher_service_1.isQuotaError)(err)) {
            return {
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
            };
        }
        throw err;
    }
    logger_1.logger.info(`Found ${candidateIds.length} candidate emails for date range ${startDate} to ${endDate}`);
    if (candidateIds.length === 0) {
        return {
            status: 'NO_MATCHES',
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
            syncMessage: `I checked your Gmail for ${startDate} to ${endDate} and found no matching financial emails.`,
        };
    }
    const { results: scoredCandidates } = await (0, gmailFetcher_service_1.fetchQueue)(candidateIds.slice(0, Math.min(candidateIds.length, 30)), async (id) => {
        const resp = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
        });
        const headers = resp.data.payload?.headers || [];
        const getH = (name) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
        const score = scoreCandidate(resp.data.snippet || '', getH('Subject'), getH('From'));
        return { id, score };
    }, {
        concurrency: config_1.config.gmail.fetchConcurrency,
        delayMs: config_1.config.gmail.fetchDelayMs,
        label: 'dateRange:metadataRanking',
    });
    // Disqualify noise (OTPs/statements) and sort by score
    const viable = scoredCandidates.filter((c) => c.score > -10);
    viable.sort((a, b) => b.score - a.score);
    const selectedIds = viable.slice(0, fetchBudget).map((c) => c.id);
    const messagesDeferred = Math.max(0, candidateIds.length - selectedIds.length);
    // 4. Fetch full messages with rate-limiting
    const fetchedMessages = [];
    let quotaHitDuringFetch = false;
    if (selectedIds.length > 0) {
        const queueRes = await (0, gmailFetcher_service_1.fetchQueue)(selectedIds, async (id) => {
            const resp = await gmail.users.messages.get({
                userId: 'me',
                id,
                format: 'full',
            });
            return resp.data;
        }, {
            concurrency: config_1.config.gmail.fetchConcurrency,
            delayMs: config_1.config.gmail.fetchDelayMs,
            maxBudget: fetchBudget,
            label: 'dateRange:fullFetch',
        });
        fetchedMessages.push(...queueRes.results);
        quotaHitDuringFetch = queueRes.quotaExceeded;
    }
    if (fetchedMessages.length === 0 && quotaHitDuringFetch) {
        return {
            status: 'QUOTA_EXCEEDED',
            transactions: [],
            count: 0,
            totalAmount: 0,
            startDate,
            endDate,
            emailsFound: candidateIds.length,
            emailsFetched: 0,
            messagesFound: candidateIds.length,
            messagesFetched: 0,
            messagesDeferred: candidateIds.length,
            duplicatesSkipped: 0,
            parseFailures: 0,
            needsReview: 0,
            syncedAt: new Date().toISOString(),
            syncMessage: 'Google temporarily limited Gmail requests. Some emails are pending and can be processed during the next sync.',
        };
    }
    // 5. Parse MIME messages
    const parsedEmails = fetchedMessages.map((m) => {
        try {
            return parseGmailMessage(m);
        }
        catch {
            return null;
        }
    }).filter((e) => e !== null);
    // 6. Extract transactions (Gemini with regex fallback)
    let extractedTransactions = [];
    let parseFailures = 0;
    let needsReview = 0;
    let extractionMethod = 'regex';
    if (useGemini) {
        const geminiRes = await (0, geminiExtractor_service_1.extractBatchWithGemini)(parsedEmails);
        if (geminiRes.geminiUsed) {
            extractionMethod = 'gemini';
            extractedTransactions = [...geminiRes.processed, ...geminiRes.needsReview];
            needsReview = geminiRes.needsReview.length;
            if (geminiRes.errors.length > 0) {
                const errIds = new Set(geminiRes.errors.map((e) => e.gmailMessageId));
                const errEmails = parsedEmails.filter((e) => errIds.has(e.messageId));
                const { parsed: fallbackParsed, failures: fallbackFailures } = (0, email_parser_1.parseEmailBatch)(errEmails);
                extractedTransactions.push(...fallbackParsed);
                parseFailures = fallbackFailures.length;
                if (geminiRes.processed.length > 0)
                    extractionMethod = 'gemini+regex';
            }
        }
        else {
            const { parsed, failures } = (0, email_parser_1.parseEmailBatch)(parsedEmails);
            extractedTransactions = parsed;
            parseFailures = failures.length;
        }
    }
    else {
        const { parsed, failures } = (0, email_parser_1.parseEmailBatch)(parsedEmails);
        extractedTransactions = parsed;
        parseFailures = failures.length;
    }
    parseFailures += (fetchedMessages.length - parsedEmails.length);
    // 7. Validate and deduplicate
    const { valid } = (0, normalizer_service_1.validateBatch)(extractedTransactions);
    const { unique, duplicatesSkipped } = (0, deduplication_service_1.deduplicateBatch)(valid, existingTransactions);
    // Filter to transactions strictly within requested date range
    const matchedTransactions = unique.filter((t) => {
        const txDate = t.date.substring(0, 10);
        return txDate >= startDate && txDate <= endDate;
    });
    // Calculate total amount in Rupees (t.amount is in paise)
    const totalAmount = matchedTransactions.reduce((sum, t) => sum + (t.amount / 100), 0);
    // Record processed message IDs in cache
    if (fetchedMessages.length > 0) {
        const processedRecords = fetchedMessages.map((m) => ({
            id: `gpm_${userId}_${m.id}`,
            user_id: userId,
            gmail_message_id: m.id,
            processed_at: new Date().toISOString(),
            status: 'processed',
            transaction_id: null,
        }));
        await db_1.db.recordProcessedMessages(processedRecords);
    }
    logger_1.logger.info('GMAIL DATE-RANGE SEARCH COMPLETE', {
        startDate,
        endDate,
        emailsFound: candidateIds.length,
        emailsFetched: fetchedMessages.length,
        transactionsExtracted: matchedTransactions.length,
        totalAmount,
        quotaHit: quotaHitDuringFetch,
    });
    return {
        status: matchedTransactions.length > 0 ? 'SUCCESS' : 'NO_MATCHES',
        transactions: matchedTransactions,
        count: matchedTransactions.length,
        totalAmount,
        startDate,
        endDate,
        emailsFound: candidateIds.length,
        emailsFetched: fetchedMessages.length,
        messagesFound: candidateIds.length,
        messagesFetched: fetchedMessages.length,
        messagesDeferred,
        duplicatesSkipped,
        parseFailures,
        needsReview,
        extractionMethod,
        syncedAt: new Date().toISOString(),
        syncMessage: matchedTransactions.length > 0
            ? `Found ${matchedTransactions.length} transaction${matchedTransactions.length !== 1 ? 's' : ''} between ${startDate} and ${endDate}.`
            : `Checked Gmail for ${startDate} to ${endDate} but found no matching transactions.`,
    };
}
//# sourceMappingURL=gmail.service.js.map