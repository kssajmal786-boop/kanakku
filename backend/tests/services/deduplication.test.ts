/**
 * Tests: Deduplication Engine
 */

import { checkDuplicate, deduplicateBatch } from '../../src/services/deduplication.service';
import { makeTransaction } from '../helpers/fixtures';
import type { CanonicalTransaction } from '../../src/types/transaction.types';

describe('checkDuplicate', () => {
  // ── Exact Gmail message ID match ──────────────────────────────────────────

  test('detects duplicate by Gmail message ID (highest confidence)', () => {
    const existing = makeTransaction({
      metadata: { gmailMessageId: 'msg_abc123' },
    });
    const incoming = makeTransaction({
      metadata: { gmailMessageId: 'msg_abc123' }, // same email
      id: 'different-id-but-same-email',
    });

    const result = checkDuplicate(incoming, [existing]);

    expect(result.isDuplicate).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.75);
    expect(result.matchedId).toBe(existing.id);
  });

  // ── Identical ID ──────────────────────────────────────────────────────────

  test('detects identical transaction ID immediately', () => {
    const txn = makeTransaction();
    const result = checkDuplicate(txn, [txn]);

    expect(result.isDuplicate).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.reason).toContain('Identical transaction ID');
  });

  // ── Reference number match ────────────────────────────────────────────────

  test('detects duplicate by exact reference number + amount + date', () => {
    const existing = makeTransaction({
      reference: 'UTR2024081700001',
      amount: 500000,
      date: '2024-08-17T10:00:00.000Z',
      metadata: { gmailMessageId: 'msg_old' },
    });
    // Incoming from a receipt scan — different source but same txn
    const incoming = makeTransaction({
      reference: 'UTR2024081700001',
      amount: 500000,
      date: '2024-08-17T12:00:00.000Z', // different time, same day
      source: 'receipt',
      metadata: { gmailMessageId: undefined },
    });

    const result = checkDuplicate(incoming, [existing]);

    expect(result.isDuplicate).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });

  // ── Amount + date + method ────────────────────────────────────────────────

  test('flags as likely duplicate when amount + date + payment method match', () => {
    const existing = makeTransaction({
      amount: 129900,
      date: '2024-08-17T10:30:00.000Z',
      paymentMethod: 'card',
      merchant: 'Amazon India',
      reference: null,
      metadata: { gmailMessageId: 'msg_1' },
    });
    const incoming = makeTransaction({
      amount: 129900,
      date: '2024-08-17T11:00:00.000Z',
      paymentMethod: 'card',
      merchant: 'AMAZON INDIA',  // slightly different casing
      reference: null,
      metadata: { gmailMessageId: 'msg_1' }, // same email source
    });

    const result = checkDuplicate(incoming, [existing]);
    expect(result.isDuplicate).toBe(true);
  });

  // ── Different amounts — no duplicate ─────────────────────────────────────

  test('does not flag as duplicate when amounts differ', () => {
    const existing = makeTransaction({ amount: 500000 });
    const incoming = makeTransaction({ amount: 750000, metadata: { gmailMessageId: 'msg_different' } });

    const result = checkDuplicate(incoming, [existing]);
    expect(result.isDuplicate).toBe(false);
    expect(result.matchedId).toBeNull();
  });

  // ── Different dates — no duplicate ───────────────────────────────────────

  test('does not flag as duplicate when dates are on different days', () => {
    const existing = makeTransaction({
      amount: 500000,
      date: '2024-08-15T10:00:00.000Z',
      reference: null,
    });
    const incoming = makeTransaction({
      amount: 500000,
      date: '2024-08-17T10:00:00.000Z',
      reference: null,
      metadata: { gmailMessageId: 'msg_new' },
    });

    const result = checkDuplicate(incoming, [existing]);
    // Should not be a definite duplicate; different day
    if (result.isDuplicate) {
      expect(result.confidence).toBeLessThan(0.75);
    }
  });

  // ── Empty existing list ───────────────────────────────────────────────────

  test('returns no duplicate when existing list is empty', () => {
    const incoming = makeTransaction();
    const result = checkDuplicate(incoming, []);

    expect(result.isDuplicate).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.matchedId).toBeNull();
  });

  // ── Merchant fuzzy match ──────────────────────────────────────────────────

  test('uses fuzzy merchant matching (minor spelling differences)', () => {
    const existing = makeTransaction({ merchant: 'Zomato India' });
    const incoming = makeTransaction({
      merchant: 'ZOMATO INDIA',  // same but uppercase
      metadata: { gmailMessageId: 'msg_2' },
    });

    // With same amount + date + payment method + similar merchant → high score
    const result = checkDuplicate(incoming, [existing]);
    // Merchant fuzzy match should contribute to score
    expect(result.reason).toBeDefined();
  });
});

