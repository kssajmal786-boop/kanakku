/**
 * Test helpers and shared fixtures
 */

import type { CanonicalTransaction } from '../../src/types/transaction.types';
import type { ParsedEmail } from '../../src/types/gmail.types';

// ── Sample email bodies ─────────────────────────────────────────────────────

export const SAMPLE_EMAILS = {
  upiDebit: `
Dear Customer,
Rs.2,500.00 debited from your A/C XX1234 on 15-Aug-2024 12:30:15 IST.
Info: UPI/123456789/Payment to ZOMATO/zomato@okicici
Avl Bal: Rs.18,500.75
If not done by you, call 1800-xxx-xxxx
  `.trim(),

  upiCredit: `
Dear Customer,
Rs.5,000.00 credited to your A/C XX5678 on 17-Aug-2024 09:15:00 IST.
Info: UPI/987654321/Received from RAHUL SHARMA/rahul@okhdfc
Avl Bal: Rs.23,500.75
  `.trim(),

  atmWithdrawal: `
Dear Customer,
Rs.10,000.00 has been debited from your SBI A/C XXXXXXXXX1234 on 16-Aug-2024 14:22:00
at ATM: HDFC ATM CHENNAI T NAGAR
Your ATM card ending 9876 was used.
Available Balance: Rs.8,500.00
  `.trim(),

  cardTransaction: `
Alert: Your HDFC Bank Debit Card XX9876 has been used for a transaction of Rs.1,299.00
at AMAZON INDIA on 17/08/2024 10:45:12 IST.
Ref No: 412345678901
Available balance: Rs.22,201.00
  `.trim(),

  neftCredit: `
Dear Customer,
NEFT Credit of Rs.50,000.00 in your account No. XXXXXXXX5678 on 17-Aug-2024.
Sender: ABC TECHNOLOGIES PVT LTD
UTR No: HDFC24229xxxxxxxxx
Available Balance: INR 73,500.00
  `.trim(),

  neftDebit: `
Dear Customer,
NEFT Debit of Rs.15,000.00 from your account XX1234 on 17-Aug-2024 11:30:00.
Transferred to: PRIYA KRISHNAN
IFSC: SBIN0001234
UTR: SBIN2024081723456789
Available balance: Rs.58,500.00
  `.trim(),

  bankCredit: `
Your account XXXX5678 has been credited with Rs.1,00,000.00 on 01-Aug-2024.
Transaction details: SALARY AUGUST 2024
Reference: SAL20240801
Available balance: Rs.1,05,500.00
  `.trim(),

  unknown: `
Thank you for shopping with us!
Your order #ORD123456 has been confirmed.
Expected delivery: 20-Aug-2024
  `.trim(),
};

// ── ParsedEmail factory ──────────────────────────────────────────────────────

export function makeParsedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: 'msg_' + Math.random().toString(36).slice(2),
    threadId: 'thread_abc123',
    subject: 'Transaction Alert',
    from: 'alerts@hdfcbank.com',
    senderEmail: 'alerts@hdfcbank.com',
    senderDomain: 'hdfcbank.com',
    date: new Date().toISOString(),
    textBody: '',
    htmlBody: '',
    htmlAsText: '',
    combinedBody: '',
    ...overrides,
  };
}

// ── CanonicalTransaction factory ────────────────────────────────────────────

let _txnCounter = 0;

export function makeTransaction(overrides: Partial<CanonicalTransaction> = {}): CanonicalTransaction {
  _txnCounter++;
  return {
    id: `00000000-0000-4000-8000-${String(_txnCounter).padStart(12, '0')}`,
    date: '2024-08-17T10:00:00.000Z',
    amount: 250000, // ₹2,500.00
    currency: 'INR',
    type: 'expense',
    category: 'food',
    paymentMethod: 'upi',
    source: 'gmail',
    description: 'Payment to Zomato',
    merchant: 'Zomato',
    reference: 'UPI123456789',
    createdAt: new Date().toISOString(),
    linkedTxnId: null,
    confidence: 0.9,
    parseStatus: 'success',
    rawAmount: '₹2,500.00',
    tags: ['upi'],
    metadata: {
      gmailMessageId: 'msg_abc123',
      senderEmail: 'alerts@hdfcbank.com',
      bankName: 'HDFC Bank',
      upiVpa: 'zomato@okicici',
    },
    ...overrides,
  };
}
