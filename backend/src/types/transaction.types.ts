/**
 * Canonical Transaction Schema
 * ─────────────────────────────────────────────────────────────────────────
 * Every transaction in the system—regardless of origin—is normalised into
 * this single shape before being returned to the client.
 *
 * Design decisions beyond the original spec:
 *   • `currency`      – added for multi-currency support (defaults to "INR")
 *   • `rawAmount`     – preserves the exact string parsed from the source
 *   • `confidence`    – parser certainty [0-1]; used by deduplication
 *   • `parseStatus`   – tracks whether parsing fully succeeded
 *   • `tags`          – user-extensible labels (merged from parser hints)
 *   • `linkedTxnId`   – for ATM: links the cash-out to subsequent cash spends
 *   • `gmailMessageId`– non-sensitive Gmail identifier for dedup; NOT content
 * ─────────────────────────────────────────────────────────────────────────
 */

// ─── Enumerations ────────────────────────────────────────────────────────────

export type TransactionType = 'income' | 'expense' | 'transfer';

export type PaymentMethod = 'upi' | 'card' | 'cash' | 'bank' | 'atm' | 'netbanking' | 'unknown';

export type TransactionSource = 'gmail' | 'manual' | 'receipt' | 'statement';

export type ParseStatus = 'success' | 'partial' | 'failed';

export type TransactionCategory =
  | 'food'
  | 'transport'
  | 'shopping'
  | 'entertainment'
  | 'health'
  | 'education'
  | 'utilities'
  | 'rent'
  | 'salary'
  | 'investment'
  | 'atm_withdrawal'   // Bank → Cash transfer (NOT an expense)
  | 'bank_transfer'
  | 'upi_transfer'
  | 'refund'
  | 'subscription'
  | 'insurance'
  | 'tax'
  | 'other'
  | 'uncategorized';

// ─── Core Schema ─────────────────────────────────────────────────────────────

export interface CanonicalTransaction {
  /** Deterministic UUID v5 derived from dedup signals; stable across syncs */
  id: string;

  /** Transaction date (ISO 8601 – may be date-only if time is unavailable) */
  date: string;

  /** Numeric amount in the smallest accountable unit of the currency (e.g. paise for INR) */
  amount: number;

  /** ISO 4217 currency code */
  currency: string;

  /** income | expense | transfer */
  type: TransactionType;

  /** Granular category classification */
  category: TransactionCategory;

  /** How the money moved */
  paymentMethod: PaymentMethod;

  /** Where this transaction record originated */
  source: TransactionSource;

  /** Human-readable description (sanitised) */
  description: string;

  /** Merchant / payee name (null if unknown) */
  merchant: string | null;

  /** Bank / UPI reference number (null if unavailable) */
  reference: string | null;

  /** ISO 8601 timestamp when this record was created on the backend */
  createdAt: string;

  /**
   * For ATM withdrawals: links the withdrawal record to subsequent cash
   * expense records created from the same cash pool.
   * Null for non-ATM transactions.
   */
  linkedTxnId: string | null;

  /**
   * Parser confidence [0.0 – 1.0].
   * 1.0 = all required fields extracted cleanly.
   * < 0.5 = partial extraction; frontend should flag for user review.
   */
  confidence: number;

  /** Whether the parser fully, partially, or failed to parse this email */
  parseStatus: ParseStatus;

  /** The original unparsed amount string (e.g. "₹1,234.56") */
  rawAmount: string | null;

  /** Flexible key-value metadata (bank name, UPI VPA, card last4, etc.) */
  metadata: TransactionMetadata;

  /** User-defined or parser-suggested tags */
  tags: string[];
}

export interface TransactionMetadata {
  /** Gmail message ID (non-sensitive identifier, used for dedup only) */
  gmailMessageId?: string;

  /** Gmail thread ID */
  gmailThreadId?: string;

  /** Sender email of the originating Gmail message */
  senderEmail?: string;

  /** Name of the sending bank / institution */
  bankName?: string;

  /** Last 4 digits of the card (non-sensitive) */
  cardLast4?: string;

  /** UPI Virtual Payment Address */
  upiVpa?: string;

  /** Account number suffix (last 4 digits only – for display) */
  accountSuffix?: string;

  /** Available balance after transaction (some bank alerts include this) */
  availableBalance?: number;

  /** Raw email subject (sanitised – no financial data) */
  emailSubject?: string;

  /** Extraction engine used (gemini or regex) */
  extractionMethod?: 'gemini' | 'regex';

  /** Reason provided by Gemini when confidence is low or special handling needed */
  geminiReason?: string;

  /** Any parser-specific notes (for debugging / improvement) */
  parserNotes?: string;

  /** Any additional bank-specific fields */
  [key: string]: unknown;
}

// ─── Partial during parsing ───────────────────────────────────────────────────

/** Used during the parsing pipeline; becomes CanonicalTransaction on completion */
export type PartialTransaction = Omit<CanonicalTransaction, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

// ─── Deduplication ───────────────────────────────────────────────────────────

export interface DeduplicationSignal {
  amount: number;
  date: string;          // YYYY-MM-DD
  merchant: string | null;
  reference: string | null;
  paymentMethod: PaymentMethod;
  gmailMessageId?: string;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  confidence: number;
  matchedId: string | null;
  reason: string;
}

// ─── Parser results ───────────────────────────────────────────────────────────

export interface ParseResult {
  success: boolean;
  transaction: CanonicalTransaction | null;
  error?: string;
  rawEmailId?: string;
}

export interface BatchParseResult {
  parsed: CanonicalTransaction[];
  failed: ParseFailure[];
  duplicatesSkipped: number;
  totalProcessed: number;
}

export interface ParseFailure {
  gmailMessageId: string;
  subject: string;          // Safe to log – no financial data
  senderDomain: string;     // Only domain, not full address
  reason: string;
  timestamp: string;
}

// ─── ATM / Cash flow ─────────────────────────────────────────────────────────

/**
 * ATM withdrawals create a "cash pool" – not an expense.
 * When the user later logs cash spending, it draws from this pool.
 */
export interface CashPool {
  sourceTransactionId: string;  // The ATM withdrawal txn ID
  totalAmount: number;
  currency: string;
  date: string;
  remainingAmount?: number;     // Tracked on client side
}
