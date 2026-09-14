/**
 * Tests: Transaction Normalizer & Validator
 */

import {
  normalizeTransaction,
  validateTransaction,
  normalizeAndValidate,
  validateBatch,
  buildManualTransaction,
} from '../../src/services/normalizer.service';
import { makeTransaction } from '../helpers/fixtures';
import type { CanonicalTransaction } from '../../src/types/transaction.types';

describe('normalizeTransaction', () => {
  test('trims whitespace from string fields', () => {
    const raw = makeTransaction({ description: '  Payment to Zomato  ', merchant: '  Zomato  ' });
    const normalized = normalizeTransaction(raw);
    expect(normalized.description).toBe('Payment to Zomato');
    expect(normalized.merchant).toBe('Zomato');
  });

  test('uppercases currency', () => {
    const raw = makeTransaction({ currency: 'inr' } as unknown as CanonicalTransaction);
    const normalized = normalizeTransaction(raw);
    expect(normalized.currency).toBe('INR');
  });

  test('defaults missing currency to INR', () => {
    const raw = makeTransaction();
    delete (raw as unknown as Record<string, unknown>)['currency'];
    const normalized = normalizeTransaction(raw);
    expect(normalized.currency).toBe('INR');
  });

  test('converts negative amount to absolute value', () => {
    const raw = makeTransaction({ amount: -50000 });
    const normalized = normalizeTransaction(raw);
    expect(normalized.amount).toBe(50000);
  });

  test('rounds fractional paise', () => {
    const raw = makeTransaction({ amount: 99999.7 });
    const normalized = normalizeTransaction(raw);
    expect(normalized.amount).toBe(100000);
  });

  test('clamps confidence to [0, 1]', () => {
    const tooHigh = normalizeTransaction(makeTransaction({ confidence: 1.5 }));
    expect(tooHigh.confidence).toBe(1);

    const tooLow = normalizeTransaction(makeTransaction({ confidence: -0.2 }));
    expect(tooLow.confidence).toBe(0);
  });

  test('enforces transfer type for ATM transactions', () => {
    const raw = makeTransaction({
      paymentMethod: 'atm',
      type: 'expense', // incorrectly marked
      category: 'atm_withdrawal',
    });
    const normalized = normalizeTransaction(raw);
    expect(normalized.type).toBe('transfer'); // must be corrected
  });

  test('deduplicates and lowercases tags', () => {
    const raw = makeTransaction({ tags: ['UPI', 'upi', 'Food', 'food'] });
    const normalized = normalizeTransaction(raw);
    expect(normalized.tags).toEqual(['upi', 'food']);
  });

  test('removes email body fields from metadata', () => {
    const raw = makeTransaction({
      metadata: {
        gmailMessageId: 'msg_abc',
        body: 'SENSITIVE EMAIL BODY',
        textBody: 'sensitive',
        htmlBody: '<b>sensitive</b>',
      },
    });
    const normalized = normalizeTransaction(raw);
    expect(normalized.metadata).not.toHaveProperty('body');
    expect(normalized.metadata).not.toHaveProperty('textBody');
    expect(normalized.metadata).not.toHaveProperty('htmlBody');
    expect((normalized.metadata as Record<string, unknown>)['gmailMessageId']).toBe('msg_abc');
  });
});

describe('validateTransaction', () => {
  test('validates a well-formed transaction', () => {
    const txn = makeTransaction();
    const result = validateTransaction(txn);
    expect(result.valid).toBe(true);
  });

  test('rejects transaction with missing required fields', () => {
    const invalid = { id: 'not-a-uuid', amount: -1 };
    const result = validateTransaction(invalid as Partial<CanonicalTransaction>);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test('rejects zero amount', () => {
    const txn = makeTransaction({ amount: 0 });
    const result = validateTransaction(txn);
    expect(result.valid).toBe(false);
  });

  test('rejects invalid UUID', () => {
    const txn = makeTransaction({ id: 'not-a-uuid' });
    const result = validateTransaction(txn);
    expect(result.valid).toBe(false);
  });

  test('rejects invalid type', () => {
    const txn = makeTransaction({ type: 'payment' as unknown as 'expense' });
    const result = validateTransaction(txn);
    expect(result.valid).toBe(false);
  });

  test('rejects invalid paymentMethod', () => {
    const txn = makeTransaction({ paymentMethod: 'crypto' as unknown as 'card' });
    const result = validateTransaction(txn);
    expect(result.valid).toBe(false);
  });
});

describe('normalizeAndValidate', () => {
  test('normalises then validates successfully', () => {
    const raw = makeTransaction({ description: '  Test Payment  ', currency: 'inr' } as unknown as CanonicalTransaction);
    const result = normalizeAndValidate(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.transaction.description).toBe('Test Payment');
      expect(result.transaction.currency).toBe('INR');
    }
  });

  test('returns validation errors for invalid data', () => {
    const result = normalizeAndValidate({ amount: 0, type: 'expense' });
    expect(result.valid).toBe(false);
  });
});

describe('validateBatch', () => {
  test('separates valid from invalid transactions', () => {
    const transactions = [
      makeTransaction(),                         // valid
      { amount: 0, type: 'expense' },            // invalid — no ID, zero amount
      makeTransaction({ amount: 500000 }),       // valid
    ];

    const { valid, invalidCount } = validateBatch(transactions as Partial<CanonicalTransaction>[]);

    expect(valid.length).toBe(2);
    expect(invalidCount).toBe(1);
  });

  test('returns empty array for all-invalid batch', () => {
    const { valid, invalidCount } = validateBatch([{}, {}, {}]);
    expect(valid.length).toBe(0);
    expect(invalidCount).toBe(3);
  });
});

describe('buildManualTransaction', () => {
  test('builds a valid manual transaction', () => {
    const input = {
      date: '2024-08-17T10:00:00.000Z',
      amount: 30000, // ₹300
      type: 'expense' as const,
      category: 'food' as const,
      paymentMethod: 'cash' as const,
      description: 'Lunch at canteen',
      merchant: 'Office Canteen',
    };

    const raw = buildManualTransaction(input, 'user_google_123');
    const result = normalizeAndValidate(raw);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.transaction.source).toBe('manual');
      expect(result.transaction.confidence).toBe(1.0);
      expect(result.transaction.parseStatus).toBe('success');
      expect(result.transaction.paymentMethod).toBe('cash');
      expect(result.transaction.type).toBe('expense');
    }
  });

  test('ATM cash manual entry gets transfer type', () => {
    const input = {
      date: '2024-08-17T10:00:00.000Z',
      amount: 500000, // ₹5,000
      type: 'transfer' as const,
      category: 'atm_withdrawal' as const,
      paymentMethod: 'atm' as const,
      description: 'ATM Cash Withdrawal',
    };

    const raw = buildManualTransaction(input, 'user_123');
    const result = normalizeAndValidate(raw);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.transaction.type).toBe('transfer');
      expect(result.transaction.paymentMethod).toBe('atm');
    }
  });
});
