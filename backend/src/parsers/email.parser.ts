/**
 * Core Email Parser
 * ─────────────────────────────────────────────────────────────────────────
 * Converts a ParsedEmail into a CanonicalTransaction using:
 *  1. Classification  → determine transaction type & payment method
 *  2. Amount parsing  → extract amount in paise
 *  3. Date parsing    → extract transaction date
 *  4. Merchant        → extract payee/merchant name
 *  5. Reference       → extract bank/UPI reference number
 *  6. Category        → classify spending category
 *  7. ID generation   → stable UUID-v5 from dedup signals
 *
 * Errors are caught per-email — one bad email never crashes the batch.
 * ─────────────────────────────────────────────────────────────────────────
 */

import crypto from 'crypto';
import { v5 as uuidv5 } from 'uuid';

import { classifyEmail } from './classifier';
import { extractAmount, extractAllAmounts } from './amount.parser';
import { extractDate, toDateOnly } from './date.parser';
import {
  extractMerchant,
  extractUpiVpa,
  extractReference,
  extractAccountSuffix,
  extractAvailableBalance,
} from './merchant.parser';
import { classifyCategory } from './category.classifier';
import { logger } from '../utils/logger';

import type { ParsedEmail } from '../types/gmail.types';
import type {
  CanonicalTransaction,
  ParseResult,
  ParseFailure,
  PartialTransaction,
} from '../types/transaction.types';

// Stable namespace UUID for deterministic transaction IDs
const TRANSACTION_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// ─── ID Generation ────────────────────────────────────────────────────────────

/**
 * Generate a deterministic transaction ID from dedup signals.
 * The same transaction will always produce the same ID, making
 * deduplication straightforward even across different sync sessions.
 */
function generateTransactionId(signals: {
  gmailMessageId: string;
  amount: number;
  dateOnly: string;
  paymentMethod: string;
}): string {
  const seed = `${signals.gmailMessageId}:${signals.amount}:${signals.dateOnly}:${signals.paymentMethod}`;
  return uuidv5(seed, TRANSACTION_ID_NAMESPACE);
}

// ─── Description Builder ──────────────────────────────────────────────────────

