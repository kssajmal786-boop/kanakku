/**
 * Gmail Fetcher, Rate Limiter & Message Cache Test Suite
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies:
 *  • Quota error detection for Google API quota / rate limits
 *  • Exponential backoff on quota errors
 *  • Concurrency queue and request budget enforcement
 *  • Candidate ranking and pre-filtering
 *  • Processed message ID caching and sync state persistence
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  isQuotaError,
  executeWithBackoff,
  fetchQueue,
  GmailQuotaExceededError,
} from '../../src/services/gmailFetcher.service';
import { scoreCandidate, FINANCIAL_SEARCH_QUERY } from '../../src/services/gmail.service';
import { db } from '../../src/db';

describe('Gmail Quota & Fetch Architecture Tests', () => {
  beforeAll(async () => {
    await db.init();
  });

  describe('1. Quota Error Detection', () => {
    test('detects 403 Units per minute per user quota error', () => {
      const err = {
        code: 403,
        message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'",
      };
      expect(isQuotaError(err)).toBe(true);
    });

    test('detects 403 rateLimitExceeded reason in errors array', () => {
      const err = {
        code: 403,
        message: 'Rate limit exceeded',
        errors: [{ reason: 'rateQuotaExceeded', message: 'User Rate Limit Exceeded' }],
      };
      expect(isQuotaError(err)).toBe(true);
    });

    test('detects 429 Too Many Requests', () => {
      const err = { code: 429, message: 'Too Many Requests' };
      expect(isQuotaError(err)).toBe(true);
    });

    test('detects GmailQuotaExceededError instance', () => {
      const err = new GmailQuotaExceededError('Quota exceeded');
      expect(isQuotaError(err)).toBe(true);
    });

    test('does NOT treat 404 or generic 500 as quota error', () => {
      expect(isQuotaError({ code: 404, message: 'Message not found' })).toBe(false);
      expect(isQuotaError({ code: 500, message: 'Internal server error' })).toBe(false);
      expect(isQuotaError(new Error('Network timeout'))).toBe(false);
    });
  });

  describe('2. Exponential Backoff & Retry Limit', () => {
    test('succeeds without retries when no error occurs', async () => {
      let calls = 0;
      const result = await executeWithBackoff(async () => {
        calls++;
        return 'success';
      }, { maxRetries: 2, baseDelayMs: 10 });

      expect(result).toBe('success');
      expect(calls).toBe(1);
    });

    test('retries on quota error and succeeds after backoff', async () => {
      let attempts = 0;
      const result = await executeWithBackoff(async () => {
        attempts++;
        if (attempts === 1) {
          throw { code: 403, message: 'Units per minute per user exceeded' };
        }
        return 'retry_succeeded';
      }, { maxRetries: 2, baseDelayMs: 10 });

      expect(result).toBe('retry_succeeded');
      expect(attempts).toBe(2);
    });

    test('throws GmailQuotaExceededError when retries are exhausted', async () => {
      let attempts = 0;
      await expect(
        executeWithBackoff(async () => {
          attempts++;
          throw { code: 403, message: 'Units per minute per user exceeded' };
        }, { maxRetries: 2, baseDelayMs: 10 })
      ).rejects.toThrow(GmailQuotaExceededError);

      expect(attempts).toBe(3); // Initial attempt + 2 retries
    });

    test('rethrows non-quota errors immediately without retrying', async () => {
      let attempts = 0;
      await expect(
        executeWithBackoff(async () => {
          attempts++;
          throw new Error('Immediate validation error');
        }, { maxRetries: 3, baseDelayMs: 10 })
      ).rejects.toThrow('Immediate validation error');

      expect(attempts).toBe(1);
    });
  });

  describe('3. Concurrency Queue & Fetch Budget', () => {
    test('respects maxBudget and defers remaining items', async () => {
      const items = ['msg_1', 'msg_2', 'msg_3', 'msg_4', 'msg_5', 'msg_6', 'msg_7'];
      const budget = 3;

      const queueResult = await fetchQueue(
        items,
        async (id) => ({ id, data: `content_${id}` }),
        { concurrency: 2, delayMs: 5, maxBudget: budget }
      );

      expect(queueResult.results.length).toBe(budget);
      expect(queueResult.processedItems.length).toBe(budget);
      expect(queueResult.deferredItems.length).toBe(items.length - budget);
      expect(queueResult.deferredItems).toEqual(['msg_4', 'msg_5', 'msg_6', 'msg_7']);
      expect(queueResult.quotaExceeded).toBe(false);
    });

    test('halts queue immediately on quota error and tracks deferred items', async () => {
      const items = ['msg_1', 'msg_2', 'msg_3', 'msg_4', 'msg_5'];

      const queueResult = await fetchQueue(
        items,
        async (id, idx) => {
          if (idx === 1) {
            throw new GmailQuotaExceededError('Quota exceeded mid-queue');
          }
          return { id };
        },
        { concurrency: 1, delayMs: 5 }
      );

      expect(queueResult.quotaExceeded).toBe(true);
      expect(queueResult.results.length).toBe(1); // Only msg_1 succeeded
      expect(queueResult.deferredItems).toContain('msg_2');
      expect(queueResult.deferredItems).toContain('msg_3');
      expect(queueResult.deferredItems).toContain('msg_4');
      expect(queueResult.deferredItems).toContain('msg_5');
    });
  });

  describe('4. Candidate Ranking & Query Exclusions', () => {
    test('scores transaction emails positively', () => {
      const upiScore = scoreCandidate('UPI payment of ₹500 to Swiggy was successful', 'Txn Alert', 'alerts@hdfcbank.com');
      expect(upiScore).toBeGreaterThanOrEqual(15);

      const debitScore = scoreCandidate('Your account has been debited by INR 1,200', 'Debit Alert', 'alerts@sbi.co.in');
      expect(debitScore).toBeGreaterThanOrEqual(15);

      const atmScore = scoreCandidate('ATM cash withdrawal of Rs. 2000 from ATM #102', 'ATM Alert', 'alerts@icicibank.com');
      expect(atmScore).toBeGreaterThanOrEqual(15);
    });

    test('scores non-transactions (OTPs, statements, offers) negatively', () => {
      const otpScore = scoreCandidate('Your OTP for login is 123456. Do not share.', 'Login OTP', 'alerts@bank.com');
      expect(otpScore).toBeLessThan(0);

      const statementScore = scoreCandidate('Your monthly account statement for August is available', 'E-Statement', 'service@bank.com');
      expect(statementScore).toBeLessThan(0);

      const offerScore = scoreCandidate('Special pre-approved loan offer of 5 lakhs! Apply now', 'Exclusive Offer', 'offers@bank.com');
      expect(offerScore).toBeLessThan(0);
    });

    test('search query includes exclusion terms for noise', () => {
      expect(FINANCIAL_SEARCH_QUERY).toContain('statement available');
      expect(FINANCIAL_SEARCH_QUERY).toContain('OTP');
      expect(FINANCIAL_SEARCH_QUERY).toContain('special offer');
      expect(FINANCIAL_SEARCH_QUERY).toContain('pre-approved');
    });
  });

  describe('5. Processed Message Caching & Sync State in Database', () => {
    const testUserId = `test_usr_${Date.now()}`;

    test('caches processed message IDs and skips them on subsequent check', async () => {
      const initialProcessed = await db.getProcessedMessageIds(testUserId, ['msg_a', 'msg_b', 'msg_c']);
      expect(initialProcessed.size).toBe(0);

      // Record msg_a and msg_b as processed
      await db.recordProcessedMessages([
        {
          id: `gpm_${testUserId}_msg_a`,
          user_id: testUserId,
          gmail_message_id: 'msg_a',
          processed_at: new Date().toISOString(),
          status: 'processed',
          transaction_id: 'tx_123',
        },
        {
          id: `gpm_${testUserId}_msg_b`,
          user_id: testUserId,
          gmail_message_id: 'msg_b',
          processed_at: new Date().toISOString(),
          status: 'skipped',
          transaction_id: null,
        },
      ]);

      const afterProcessed = await db.getProcessedMessageIds(testUserId, ['msg_a', 'msg_b', 'msg_c']);
      expect(afterProcessed.has('msg_a')).toBe(true);
      expect(afterProcessed.has('msg_b')).toBe(true);
      expect(afterProcessed.has('msg_c')).toBe(false);
    });

    test('persists and updates sync state with deferred message IDs', async () => {
      const state = await db.upsertGmailSyncState({
        user_id: testUserId,
        messages_found: 169,
        messages_processed: 20,
        messages_deferred: 149,
        deferred_message_ids: JSON.stringify(['msg_21', 'msg_22']),
        status: 'partial',
      });

      expect(state.user_id).toBe(testUserId);
      expect(state.messages_found).toBe(169);
      expect(state.messages_processed).toBe(20);
      expect(state.messages_deferred).toBe(149);
      expect(state.status).toBe('partial');

      const retrieved = await db.getGmailSyncState(testUserId);
      expect(retrieved?.messages_deferred).toBe(149);
      expect(JSON.parse(retrieved?.deferred_message_ids || '[]')).toEqual(['msg_21', 'msg_22']);
    });
  });
});
