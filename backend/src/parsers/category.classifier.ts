/**
 * Category Classifier
 * ─────────────────────────────────────────────────────────────────────────
 * Assigns a transaction category based on:
 *  1. Email class (ATM withdrawal always → atm_withdrawal)
 *  2. Merchant name keyword matching
 *  3. Email body keyword matching
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { TransactionCategory } from '../types/transaction.types';
import type { EmailClass } from './classifier';

interface CategoryRule {
  keywords: RegExp[];
  category: TransactionCategory;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    keywords: [/\b(zomato|swiggy|uber ?eats|food|restaurant|cafe|biryani|pizza|burger|dominos|kfc|mcdonalds|subway|hotel|dhaba|canteen|meals|snacks|tea|coffee|starbucks|barista)\b/i],
    category: 'food',
  },
  {
    keywords: [/\b(uber|ola|rapido|namma yatri|metro|railway|irctc|bus|auto|cab|travel|flight|spicejet|indigo|airasia|makemytrip|redbus|yatra|petrol|fuel|shell|hp ?petrol|iocl|bpcl)\b/i],
    category: 'transport',
  },
  {
    keywords: [/\b(amazon|flipkart|myntra|ajio|nykaa|meesho|snapdeal|paytm ?mall|shopsy|tatacliq|decathlon|reliance|dmart|big ?bazaar|grofers|blinkit|zepto|swiggy ?instamart|bigbasket)\b/i],
    category: 'shopping',
  },
  {
    keywords: [/\b(netflix|prime|hotstar|disney|zee5|sony|youtube|spotify|jio ?cinema|aha|apple|google play|steam|epic|gaming|movie|theatre|pvr|inox|bookmyshow|concert)\b/i],
    category: 'entertainment',
  },
  {
    keywords: [/\b(hospital|clinic|pharmacy|medplus|apollo|fortis|aiims|doctor|medicine|health|pharma|netmeds|1mg|practo|dentist|lab test|diagnostic)\b/i],
    category: 'health',
  },
  {
    keywords: [/\b(school|college|university|tuition|coaching|udemy|coursera|byjus|unacademy|vedantu|exam|fees|education|books|stationery)\b/i],
    category: 'education',
  },
  {
    keywords: [/\b(electricity|bescom|tneb|msedcl|water|gas|lpg|internet|broadband|airtel|jio|bsnl|vi|vodafone|idea|mobile|recharge|dth|tata sky|dish tv)\b/i],
    category: 'utilities',
  },
  {
    keywords: [/\b(rent|house rent|pg|hostel|landlord|accommodation)\b/i],
    category: 'rent',
  },
  {
    keywords: [/\b(salary|payroll|wages|stipend|bonus|incentive|commission|income)\b/i],
    category: 'salary',
  },
  {
    keywords: [/\b(mutual ?fund|sip|stocks|shares|zerodha|groww|upstox|coin|demat|nse|bse|ipo|dividend|fds?|fixed deposit|ppf|elss|nps)\b/i],
    category: 'investment',
  },
  {
    keywords: [/\b(lic|insurance|premium|policy|cover|term|health insurance|motor insurance)\b/i],
    category: 'insurance',
  },
  {
    keywords: [/\b(tax|tds|gst|income tax|advance tax|itr)\b/i],
    category: 'tax',
  },
  {
    keywords: [/\b(refund|cashback|reversal|return)\b/i],
    category: 'refund',
  },
  {
    keywords: [/\b(subscription|membership|plan|renewal|annual fee|monthly fee)\b/i],
    category: 'subscription',
  },
  {
    keywords: [/\b(neft|rtgs|imps|transfer|sent to|transferred)\b/i],
    category: 'bank_transfer',
  },
];

/**
 * Classify a transaction into a category.
 */
export function classifyCategory(params: {
  emailClass: EmailClass;
  merchant: string | null;
  description: string;
  body: string;
  type: string;
}): TransactionCategory {
  const { emailClass, merchant, description, body, type } = params;

  // Hard-coded overrides
  if (emailClass === 'atm_withdrawal') return 'atm_withdrawal';
  if (emailClass === 'bank_transfer' || emailClass === 'neft_credit' || emailClass === 'neft_debit' ||
      emailClass === 'rtgs_credit' || emailClass === 'rtgs_debit') return 'bank_transfer';
  if (emailClass === 'imps_credit' || emailClass === 'imps_debit') return 'bank_transfer';
  if (emailClass === 'upi_credit' || emailClass === 'upi_debit') {
    // UPI may still be categorisable by merchant
  }
  if (type === 'income' && emailClass === 'bank_credit') {
    // Could be salary
  }

  const searchText = `${merchant ?? ''} ${description} ${body.substring(0, 500)}`.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      if (keyword.test(searchText)) {
        return rule.category;
      }
    }
  }

  // Type-based fallback
  if (emailClass === 'upi_credit' || emailClass === 'bank_credit') return 'other';
  if (emailClass === 'upi_debit' || emailClass === 'bank_debit' || emailClass === 'card_debit') return 'other';

  return 'uncategorized';
}