function buildDescription(params: {
  emailClass: string;
  merchant: string | null;
  subject: string;
  upiVpa: string | null;
}): string {
  const { emailClass, merchant, subject, upiVpa } = params;

  if (merchant) {
    if (emailClass.includes('credit') || emailClass.includes('income')) {
      return `Received from ${merchant}`;
    }
    if (emailClass === 'atm_withdrawal') {
      return `ATM Cash Withdrawal`;
    }
    return `Payment to ${merchant}`;
  }

  if (upiVpa) {
    if (emailClass.startsWith('upi_credit')) return `UPI credit from ${upiVpa}`;
    if (emailClass.startsWith('upi_debit')) return `UPI payment to ${upiVpa}`;
  }

  // Fallback: clean up subject
  return subject
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse a single financial email into a CanonicalTransaction.
 */
export function parseEmail(email: ParsedEmail): ParseResult {
  try {
    const body = email.combinedBody;

    // ── 1. Classify ──────────────────────────────────────────────────────────
    const classification = classifyEmail({
      subject: email.subject,
      senderEmail: email.senderEmail,
      senderDomain: email.senderDomain,
      body,
    });

    if (classification.emailClass === 'unknown' && classification.confidence === 0) {
      return {
        success: false,
        transaction: null,
        error: 'Email does not appear to be a financial transaction',
        rawEmailId: email.messageId,
      };
    }

    // ── 2. Extract amount ────────────────────────────────────────────────────
    const amountResult = extractAmount(body) ?? extractAmount(email.subject);
    if (!amountResult) {
      return {
        success: false,
        transaction: null,
        error: 'Could not extract transaction amount',
        rawEmailId: email.messageId,
      };
    }

    // ── 3. Extract date ──────────────────────────────────────────────────────
    // Prefer body date, fall back to Gmail message date
    const date = extractDate(body) ?? extractDate(email.subject) ?? email.date;

    // ── 4. Extract merchant / payee ──────────────────────────────────────────
    const merchant = extractMerchant(body, classification.emailClass);
    const upiVpa = extractUpiVpa(body);

    // ── 5. Extract reference ─────────────────────────────────────────────────
    const reference = extractReference(body);

    // ── 6. Extract account metadata ──────────────────────────────────────────
    const accountSuffix = extractAccountSuffix(body);
    const availableBalance = extractAvailableBalance(body);

    // ── 7. Build description ─────────────────────────────────────────────────
    const description = buildDescription({
      emailClass: classification.emailClass,
      merchant,
      subject: email.subject,
      upiVpa,
    });

    // ── 8. Classify category ─────────────────────────────────────────────────
    const category = classifyCategory({
      emailClass: classification.emailClass,
      merchant,
      description,
      body,
      type: classification.type,
    });

    // ── 9. Determine parse status ─────────────────────────────────────────────
    const hasAllCritical = !!amountResult && !!date;
    const hasOptional = !!(merchant || reference);
    const parseStatus = hasAllCritical && hasOptional
      ? 'success'
      : hasAllCritical
      ? 'partial'
      : 'failed';

    const confidence = hasAllCritical
      ? classification.confidence * (hasOptional ? 1 : 0.85)
      : 0.1;

    // ── 10. Generate stable ID ────────────────────────────────────────────────
    const id = generateTransactionId({
      gmailMessageId: email.messageId,
      amount: amountResult.amountPaise,
      dateOnly: toDateOnly(date),
      paymentMethod: classification.paymentMethod,
    });

    // ── 11. Build canonical transaction ──────────────────────────────────────
    const transaction: CanonicalTransaction = {
      id,
      date,
      amount: amountResult.amountPaise,
      currency: 'INR',
      type: classification.type,
      category,
      paymentMethod: classification.paymentMethod,
      source: 'gmail',
      description,
      merchant,
      reference,
      createdAt: new Date().toISOString(),
      linkedTxnId: null,
      confidence,
      parseStatus,
      rawAmount: amountResult.rawAmount,
      tags: buildTags(classification.emailClass, classification.paymentMethod),
      metadata: {
        gmailMessageId: email.messageId,
        gmailThreadId: email.threadId,
        senderEmail: email.senderEmail,
        bankName: inferBankName(email.senderDomain),
        cardLast4: accountSuffix ?? undefined,
        upiVpa: upiVpa ?? undefined,
        accountSuffix: accountSuffix ?? undefined,
        availableBalance: availableBalance ?? undefined,
        emailSubject: email.subject.substring(0, 150),
        parserNotes: parseStatus !== 'success' ? `confidence=${confidence.toFixed(2)}` : undefined,
      },
    };

    return { success: true, transaction, rawEmailId: email.messageId };
  } catch (err) {
    logger.warn('Email parser threw unexpected error', {
      messageId: email.messageId,
      senderDomain: email.senderDomain,
      error: (err as Error).message,
    });

    return {
      success: false,
      transaction: null,
      error: `Parser error: ${(err as Error).message}`,
      rawEmailId: email.messageId,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTags(emailClass: string, paymentMethod: string): string[] {
  const tags: string[] = [];
  if (emailClass === 'atm_withdrawal') tags.push('atm', 'cash-out');
  if (paymentMethod === 'upi') tags.push('upi');
  if (paymentMethod === 'card') tags.push('card');
  if (emailClass.includes('neft')) tags.push('neft');
  if (emailClass.includes('rtgs')) tags.push('rtgs');
  if (emailClass.includes('imps')) tags.push('imps');
  return tags;
}

/**
 * Infer human-readable bank name from sender domain.
 */
function inferBankName(domain: string): string | undefined {
  const BANK_NAMES: Record<string, string> = {
    'hdfcbank.com': 'HDFC Bank',
    'icicibank.com': 'ICICI Bank',
    'axisbank.com': 'Axis Bank',
    'sbi.co.in': 'State Bank of India',
    'onlinesbi.com': 'State Bank of India',
    'kotak.com': 'Kotak Mahindra Bank',
    'kotakbank.com': 'Kotak Mahindra Bank',
    'pnb.co.in': 'Punjab National Bank',
    'bankofbaroda.com': 'Bank of Baroda',
    'canarabank.com': 'Canara Bank',
    'indusind.com': 'IndusInd Bank',
    'yesbank.in': 'Yes Bank',
    'paytmbank.com': 'Paytm Payments Bank',
    'paytm.com': 'Paytm',
    'phonepe.com': 'PhonePe',
    'unionbankofindia.com': 'Union Bank of India',
    'federalbank.co.in': 'Federal Bank',
    'rblbank.com': 'RBL Bank',
    'southindianbank.com': 'South Indian Bank',
  };
  return BANK_NAMES[domain];
}

// ─── Batch parser ─────────────────────────────────────────────────────────────

/**
 * Parse a batch of emails. Errors are isolated per-email.
 */
export function parseEmailBatch(emails: ParsedEmail[]): {
  parsed: CanonicalTransaction[];
  failures: ParseFailure[];
} {
  const parsed: CanonicalTransaction[] = [];
  const failures: ParseFailure[] = [];

  for (const email of emails) {
    const result = parseEmail(email);

    if (result.success && result.transaction) {
      parsed.push(result.transaction);
    } else {
      failures.push({
        gmailMessageId: email.messageId,
        subject: email.subject.substring(0, 100),
        senderDomain: email.senderDomain,
        reason: result.error ?? 'Unknown parse failure',
        timestamp: new Date().toISOString(),
      });
    }
  }

  logger.info('Email batch parsing complete', {
    total: emails.length,
    parsed: parsed.length,
    failed: failures.length,
  });

  return { parsed, failures };
}
