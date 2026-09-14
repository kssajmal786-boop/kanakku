/**
 * Email Classifier
 * ─────────────────────────────────────────────────────────────────────────
 * Determines the type of a financial email using:
 *  1. Subject line analysis
 *  2. Sender domain matching
 *  3. Body keyword analysis
 *
 * Returns a EmailClass that guides which parser strategy to use.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { PaymentMethod, TransactionType } from '../types/transaction.types';

export type EmailClass =
  | 'upi_credit'
  | 'upi_debit'
  | 'bank_credit'
  | 'bank_debit'
  | 'atm_withdrawal'
  | 'card_debit'
  | 'card_credit'
  | 'neft_credit'
  | 'neft_debit'
  | 'rtgs_credit'
  | 'rtgs_debit'
  | 'imps_credit'
  | 'imps_debit'
  | 'bank_transfer'
  | 'unknown';

export interface ClassifiedEmail {
  emailClass: EmailClass;
  paymentMethod: PaymentMethod;
  type: TransactionType;
  confidence: number;
}

// ─── Known bank sender domains ────────────────────────────────────────────────

const BANK_SENDER_DOMAINS = new Set([
  // Public sector banks
  'sbi.co.in', 'onlinesbi.com', 'sbipsg.com',
  'pnb.co.in', 'pnbindia.in',
  'bankofbaroda.com', 'bankofbaroda.in',
  'canarabank.com', 'canarabank.in',
  'unionbankofindia.com', 'unionbankofindia.co.in',
  'bankofindia.co.in',
  'bankofmaharashtra.in',
  'centralbankofindia.co.in',
  'indianbank.in',
  'iob.in',
  'ucoin.in',
  // Private banks
  'hdfcbank.com',
  'icicibank.com',
  'axisbank.com',
  'kotak.com', 'kotakbank.com',
  'indusind.com',
  'yesbank.in',
  'rblbank.com',
  'federalbank.co.in',
  'southindianbank.com',
  'karurbank.com',
  'cityunionbank.com',
  'dcbbank.com',
  'bandhanbank.com',
  // Small finance & payments banks
  'aubank.in',
  'equitasbank.com',
  'ujjivansfb.in',
  'paytmbank.com',
  'airtelpaymentsbank.com',
  'jiopaymentsbank.com',
  // UPI platforms
  'paytm.com',
  'phonepe.com',
  'gpay.com', 'google.com',
  'amazonpay.in',
  'bhimupi.org.in',
  // Card networks (alerts)
  'visa.com',
  'mastercard.com',
  'rupay.co.in',
]);

// ─── Subject-based classification rules ───────────────────────────────────────

interface ClassificationRule {
  patterns: RegExp[];
  emailClass: EmailClass;
  paymentMethod: PaymentMethod;
  type: TransactionType;
  weight: number;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ── ATM (must come before generic debit rules) ────────────────────────────
  {
    patterns: [/atm\s*withdrawal/i, /cash\s*withdrawal/i, /atm\s*cash/i, /atm\s*txn/i],
    emailClass: 'atm_withdrawal',
    paymentMethod: 'atm',
    type: 'transfer',  // Bank → Cash, NOT expense
    weight: 10,
  },
  // ── UPI ───────────────────────────────────────────────────────────────────
  {
    patterns: [/upi.*credit/i, /received.*upi/i, /upi.*received/i, /money received.*upi/i, /upi.*money received/i],
    emailClass: 'upi_credit',
    paymentMethod: 'upi',
    type: 'income',
    weight: 9,
  },
  {
    patterns: [/upi.*debit/i, /upi.*payment/i, /paid.*upi/i, /upi.*paid/i, /upi.*sent/i, /sent.*upi/i],
    emailClass: 'upi_debit',
    paymentMethod: 'upi',
    type: 'expense',
    weight: 9,
  },
  // ── NEFT / RTGS / IMPS ────────────────────────────────────────────────────
  {
    patterns: [/neft.*credit/i, /credit.*neft/i, /neft.*received/i],
    emailClass: 'neft_credit',
    paymentMethod: 'bank',
    type: 'income',
    weight: 8,
  },
  {
    patterns: [/neft.*debit/i, /neft.*transfer/i, /neft.*sent/i],
    emailClass: 'neft_debit',
    paymentMethod: 'bank',
    type: 'expense',
    weight: 8,
  },
  {
    patterns: [/rtgs.*credit/i, /credit.*rtgs/i],
    emailClass: 'rtgs_credit',
    paymentMethod: 'bank',
    type: 'income',
    weight: 8,
  },
  {
    patterns: [/rtgs.*debit/i, /rtgs.*transfer/i],
    emailClass: 'rtgs_debit',
    paymentMethod: 'bank',
    type: 'expense',
    weight: 8,
  },
  {
    patterns: [/imps.*credit/i, /credit.*imps/i, /imps.*received/i],
    emailClass: 'imps_credit',
    paymentMethod: 'bank',
    type: 'income',
    weight: 8,
  },
  {
    patterns: [/imps.*debit/i, /imps.*transfer/i],
    emailClass: 'imps_debit',
    paymentMethod: 'bank',
    type: 'expense',
    weight: 8,
  },
  // ── Card transactions ─────────────────────────────────────────────────────
  {
    patterns: [/card.*used/i, /card.*transaction/i, /card.*debit/i, /pos.*transaction/i, /purchase.*card/i, /online.*purchase/i],
    emailClass: 'card_debit',
    paymentMethod: 'card',
    type: 'expense',
    weight: 7,
  },
  {
    patterns: [/card.*credit/i, /cashback/i, /card.*refund/i],
    emailClass: 'card_credit',
    paymentMethod: 'card',
    type: 'income',
    weight: 7,
  },
  // ── Generic bank credit / debit ───────────────────────────────────────────
  {
    patterns: [/account.*credited/i, /credited.*account/i, /credit.*alert/i, /money.*received/i, /received.*money/i, /amount.*credited/i],
    emailClass: 'bank_credit',
    paymentMethod: 'bank',
    type: 'income',
    weight: 5,
  },
  {
    patterns: [/account.*debited/i, /debited.*account/i, /debit.*alert/i, /amount.*debited/i, /payment.*made/i],
    emailClass: 'bank_debit',
    paymentMethod: 'bank',
    type: 'expense',
    weight: 5,
  },
  // ── Generic bank transfer ─────────────────────────────────────────────────
  {
    patterns: [/fund.*transfer/i, /bank.*transfer/i, /transfer.*initiated/i, /transfer.*successful/i],
    emailClass: 'bank_transfer',
    paymentMethod: 'bank',
    type: 'transfer',
    weight: 4,
  },
];

// ─── Body-based credit/debit detection ────────────────────────────────────────

const CREDIT_KEYWORDS = [
  /\bcredited\b/i, /\breceived\b/i, /\bcredit\b/i,
  /\bdeposit(ed)?\b/i, /\bincoming\b/i, /\brefund\b/i, /\bcashback\b/i,
];

const DEBIT_KEYWORDS = [
  /\bdebited\b/i, /\bpaid\b/i, /\bdebit\b/i,
  /\bwithdrawn\b/i, /\bspent\b/i, /\bpurchase\b/i, /\bcharged\b/i,
];

/**
 * Classify an email into a transaction type.
 */
