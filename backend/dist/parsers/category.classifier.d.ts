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
/**
 * Classify a transaction into a category.
 */
export declare function classifyCategory(params: {
    emailClass: EmailClass;
    merchant: string | null;
    description: string;
    body: string;
    type: string;
}): TransactionCategory;
