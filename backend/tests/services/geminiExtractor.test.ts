/**
 * Tests: Gemini Transaction Extractor Service
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies that the Gemini extraction layer properly interprets financial emails,
 * maps them to CanonicalTransaction, handles edge cases, respects confidence
 * thresholds, and recovers gracefully from errors.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { extractTransactionWithGemini, extractBatchWithGemini } from '../../src/services/geminiExtractor.service';
import { makeParsedEmail } from '../helpers/fixtures';

// Mock @google/genai
const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('Gemini Transaction Extractor Service', () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-gemini-api-key';
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  describe('extractTransactionWithGemini', () => {
    test('successfully extracts a valid UPI debit/expense transaction', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'expense',
          amount: 2500,
          currency: 'INR',
          merchant: 'Zomato',
          date: '2024-08-15',
          time: '12:30:15',
          paymentMethod: 'upi',
          referenceId: 'UPI123456789',
          bank: 'HDFC Bank',
          category: 'food',
          confidence: 0.95,
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_upi_debit_1',
        from: 'alerts@hdfcbank.com',
        senderDomain: 'hdfcbank.com',
        subject: 'Debit Alert: Rs 2,500 on HDFC Bank',
        textBody: 'Rs.2,500 debited from A/C XX1234 on 15-Aug-2024 for Zomato. Ref: UPI123456789',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.needsReview).toBe(false);
      expect(result.transaction).not.toBeNull();

      const txn = result.transaction!;
      expect(txn.amount).toBe(250000); // 2500 INR in paise
      expect(txn.currency).toBe('INR');
      expect(txn.type).toBe('expense');
      expect(txn.merchant).toBe('Zomato');
      expect(txn.category).toBe('food');
      expect(txn.paymentMethod).toBe('upi');
      expect(txn.reference).toBe('UPI123456789');
      expect(txn.source).toBe('gmail');
      expect(txn.tags).toContain('gemini-extracted');
      expect(txn.tags).toContain('upi');
      expect(txn.metadata.bankName).toBe('HDFC Bank');
      expect(txn.metadata.gmailMessageId).toBe('msg_upi_debit_1');
      expect(txn.metadata.extractionMethod).toBe('gemini');
      expect(txn.confidence).toBe(0.95);
    });

    test('successfully extracts a valid income/credit transaction', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'income',
          amount: 50000,
          currency: 'INR',
          merchant: 'Acme Corp',
          date: '2024-08-01',
          paymentMethod: 'bank',
          referenceId: 'SAL20240801',
          bank: 'ICICI Bank',
          category: 'salary',
          confidence: 0.9,
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_income_1',
        subject: 'Salary Credited',
        textBody: 'Rs.50,000 credited to your account from Acme Corp',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.transaction).not.toBeNull();
      expect(result.transaction!.type).toBe('income');
      expect(result.transaction!.amount).toBe(5000000); // 50000 in paise
      expect(result.transaction!.category).toBe('salary');
      expect(result.transaction!.paymentMethod).toBe('bank');
    });

    test('correctly maps refund transactions to income type with refund tag', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'refund',
          amount: 499,
          currency: 'INR',
          merchant: 'Swiggy',
          date: '2024-08-16',
          paymentMethod: 'upi',
          confidence: 0.92,
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_refund_1',
        subject: 'Refund processed: Swiggy order',
        textBody: 'Refund of Rs.499 credited back to your account',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.transaction).not.toBeNull();
      expect(result.transaction!.type).toBe('income'); // Mapped to income
      expect(result.transaction!.tags).toContain('refund');
      expect(result.transaction!.tags).toContain('gemini-extracted');
      expect(result.transaction!.description).toContain('Refund from Swiggy');
    });

    test('correctly maps reversal transactions to income type with reversal tag', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'reversal',
          amount: 1500,
          currency: 'INR',
          merchant: 'Amazon',
          date: '2024-08-16',
          confidence: 0.88,
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_reversal_1',
        subject: 'Transaction Reversal',
        textBody: 'Transaction reversal of Rs.1500 completed for Amazon',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.transaction).not.toBeNull();
      expect(result.transaction!.type).toBe('income');
      expect(result.transaction!.tags).toContain('reversal');
      expect(result.transaction!.description).toContain('Reversal from Amazon');
    });

    test('skips failed transactions', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'failed',
          amount: 500,
          currency: 'INR',
          merchant: 'Flipkart',
          reason: 'Insufficient funds',
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_failed_1',
        subject: 'Transaction Failed',
        textBody: 'Your transaction of Rs.500 to Flipkart has failed',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.transaction).toBeNull();
      expect(result.skipReason).toContain('failed');
    });

    test('skips promotional emails where isTransaction is false', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: false,
          reason: 'Promotional offer for personal loans',
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_promo_1',
        subject: 'Special Loan Offer Just For You!',
        textBody: 'Get pre-approved personal loans up to Rs. 10 Lakhs at 10.5% interest rate.',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.transaction).toBeNull();
      expect(result.skipReason).toBe('Promotional offer for personal loans');
    });

    test('skips OTP and security verification emails', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: false,
          reason: 'OTP verification message',
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_otp_1',
        subject: 'Your One Time Password (OTP)',
        textBody: '123456 is your OTP for transaction of Rs. 500 at Merchant. Do not share with anyone.',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.transaction).toBeNull();
    });

    test('flags low-confidence transactions for review (< 0.5)', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'expense',
          amount: 250,
          currency: 'INR',
          merchant: 'Unknown POS',
          date: '2024-08-17',
          confidence: 0.35, // Low confidence
        }),
      });

      const email = makeParsedEmail({
        messageId: 'msg_ambiguous_1',
        subject: 'Card activity',
        textBody: 'Unusual card charge of Rs. 250 detected',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.needsReview).toBe(true);
      expect(result.transaction).not.toBeNull();
      expect(result.transaction!.confidence).toBe(0.35);
    });

    test('handles markdown code fences in Gemini response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '```json\n{\n  "isTransaction": true,\n  "transactionType": "expense",\n  "amount": 750,\n  "currency": "INR",\n  "merchant": "Uber",\n  "date": "2024-08-17",\n  "confidence": 0.9\n}\n```',
      });

      const email = makeParsedEmail({
        messageId: 'msg_markdown_1',
        subject: 'Your Uber Ride',
        textBody: 'Total Rs. 750 charged to your card for ride with Uber',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(true);
      expect(result.transaction).not.toBeNull();
      expect(result.transaction!.merchant).toBe('Uber');
      expect(result.transaction!.amount).toBe(75000);
    });

    test('handles malformed JSON response from Gemini gracefully', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Sorry, I cannot process this: { incomplete json',
      });

      const email = makeParsedEmail({
        messageId: 'msg_malformed_1',
        subject: 'Complex email',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(false);
      expect(result.transaction).toBeNull();
      expect(result.error).toContain('malformed');
    });

    test('handles Gemini API error gracefully without throwing', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Rate limit exceeded / 429'));

      const email = makeParsedEmail({
        messageId: 'msg_error_1',
        subject: 'Bank alert',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(false);
      expect(result.transaction).toBeNull();
      expect(result.error).toContain('Rate limit exceeded');
    });

    test('returns GEMINI_UNAVAILABLE when API key is missing', async () => {
      process.env.GEMINI_API_KEY = '';

      const email = makeParsedEmail({
        messageId: 'msg_no_key_1',
      });

      const result = await extractTransactionWithGemini(email);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.error).toBe('GEMINI_UNAVAILABLE');
    });
  });

  describe('extractBatchWithGemini', () => {
    test('processes a mixed batch with valid, skipped, and review items', async () => {
      // 1st email: Valid expense
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'expense',
          amount: 1200,
          currency: 'INR',
          merchant: 'BookMyShow',
          date: '2024-08-17',
          confidence: 0.95,
        }),
      });

      // 2nd email: Promotional (skipped)
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: false,
          reason: 'Promotional credit card offer',
        }),
      });

      // 3rd email: Low confidence (needs review)
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'expense',
          amount: 300,
          currency: 'INR',
          merchant: 'Corner Store',
          date: '2024-08-17',
          confidence: 0.4,
        }),
      });

      const emails = [
        makeParsedEmail({ messageId: 'batch_1', subject: 'Tickets booked' }),
        makeParsedEmail({ messageId: 'batch_2', subject: 'Card Offer' }),
        makeParsedEmail({ messageId: 'batch_3', subject: 'POS Purchase' }),
      ];

      const batchResult = await extractBatchWithGemini(emails);

      expect(batchResult.geminiUsed).toBe(true);
      expect(batchResult.totalProcessed).toBe(3);
      expect(batchResult.processed.length).toBe(1);
      expect(batchResult.skipped).toBe(1);
      expect(batchResult.needsReview.length).toBe(1);
      expect(batchResult.errors.length).toBe(0);
      expect(batchResult.processed[0].merchant).toBe('BookMyShow');
    });

    test('isolates errors so one failing email does not stop other emails', async () => {
      // 1st email: Error
      mockGenerateContent.mockRejectedValueOnce(new Error('Network timeout'));

      // 2nd email: Valid
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isTransaction: true,
          transactionType: 'expense',
          amount: 850,
          currency: 'INR',
          merchant: 'Pharmacy',
          date: '2024-08-17',
          confidence: 0.9,
        }),
      });

      const emails = [
        makeParsedEmail({ messageId: 'batch_err_1', subject: 'Timeout email' }),
        makeParsedEmail({ messageId: 'batch_ok_2', subject: 'Medicine receipt' }),
      ];

      const batchResult = await extractBatchWithGemini(emails);

      expect(batchResult.geminiUsed).toBe(true);
      expect(batchResult.totalProcessed).toBe(2);
      expect(batchResult.processed.length).toBe(1);
      expect(batchResult.errors.length).toBe(1);
      expect(batchResult.errors[0].gmailMessageId).toBe('batch_err_1');
      expect(batchResult.processed[0].merchant).toBe('Pharmacy');
    });

    test('returns geminiUsed: false when Gemini is unavailable so caller can fall back', async () => {
      process.env.GEMINI_API_KEY = '';

      const emails = [
        makeParsedEmail({ messageId: 'batch_fallback_1' }),
      ];

      const batchResult = await extractBatchWithGemini(emails);

      expect(batchResult.geminiUsed).toBe(false);
      expect(batchResult.processed.length).toBe(0);
    });
  });
});
