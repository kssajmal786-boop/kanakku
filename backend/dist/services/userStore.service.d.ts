/**
 * Kanakku User Account Store
 * ─────────────────────────────────────────────────────────────────────────
 * Manages user account records in the server database (PostgreSQL / Relational Store).
 *
 * STRICT PRIVACY RULES:
 *  • Stores ONLY account credentials and preferences:
 *      id, email, display_name, google_id, password_hash, language,
 *      account_status, created_at, updated_at, last_login_at
 *  • NEVER stores financial transactions, bank data, receipts, or chat logs.
 *  • Passwords are encrypted with bcrypt before being stored. Plaintext
 *    passwords are NEVER stored, logged, or returned.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { AccountMetrics } from '../db';
export interface StoredUser {
    userId: string;
    email: string;
    name: string;
    passwordHash?: string | null;
    googleId?: string | null;
    language: string;
    accountStatus: 'active' | 'disabled' | 'deleted';
    picture?: string | null;
    workType?: string | null;
    createdAt: string;
    updatedAt: string;
    lastLoginAt?: string | null;
}
export declare function findUserById(id: string): Promise<StoredUser | null>;
export declare function findUserByEmail(email: string): Promise<StoredUser | null>;
export declare function findUserByGoogleId(googleId: string): Promise<StoredUser | null>;
export declare function createUser(params: {
    email: string;
    name: string;
    passwordHash?: string | null;
    googleId?: string | null;
    language?: string;
}): Promise<StoredUser>;
/**
 * Finds or creates a user account after successful Google authentication.
 * If user already exists by Google ID or by verified Email, updates last_login_at
 * and links google_id if it was an email-created account.
 */
export declare function findOrCreateGoogleUser(params: {
    googleId: string;
    email: string;
    name: string;
    language?: string;
}): Promise<StoredUser>;
export declare function recordUserLogin(userId: string): Promise<StoredUser | null>;
export declare function updateUserProfile(userId: string, updates: {
    display_name?: string;
    language?: string;
    account_status?: 'active' | 'disabled' | 'deleted';
    picture?: string | null;
    work_type?: string | null;
}): Promise<StoredUser | null>;
export declare function linkPasswordToAccount(userId: string, passwordHash: string): Promise<StoredUser | null>;
export declare function getAccountMetrics(): Promise<AccountMetrics>;