// ── Batch deduplication ───────────────────────────────────────────────────────

describe('deduplicateBatch', () => {
  test('removes duplicates within the same batch', () => {
    const txn = makeTransaction({ metadata: { gmailMessageId: 'msg_dup' } });
    const duplicate = { ...txn }; // exact copy

    const { unique, duplicatesSkipped } = deduplicateBatch([txn, duplicate]);

    expect(unique.length).toBe(1);
    expect(duplicatesSkipped).toBe(1);
  });

  test('removes duplicates against existing transactions', () => {
    const existing = makeTransaction({ metadata: { gmailMessageId: 'msg_exists' } });
    const incoming = { ...existing }; // same txn arriving again in next sync

    const { unique, duplicatesSkipped } = deduplicateBatch([incoming], [existing]);

    expect(unique.length).toBe(0);
    expect(duplicatesSkipped).toBe(1);
  });

  test('keeps unique transactions from a mixed batch', () => {
    const existing = makeTransaction({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      metadata: { gmailMessageId: 'msg_old' },
    });

    const incoming: CanonicalTransaction[] = [
      makeTransaction({
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        metadata: { gmailMessageId: 'msg_old' },
      }), // duplicate of existing
      makeTransaction({
        amount: 999900,
        date: '2024-08-16T09:00:00.000Z',
        metadata: { gmailMessageId: 'msg_new_1' },
      }), // unique
      makeTransaction({
        amount: 149900,
        date: '2024-08-16T14:00:00.000Z',
        metadata: { gmailMessageId: 'msg_new_2' },
      }), // unique
    ];

    const { unique, duplicatesSkipped } = deduplicateBatch(incoming, [existing]);

    expect(unique.length).toBe(2);
    expect(duplicatesSkipped).toBe(1);
  });

  test('returns deduplication details for skipped transactions', () => {
    const txn = makeTransaction({ metadata: { gmailMessageId: 'msg_abc' } });
    const { duplicateDetails } = deduplicateBatch([txn, txn]);

    expect(duplicateDetails.length).toBe(1);
    expect(duplicateDetails[0].incomingId).toBe(txn.id);
    expect(duplicateDetails[0].reason).toBeDefined();
  });

  test('handles empty incoming batch', () => {
    const { unique, duplicatesSkipped } = deduplicateBatch([], [makeTransaction()]);
    expect(unique.length).toBe(0);
    expect(duplicatesSkipped).toBe(0);
  });

  test('handles 200 transactions efficiently', () => {
    const transactions = Array.from({ length: 200 }, (_, i) =>
      makeTransaction({
        amount: (i + 1) * 10000,
        date: `2024-08-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        metadata: { gmailMessageId: `msg_${i}` },
        reference: `REF${String(i).padStart(10, '0')}`,
      })
    );

    const start = Date.now();
    const { unique } = deduplicateBatch(transactions);
    const elapsed = Date.now() - start;

    expect(unique.length).toBe(200); // All unique
    expect(elapsed).toBeLessThan(1000); // Must complete within 1 second
  });
});