export function classifyEmail(params: {
  subject: string;
  senderEmail: string;
  senderDomain: string;
  body: string;
}): ClassifiedEmail {
  const { subject, senderDomain, body } = params;
  const combined = `${subject} ${body}`.substring(0, 2000); // Cap for performance

  let bestMatch: ClassificationRule | null = null;
  let bestWeight = -1;

  for (const rule of CLASSIFICATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(subject) || pattern.test(combined)) {
        if (rule.weight > bestWeight) {
          bestMatch = rule;
          bestWeight = rule.weight;
        }
        break;
      }
    }
  }

  if (bestMatch) {
    // Boost confidence if sender is a known bank domain
    const isKnownBank = BANK_SENDER_DOMAINS.has(senderDomain);
    const confidence = isKnownBank
      ? Math.min(0.95, 0.7 + bestMatch.weight * 0.025)
      : Math.min(0.85, 0.5 + bestMatch.weight * 0.025);

    return {
      emailClass: bestMatch.emailClass,
      paymentMethod: bestMatch.paymentMethod,
      type: bestMatch.type,
      confidence,
    };
  }

  // Fallback: use body keyword analysis
  const creditScore = CREDIT_KEYWORDS.filter((k) => k.test(combined)).length;
  const debitScore = DEBIT_KEYWORDS.filter((k) => k.test(combined)).length;

  if (creditScore > debitScore && creditScore > 0) {
    return {
      emailClass: 'bank_credit',
      paymentMethod: 'bank',
      type: 'income',
      confidence: 0.3,
    };
  }

  if (debitScore > creditScore && debitScore > 0) {
    return {
      emailClass: 'bank_debit',
      paymentMethod: 'bank',
      type: 'expense',
      confidence: 0.3,
    };
  }

  return {
    emailClass: 'unknown',
    paymentMethod: 'unknown',
    type: 'expense',
    confidence: 0,
  };
}
