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
export type EmailClass = 'upi_credit' | 'upi_debit' | 'bank_credit' | 'bank_debit' | 'atm_withdrawal' | 'card_debit' | 'card_credit' | 'neft_credit' | 'neft_debit' | 'rtgs_credit' | 'rtgs_debit' | 'imps_credit' | 'imps_debit' | 'bank_transfer' | 'unknown';
export interface ClassifiedEmail {
    emailClass: EmailClass;
    paymentMethod: PaymentMethod;
    type: TransactionType;
    confidence: number;
}
/**
 * Classify an email into a transaction type.
 */
export declare function classifyEmail(params: {
    subject: string;
    senderEmail: string;
    senderDomain: string;
    body: string;
}): ClassifiedEmail;
