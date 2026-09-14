/**
 * Tests: Core Email Parser (end-to-end parsing pipeline)
 */

import { parseEmail, parseEmailBatch } from '../../src/parsers/email.parser';
import { makeParsedEmail, SAMPLE_EMAILS } from '../helpers/fixtures';

describe('parseEmail', () => {
  // ── UPI debit ─────────────────────────────────────────────────────────────

  test('parses UPI debit email correctly', () => {
    const email = makeParsedEmail({
      subject: 'UPI Payment Alert - Rs.2,500.00 debited',
      senderEmail: 'alerts@hdfcbank.com',
      senderDomain: 'hdfcbank.com',
      combinedBody: SAMPLE_EMAILS.upiDebit,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(true);
    expect(result.transaction).not.toBeNull();
    const txn = result.transaction!;

    expect(txn.amount).toBe(250000);         // ₹2,500.00 in paise
    expect(txn.type).toBe('expense');
    expect(txn.paymentMethod).toBe('upi');
    expect(txn.source).toBe('gmail');
    expect(txn.currency).toBe('INR');
    expect(txn.id).toBeDefined();
    expect(txn.createdAt).toBeDefined();
    expect(txn.metadata.gmailMessageId).toBe(email.messageId);
  });

  // ── UPI credit ────────────────────────────────────────────────────────────

  test('parses UPI credit email correctly', () => {
    const email = makeParsedEmail({
      subject: 'UPI Credit Alert - Rs.5,000.00 credited',
      senderDomain: 'hdfcbank.com',
      combinedBody: SAMPLE_EMAILS.upiCredit,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(true);
    expect(result.transaction!.amount).toBe(500000);
    expect(result.transaction!.type).toBe('income');
    expect(result.transaction!.paymentMethod).toBe('upi');
  });

  // ── ATM withdrawal ────────────────────────────────────────────────────────

  test('parses ATM withdrawal as TRANSFER (not expense)', () => {
    const email = makeParsedEmail({
      subject: 'ATM Withdrawal Alert',
      senderDomain: 'sbi.co.in',
      combinedBody: SAMPLE_EMAILS.atmWithdrawal,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(true);
    const txn = result.transaction!;

    // CRITICAL: ATM must be 'transfer', NOT 'expense'
    expect(txn.type).toBe('transfer');
    expect(txn.paymentMethod).toBe('atm');
    expect(txn.category).toBe('atm_withdrawal');
    expect(txn.amount).toBe(1000000); // ₹10,000
  });

  // ── Card transaction ──────────────────────────────────────────────────────

  test('parses card debit transaction', () => {
    const email = makeParsedEmail({
      subject: 'HDFC Debit Card Transaction Alert',
      senderDomain: 'hdfcbank.com',
      combinedBody: SAMPLE_EMAILS.cardTransaction,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(true);
    const txn = result.transaction!;

    expect(txn.amount).toBe(129900);     // ₹1,299.00
    expect(txn.type).toBe('expense');
    expect(txn.paymentMethod).toBe('card');
    expect(txn.merchant).toBeTruthy();   // Should extract AMAZON INDIA
  });

  // ── NEFT credit ───────────────────────────────────────────────────────────

  test('parses NEFT credit (salary)', () => {
    const email = makeParsedEmail({
      subject: 'NEFT Credit Alert',
      senderDomain: 'hdfcbank.com',
      combinedBody: SAMPLE_EMAILS.neftCredit,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(true);
    const txn = result.transaction!;

    expect(txn.amount).toBe(5000000);   // ₹50,000
    expect(txn.type).toBe('income');
    expect(txn.paymentMethod).toBe('bank');
    expect(txn.reference).toBeTruthy(); // Should extract UTR
  });

  // ── NEFT debit ────────────────────────────────────────────────────────────

  test('parses NEFT debit (bank transfer)', () => {
    const email = makeParsedEmail({
      subject: 'NEFT Transfer Successful',
      senderDomain: 'sbi.co.in',
      combinedBody: SAMPLE_EMAILS.neftDebit,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(true);
    expect(result.transaction!.type).toBe('expense');
    expect(result.transaction!.paymentMethod).toBe('bank');
    expect(result.transaction!.amount).toBe(1500000); // ₹15,000
  });

  // ── Bank credit (salary) ──────────────────────────────────────────────────

  test('parses bank credit with lakh amount', () => {
    const email = makeParsedEmail({
      subject: 'Account Credited Alert',
      senderDomain: 'hdfcbank.com',
      combinedBody: SAMPLE_EMAILS.bankCredit,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(true);
    expect(result.transaction!.amount).toBe(10000000); // ₹1,00,000
    expect(result.transaction!.type).toBe('income');
  });

  // ── Unknown / non-financial email ─────────────────────────────────────────

  test('returns failure for non-financial email', () => {
    const email = makeParsedEmail({
      subject: 'Your order has been confirmed',
      senderDomain: 'amazon.in',
      combinedBody: SAMPLE_EMAILS.unknown,
    });

    const result = parseEmail(email);

    expect(result.success).toBe(false);
    expect(result.transaction).toBeNull();
    expect(result.error).toBeDefined();
  });

  // ── Stable ID ─────────────────────────────────────────────────────────────

  test('generates same ID for same email content (idempotent)', () => {
    const email = makeParsedEmail({
      subject: 'UPI Payment Alert',
      senderDomain: 'hdfcbank.com',
      combinedBody: SAMPLE_EMAILS.upiDebit,
    });

    const result1 = parseEmail(email);
    const result2 = parseEmail(email);

    expect(result1.transaction!.id).toBe(result2.transaction!.id);
  });

  // ── Confidence ────────────────────────────────────────────────────────────

  test('returns confidence between 0 and 1', () => {
    const email = makeParsedEmail({
      subject: 'UPI Debit Alert',
      senderDomain: 'hdfcbank.com',
      combinedBody: SAMPLE_EMAILS.upiDebit,
    });

    const result = parseEmail(email);
    expect(result.transaction!.confidence).toBeGreaterThan(0);
    expect(result.transaction!.confidence).toBeLessThanOrEqual(1);
  });
});

// ── Batch parser ─────────────────────────────────────────────────────────────

describe('parseEmailBatch', () => {
  test('isolates failures — one bad email does not crash batch', () => {
    const emails = [
      makeParsedEmail({
        subject: 'UPI Debit Alert',
        senderDomain: 'hdfcbank.com',
        combinedBody: SAMPLE_EMAILS.upiDebit,
      }),
      makeParsedEmail({
        subject: 'Order Confirmed',
        senderDomain: 'amazon.in',
        combinedBody: SAMPLE_EMAILS.unknown,
      }),
      makeParsedEmail({
        subject: 'ATM Withdrawal',
        senderDomain: 'sbi.co.in',
        combinedBody: SAMPLE_EMAILS.atmWithdrawal,
      }),
    ];

    const { parsed, failures } = parseEmailBatch(emails);

    expect(parsed.length).toBe(2);    // UPI + ATM
    expect(failures.length).toBe(1);  // Order confirmation
  });

  test('handles large batch without throwing', () => {
    const emails = Array.from({ length: 100 }, (_, i) =>
      makeParsedEmail({
        subject: i % 2 === 0 ? 'UPI Debit Alert' : 'Order Confirmed',
        senderDomain: i % 2 === 0 ? 'hdfcbank.com' : 'amazon.in',
        combinedBody: i % 2 === 0 ? SAMPLE_EMAILS.upiDebit : SAMPLE_EMAILS.unknown,
      })
    );

    expect(() => parseEmailBatch(emails)).not.toThrow();

    const { parsed, failures } = parseEmailBatch(emails);
    expect(parsed.length + failures.length).toBe(100);
  });

  test('failure records contain safe metadata (no financial data)', () => {
    const email = makeParsedEmail({
      subject: 'Order Shipped',
      senderDomain: 'flipkart.com',
      combinedBody: 'Your order has shipped',
    });

    const { failures } = parseEmailBatch([email]);

    if (failures.length > 0) {
      const failure = failures[0];
      expect(failure).not.toHaveProperty('amount');
      expect(failure).not.toHaveProperty('body');
      expect(failure.senderDomain).toBeDefined();
      expect(failure.subject).toBeDefined();
    }
  });
});
