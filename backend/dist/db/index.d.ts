/**
 * Server Account Database & Connection Architecture
 * ─────────────────────────────────────────────────────────────────────────
 * PRIVACY RULE:
 * This database stores ONLY account and authentication metadata for Kanakku.
 * It NEVER stores financial transactions, bank data, receipts, or chat logs.
 *
 * Supported Engines:
 *   1. PostgreSQL: Used in production or when DATABASE_URL is configured.
 *   2. Relational Store: Built-in local relational SQL storage with atomic
 *      transactions for zero-config offline/local development.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface UserRecord {
    id: string;
    email: string;
    display_name: string;
    google_id: string | null;
    password_hash: string | null;
    language: string;
    account_status: 'active' | 'disabled' | 'deleted';
    picture?: string | null;
    work_type?: string | null;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
}
export interface AccountMetrics {
    totalAccounts: number;
    activeAccounts: number;
    disabledAccounts: number;
    createdToday: number;
    createdThisMonth: number;
    lastLoginRecorded: string | null;
}
/**
 * A user's connected Gmail account, independent of how they log into
 * Kanakku itself. One row per Kanakku user (user_id is unique).
 *
 * PRIVACY: only OAuth credentials + connection metadata live here.
 * Refresh/access tokens are ALWAYS encrypted (AES-256-GCM, via
 * utils/crypto.ts) before being written — never stored in plaintext,
 * never logged, never returned to the frontend.
 */
export interface GmailConnectionRecord {
    id: string;
    user_id: string;
    google_account_email: string;
    encrypted_refresh_token: string;
    encrypted_access_token: string | null;
    token_expiry_ms: number | null;
    scope: string;
    connected_at: string;
    updated_at: string;
}
export interface ProcessedMessageRecord {
    id: string;
    user_id: string;
    gmail_message_id: string;
    processed_at: string;
    status: 'processed' | 'skipped' | 'failed';
    transaction_id: string | null;
}
export interface GmailSyncStateRecord {
    user_id: string;
    last_sync_started_at: string | null;
    last_sync_completed_at: string | null;
    last_successful_message_date: string | null;
    history_id: string | null;
    messages_found: number;
    messages_processed: number;
    messages_deferred: number;
    transactions_found: number;
    transactions_inserted: number;
    deferred_message_ids: string;
    status: 'idle' | 'in_progress' | 'completed' | 'partial' | 'quota_exceeded' | 'failed';
    custom_start_date?: string | null;
    custom_end_date?: string | null;
    active_preset?: string | null;
    updated_at: string;
}
declare class DatabaseManager {
    private localEngine;
    private pgEngine;
    private usePostgres;
    private initialized;
    init(): Promise<void>;
    isUsingPostgres(): boolean;
    runMigrations(): Promise<{
        applied: string[];
        alreadyUpToDate: boolean;
    }>;
    findUserById(id: string): Promise<UserRecord | null>;
    findUserByEmail(email: string): Promise<UserRecord | null>;
    findUserByGoogleId(googleId: string): Promise<UserRecord | null>;
    createUser(user: Omit<UserRecord, 'created_at' | 'updated_at'> & {
        created_at?: string;
        updated_at?: string;
    }): Promise<UserRecord>;
    updateUser(id: string, updates: Partial<Omit<UserRecord, 'id' | 'created_at'>>): Promise<UserRecord | null>;
    recordLogin(id: string): Promise<UserRecord | null>;
    getAllUsers(): Promise<UserRecord[]>;
    resetDatabase(): Promise<void>;
    getAccountMetrics(): Promise<AccountMetrics>;
    findGmailConnectionByUserId(userId: string): Promise<GmailConnectionRecord | null>;
    /**
     * Create or replace the Gmail connection for a user (one per user —
     * connecting again simply overwrites the previous credentials).
     */
    upsertGmailConnection(params: {
        userId: string;
        googleAccountEmail: string;
        encryptedRefreshToken: string;
        encryptedAccessToken?: string | null;
        tokenExpiryMs?: number | null;
        scope: string;
    }): Promise<GmailConnectionRecord>;
    /**
     * Update just the access token/expiry after a refresh (called from
     * the Gmail service, keeps the refresh token untouched).
     */
    updateGmailAccessToken(userId: string, encryptedAccessToken: string, tokenExpiryMs: number): Promise<void>;
    deleteGmailConnection(userId: string): Promise<boolean>;
    getProcessedMessageIds(userId: string, candidateIds?: string[]): Promise<Set<string>>;
    recordProcessedMessages(records: ProcessedMessageRecord[]): Promise<void>;
    getGmailSyncState(userId: string): Promise<GmailSyncStateRecord | null>;
    upsertGmailSyncState(state: Partial<GmailSyncStateRecord> & {
        user_id: string;
    }): Promise<GmailSyncStateRecord>;
    close(): Promise<void>;
}
export declare const db: DatabaseManager;
export {};
