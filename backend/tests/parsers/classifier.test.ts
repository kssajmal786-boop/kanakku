/**
 * Tests: Email Classifier
 */

import { classifyEmail } from '../../src/parsers/classifier';

const BASE = {
  senderEmail: 'alerts@hdfcbank.com',
  senderDomain: 'hdfcbank.com',
  body: '',
};

describe('classifyEmail', () => {
  // ── UPI ─────────────────────────────────────────────────────────────────

  test('classifies UPI debit', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'UPI Payment Alert',
      body: 'Rs.500 debited via UPI to merchant@okicici',
    });
    expect(result.emailClass).toBe('upi_debit');
    expect(result.type).toBe('expense');
    expect(result.paymentMethod).toBe('upi');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('classifies UPI credit', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'UPI Credit Alert',
      body: 'Rs.1000 credited via UPI from friend@okhdfc',
    });
    expect(result.emailClass).toBe('upi_credit');
    expect(result.type).toBe('income');
  });

  // ── ATM ─────────────────────────────────────────────────────────────────

  test('classifies ATM withdrawal as transfer (not expense)', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'ATM Withdrawal Alert',
      body: 'Rs.5000 cash withdrawal at ATM on 17-Aug-2024',
    });
    expect(result.emailClass).toBe('atm_withdrawal');
    expect(result.type).toBe('transfer');   // CRITICAL — not expense
    expect(result.paymentMethod).toBe('atm');
  });

  // ── Card ─────────────────────────────────────────────────────────────────

  test('classifies card transaction', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'Debit Card Transaction Alert',
      body: 'Your card XX1234 has been used for Rs.1299 at AMAZON on 17/08/2024',
    });
    expect(result.emailClass).toBe('card_debit');
    expect(result.type).toBe('expense');
    expect(result.paymentMethod).toBe('card');
  });

  // ── NEFT ─────────────────────────────────────────────────────────────────

  test('classifies NEFT credit', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'NEFT Credit Received',
      body: 'NEFT credit of Rs.50000 received from ABC Corp',
    });
    expect(result.emailClass).toBe('neft_credit');
    expect(result.type).toBe('income');
    expect(result.paymentMethod).toBe('bank');
  });

  test('classifies NEFT debit', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'NEFT Transfer Successful',
      body: 'NEFT debit of Rs.15000 from your account transferred to PRIYA',
    });
    expect(result.emailClass).toBe('neft_debit');
    expect(result.type).toBe('expense');
  });

  // ── Bank credit / debit ───────────────────────────────────────────────────

  test('classifies generic bank credit', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'Account Credited',
      body: 'Your account has been credited with Rs.1,00,000. Salary August 2024',
    });
    expect(result.type).toBe('income');
  });

  test('classifies generic bank debit', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'Account Debited',
      body: 'Your account XX1234 has been debited with Rs.500 for EMI payment',
    });
    expect(result.type).toBe('expense');
  });

  // ── Unknown ───────────────────────────────────────────────────────────────

  test('classifies shopping confirmation as unknown', () => {
    const result = classifyEmail({
      ...BASE,
      subject: 'Your order has been confirmed',
      body: 'Thank you for your order. Expected delivery in 3-5 days.',
    });
    expect(result.emailClass).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  // ── Confidence boost for known bank ──────────────────────────────────────

  test('gives higher confidence for known bank sender', () => {
    const knownBank = classifyEmail({
      subject: 'UPI Payment Alert',
      senderEmail: 'alerts@hdfcbank.com',
      senderDomain: 'hdfcbank.com',
      body: 'UPI debit of Rs.500',
    });
    const unknownSender = classifyEmail({
      subject: 'UPI Payment Alert',
      senderEmail: 'noreply@randombank.xyz',
      senderDomain: 'randombank.xyz',
      body: 'UPI debit of Rs.500',
    });
    expect(knownBank.confidence).toBeGreaterThan(unknownSender.confidence);
  });
});
