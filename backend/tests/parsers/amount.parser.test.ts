/**
 * Tests: Amount Parser
 */

import { extractAmount, extractAllAmounts, paiseToRupees } from '../../src/parsers/amount.parser';

describe('extractAmount', () => {
  test('parses ₹ symbol with comma-formatted amount', () => {
    const result = extractAmount('₹1,234.56 debited from your account');
    expect(result).not.toBeNull();
    expect(result!.amountPaise).toBe(123456);
    expect(result!.rawAmount).toContain('1,234.56');
  });

  test('parses Rs. prefix', () => {
    const result = extractAmount('Rs.5000 has been debited');
    expect(result).not.toBeNull();
    expect(result!.amountPaise).toBe(500000);
  });

  test('parses INR prefix', () => {
    const result = extractAmount('INR 750.00 transferred');
    expect(result).not.toBeNull();
    expect(result!.amountPaise).toBe(75000);
  });

  test('parses Indian lakh format (1,00,000)', () => {
    const result = extractAmount('₹1,00,000 credited to your account');
    expect(result).not.toBeNull();
    expect(result!.amountPaise).toBe(10000000);
  });

  test('returns null for text with no amount', () => {
    const result = extractAmount('Your account has been updated');
    expect(result).toBeNull();
  });

  test('rejects zero amounts', () => {
    const result = extractAmount('₹0.00 credited');
    expect(result).toBeNull();
  });

  test('handles amount with no decimal', () => {
    const result = extractAmount('₹500 paid');
    expect(result!.amountPaise).toBe(50000);
  });
});

describe('extractAllAmounts', () => {
  test('extracts multiple amounts', () => {
    const text = 'Debited ₹2,500.00. Available Balance: ₹18,500.75';
    const results = extractAllAmounts(text);
    expect(results.length).toBe(2);
    expect(results[0].amountPaise).toBe(250000);
    expect(results[1].amountPaise).toBe(1850075);
  });
});

describe('paiseToRupees', () => {
  test('converts paise to rupees string', () => {
    expect(paiseToRupees(250000)).toBe('2500.00');
    expect(paiseToRupees(1)).toBe('0.01');
    expect(paiseToRupees(10000000)).toBe('100000.00');
  });
});
