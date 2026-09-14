"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const pg_1 = require("pg");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
// ─── Local Relational Engine (Zero-Config Development Fallback) ──────────────
class LocalRelationalEngine {
    constructor() {
        this.users = new Map();
        this.gmailConnections = new Map(); // keyed by user_id
        this.processedMessages = new Map(); // keyed by `${user_id}_${gmail_message_id}`
        this.gmailSyncStates = new Map(); // keyed by user_id
        this.migrations = new Set();
        this.initialized = false;
        this.writeLock = Promise.resolve();
        const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.LAMBDA_TASK_ROOT;
        this.dataDir = isServerless ? path_1.default.resolve(os_1.default.tmpdir(), 'kanakku_data') : path_1.default.resolve(process.cwd(), 'data');
        const filename = process.env.NODE_ENV === 'test' ? 'kanakku_accounts.test.json' : 'kanakku_accounts.json';
        this.dbPath = path_1.default.resolve(this.dataDir, filename);
    }
    async init() {
        if (this.initialized)
            return;
        try {
            if (!fs_1.default.existsSync(this.dataDir)) {
                fs_1.default.mkdirSync(this.dataDir, { recursive: true });
            }
        }
        catch (err) {
            logger_1.logger.warn('Could not create local data directory', { error: err.message });
        }
        if (fs_1.default.existsSync(this.dbPath)) {
            try {
                const raw = fs_1.default.readFileSync(this.dbPath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.users)) {
                    for (const u of parsed.users) {
                        this.users.set(u.id, u);
                    }
                }
                if (Array.isArray(parsed.gmailConnections)) {
                    for (const g of parsed.gmailConnections) {
                        this.gmailConnections.set(g.user_id, g);
                    }
                }
                if (Array.isArray(parsed.processedMessages)) {
                    for (const pm of parsed.processedMessages) {
                        this.processedMessages.set(`${pm.user_id}_${pm.gmail_message_id}`, pm);
                    }
                }
                if (Array.isArray(parsed.gmailSyncStates)) {
                    for (const ss of parsed.gmailSyncStates) {
                        this.gmailSyncStates.set(ss.user_id, ss);
                    }
                }
                if (Array.isArray(parsed.migrations)) {
                    for (const m of parsed.migrations) {
                        this.migrations.add(m);
                    }
                }
            }
            catch (err) {
                logger_1.logger.warn('Could not read existing local database file, starting fresh', { error: err.message });
            }
        }
        // Self-healing: if any gmailConnection exists for which a user record is missing in users,
        // restore the user record to prevent orphaned connections and preserve the historical user ID.
        let restoredCount = 0;
        for (const g of this.gmailConnections.values()) {
            if (!this.users.has(g.user_id)) {
                const normalizedEmail = (g.google_account_email || '').trim().toLowerCase();
                let emailFound = false;
                for (const u of this.users.values()) {
                    if (u.email.toLowerCase() === normalizedEmail) {
                        emailFound = true;
                        break;
                    }
                }
                if (!emailFound && normalizedEmail) {
                    const restored = {
                        id: g.user_id,
                        email: normalizedEmail,
                        display_name: normalizedEmail.split('@')[0] || 'User',
                        google_id: null,
                        password_hash: null,
                        language: 'en',
                        account_status: 'active',
                        created_at: g.connected_at || new Date().toISOString(),
                        updated_at: g.updated_at || new Date().toISOString(),
                        last_login_at: g.updated_at || new Date().toISOString(),
                        picture: null,
                        work_type: null,
                    };
                    this.users.set(g.user_id, restored);
                    restoredCount++;
                    logger_1.logger.info('Restored missing user record from Gmail connection', { userId: g.user_id, email: normalizedEmail });
                }
            }
        }
        if (restoredCount > 0 && process.env.NODE_ENV !== 'test') {
            await this.persist();
        }
        this.initialized = true;
        logger_1.logger.info('Local relational account database initialized', { records: this.users.size, path: this.dbPath });
    }
    async persist() {
        this.writeLock = this.writeLock.then(() => {
            try {
                const data = {
                    _schema: 'kanakku_accounts_v1',
                    _comment: 'Server database strictly stores only account credentials and preferences - NO financial data.',
                    migrations: Array.from(this.migrations),
                    users: Array.from(this.users.values()),
                    gmailConnections: Array.from(this.gmailConnections.values()),
                    processedMessages: Array.from(this.processedMessages.values()),
                    gmailSyncStates: Array.from(this.gmailSyncStates.values()),
                };
                fs_1.default.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
            }
            catch (err) {
                logger_1.logger.warn('Could not persist local relational database to disk', { error: err.message });
            }
        });
        return this.writeLock;
    }
    async findById(id) {
        await this.init();
        let user = this.users.get(id);
        if (!user) {
            const conn = this.gmailConnections.get(id);
            if (conn) {
                const normalizedEmail = (conn.google_account_email || '').trim().toLowerCase();
                user = {
                    id: conn.user_id,
                    email: normalizedEmail,
                    display_name: normalizedEmail.split('@')[0] || 'User',
                    google_id: null,
                    password_hash: null,
                    language: 'en',
                    account_status: 'active',
                    created_at: conn.connected_at || new Date().toISOString(),
                    updated_at: conn.updated_at || new Date().toISOString(),
                    last_login_at: conn.updated_at || new Date().toISOString(),
                    picture: null,
                    work_type: null,
                };
                this.users.set(user.id, user);
                if (process.env.NODE_ENV !== 'test') {
                    await this.persist();
                }
            }
        }
        return user || null;
    }
    async findByEmail(email) {
        await this.init();
        const normalized = email.trim().toLowerCase();
        for (const u of this.users.values()) {
            if (u.email.toLowerCase() === normalized)
                return u;
        }
        for (const conn of this.gmailConnections.values()) {
            if (conn.google_account_email && conn.google_account_email.toLowerCase() === normalized) {
                const user = {
                    id: conn.user_id,
                    email: normalized,
                    display_name: normalized.split('@')[0] || 'User',
                    google_id: null,
                    password_hash: null,
                    language: 'en',
                    account_status: 'active',
                    created_at: conn.connected_at || new Date().toISOString(),
                    updated_at: conn.updated_at || new Date().toISOString(),
                    last_login_at: conn.updated_at || new Date().toISOString(),
                    picture: null,
                    work_type: null,
                };
                this.users.set(user.id, user);
                if (process.env.NODE_ENV !== 'test') {
                    await this.persist();
                }
                return user;
            }
        }
        return null;
    }
    async findByGoogleId(googleId) {
        await this.init();
        for (const u of this.users.values()) {
            if (u.google_id && u.google_id === googleId)
                return u;
        }
        return null;
    }
    async insert(user) {
        await this.init();
        if (this.users.has(user.id)) {
            throw new Error(`User with ID ${user.id} already exists`);
        }
        const existingEmail = await this.findByEmail(user.email);
        if (existingEmail) {
            throw new Error(`User with email ${user.email} already exists`);
        }
        if (user.google_id) {
            const existingGoogle = await this.findByGoogleId(user.google_id);
            if (existingGoogle) {
                throw new Error(`User with Google ID ${user.google_id} already exists`);
            }
        }
        this.users.set(user.id, { ...user });
        await this.persist();
        return { ...user };
    }
    async update(id, updates) {
        await this.init();
        const existing = this.users.get(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...updates,
            id: existing.id, // Immutable ID
            created_at: existing.created_at, // Immutable creation date
            updated_at: new Date().toISOString(),
        };
        this.users.set(id, updated);
        await this.persist();
        return { ...updated };
    }
    async delete(id) {
        await this.init();
        const existed = this.users.delete(id);
        if (existed)
            await this.persist();
        return existed;
    }
    async getAll() {
        await this.init();
        return Array.from(this.users.values()).map(u => ({ ...u }));
    }
    async reset() {
        this.users.clear();
        this.gmailConnections.clear();
        this.processedMessages.clear();
        this.gmailSyncStates.clear();
        this.migrations.clear();
        await this.persist();
    }
    async recordMigration(name) {
        await this.init();
        this.migrations.add(name);
        await this.persist();
    }
    async getMigrations() {
        await this.init();
        return Array.from(this.migrations);
    }
    // ── Gmail Connections ──────────────────────────────────────────────────────
    async findGmailConnectionByUserId(userId) {
        await this.init();
        return this.gmailConnections.get(userId) || null;
    }
    async upsertGmailConnection(record) {
        await this.init();
        this.gmailConnections.set(record.user_id, { ...record });
        await this.persist();
        return { ...record };
    }
    async deleteGmailConnectionByUserId(userId) {
        await this.init();
        const existed = this.gmailConnections.delete(userId);
        if (existed)
            await this.persist();
        return existed;
    }
    // ── Gmail Processed Messages ────────────────────────────────────────────────
    async getProcessedMessageIds(userId, candidateIds) {
        await this.init();
        const result = new Set();
        if (candidateIds && candidateIds.length > 0) {
            for (const id of candidateIds) {
                if (this.processedMessages.has(`${userId}_${id}`)) {
                    result.add(id);
                }
            }
        }
        else {
            for (const record of this.processedMessages.values()) {
                if (record.user_id === userId) {
                    result.add(record.gmail_message_id);
                }
            }
        }
        return result;
    }
    async recordProcessedMessages(records) {
        if (!records.length)
            return;
        await this.init();
        for (const r of records) {
            this.processedMessages.set(`${r.user_id}_${r.gmail_message_id}`, { ...r });
        }
        await this.persist();
    }
    // ── Gmail Sync States ───────────────────────────────────────────────────────
    async getGmailSyncState(userId) {
        await this.init();
        return this.gmailSyncStates.get(userId) || null;
    }
    async upsertGmailSyncState(state) {
        await this.init();
        const existing = this.gmailSyncStates.get(state.user_id);
        const now = new Date().toISOString();
        const updated = {
            user_id: state.user_id,
            last_sync_started_at: state.last_sync_started_at !== undefined ? state.last_sync_started_at : (existing?.last_sync_started_at ?? null),
            last_sync_completed_at: state.last_sync_completed_at !== undefined ? state.last_sync_completed_at : (existing?.last_sync_completed_at ?? null),
            last_successful_message_date: state.last_successful_message_date !== undefined ? state.last_successful_message_date : (existing?.last_successful_message_date ?? null),
            history_id: state.history_id !== undefined ? state.history_id : (existing?.history_id ?? null),
            messages_found: state.messages_found ?? existing?.messages_found ?? 0,
            messages_processed: state.messages_processed ?? existing?.messages_processed ?? 0,
            messages_deferred: state.messages_deferred ?? existing?.messages_deferred ?? 0,
            transactions_found: state.transactions_found ?? existing?.transactions_found ?? 0,
            transactions_inserted: state.transactions_inserted ?? existing?.transactions_inserted ?? 0,
            deferred_message_ids: state.deferred_message_ids !== undefined ? state.deferred_message_ids : (existing?.deferred_message_ids ?? '[]'),
            status: state.status ?? existing?.status ?? 'idle',
            custom_start_date: state.custom_start_date !== undefined ? state.custom_start_date : (existing?.custom_start_date ?? null),
            custom_end_date: state.custom_end_date !== undefined ? state.custom_end_date : (existing?.custom_end_date ?? null),
            active_preset: state.active_preset !== undefined ? state.active_preset : (existing?.active_preset ?? null),
            updated_at: now,
        };
        this.gmailSyncStates.set(state.user_id, updated);
        await this.persist();
        return updated;
    }
}
// ─── PostgreSQL Database Engine ──────────────────────────────────────────────
class PostgresEngine {
    constructor(connectionString) {
        this.connectionString = connectionString;
        this.pool = null;
        this.initialized = false;
    }
    async init() {
        if (this.initialized && this.pool)
            return;
        const poolConfig = {
            connectionString: this.connectionString,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            ssl: config_1.config.server.isProduction ? { rejectUnauthorized: false } : undefined,
        };
        this.pool = new pg_1.Pool(poolConfig);
        // Test connection
        const client = await this.pool.connect();
        try {
            await client.query('SELECT NOW()');
            this.initialized = true;
            logger_1.logger.info('Connected to PostgreSQL account database');
        }
        finally {
            client.release();
        }
    }
    async query(text, params = []) {
        await this.init();
        const res = await this.pool.query(text, params);
        return res.rows;
    }
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.initialized = false;
        }
    }
}
// ─── Unified Database Layer ──────────────────────────────────────────────────
class DatabaseManager {
    constructor() {
        this.localEngine = new LocalRelationalEngine();
        this.pgEngine = null;
        this.usePostgres = false;
        this.initialized = false;
    }
    async init() {
        if (this.initialized)
            return;
        const dbUrl = process.env.DATABASE_URL?.trim();
        if (dbUrl && !dbUrl.includes('placeholder')) {
            try {
                this.pgEngine = new PostgresEngine(dbUrl);
                await this.pgEngine.init();
                this.usePostgres = true;
                logger_1.logger.info('DatabaseManager using PostgreSQL backend');
            }
            catch (err) {
                logger_1.logger.warn('Failed to connect to PostgreSQL, falling back to local relational store', { error: err.message });
                this.usePostgres = false;
            }
        }
        if (!this.usePostgres) {
            await this.localEngine.init();
            logger_1.logger.info('DatabaseManager using local relational store');
        }
        await this.runMigrations();
        this.initialized = true;
    }
    isUsingPostgres() {
        return this.usePostgres;
    }
    // ── Migration System ───────────────────────────────────────────────────────
    async runMigrations() {
        const migrations = [
            {
                id: '001_create_users_table',
                sql: `
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(64) PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            display_name VARCHAR(255) NOT NULL,
            google_id VARCHAR(128) UNIQUE,
            password_hash VARCHAR(255),
            language VARCHAR(10) DEFAULT 'en' NOT NULL,
            account_status VARCHAR(20) DEFAULT 'active' NOT NULL,
            created_at VARCHAR(64) NOT NULL,
            updated_at VARCHAR(64) NOT NULL,
            last_login_at VARCHAR(64)
          );
          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
          CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
          CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
        `,
            },
            {
                id: '002_create_gmail_connections_table',
                sql: `
          CREATE TABLE IF NOT EXISTS gmail_connections (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            google_account_email VARCHAR(255) NOT NULL,
            encrypted_refresh_token TEXT NOT NULL,
            encrypted_access_token TEXT,
            token_expiry_ms BIGINT,
            scope VARCHAR(255) NOT NULL,
            connected_at VARCHAR(64) NOT NULL,
            updated_at VARCHAR(64) NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_gmail_connections_user_id ON gmail_connections(user_id);
        `,
            },
            {
                id: '003_create_gmail_sync_tables',
                sql: `
          CREATE TABLE IF NOT EXISTS gmail_processed_messages (
            id VARCHAR(128) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            gmail_message_id VARCHAR(64) NOT NULL,
            processed_at VARCHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL,
            transaction_id VARCHAR(64),
            CONSTRAINT uq_user_message UNIQUE (user_id, gmail_message_id)
          );
          CREATE INDEX IF NOT EXISTS idx_gpm_user_message ON gmail_processed_messages(user_id, gmail_message_id);

          CREATE TABLE IF NOT EXISTS gmail_sync_states (
            user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            last_sync_started_at VARCHAR(64),
            last_sync_completed_at VARCHAR(64),
            last_successful_message_date VARCHAR(64),
            history_id VARCHAR(64),
            messages_found INTEGER DEFAULT 0,
            messages_processed INTEGER DEFAULT 0,
            messages_deferred INTEGER DEFAULT 0,
            transactions_found INTEGER DEFAULT 0,
            transactions_inserted INTEGER DEFAULT 0,
            deferred_message_ids TEXT,
            status VARCHAR(32) DEFAULT 'idle',
            updated_at VARCHAR(64) NOT NULL
          );
        `,
            },
            {
                id: '004_add_picture_and_sync_settings',
                sql: `
          ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS work_type VARCHAR(64);
          ALTER TABLE gmail_sync_states ADD COLUMN IF NOT EXISTS custom_start_date VARCHAR(32);
          ALTER TABLE gmail_sync_states ADD COLUMN IF NOT EXISTS custom_end_date VARCHAR(32);
          ALTER TABLE gmail_sync_states ADD COLUMN IF NOT EXISTS active_preset VARCHAR(32);
        `,
            },
        ];
        const applied = [];
        if (this.usePostgres && this.pgEngine) {
            // Create migration table
            await this.pgEngine.query(`
        CREATE TABLE IF NOT EXISTS _schema_migrations (
          id VARCHAR(128) PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
            const executed = await this.pgEngine.query('SELECT id FROM _schema_migrations');
            const executedSet = new Set(executed.map(r => r.id));
            for (const m of migrations) {
                if (!executedSet.has(m.id)) {
                    logger_1.logger.info(`Running migration: ${m.id}`);
                    await this.pgEngine.query(m.sql);
                    await this.pgEngine.query('INSERT INTO _schema_migrations (id) VALUES ($1)', [m.id]);
                    applied.push(m.id);
                }
            }
        }
        else {
            const existing = await this.localEngine.getMigrations();
            const executedSet = new Set(existing);
            for (const m of migrations) {
                if (!executedSet.has(m.id)) {
                    logger_1.logger.info(`Running local migration: ${m.id}`);
                    await this.localEngine.recordMigration(m.id);
                    applied.push(m.id);
                }
            }
        }
        return { applied, alreadyUpToDate: applied.length === 0 };
    }
    // ── Account Operations (CRUD) ──────────────────────────────────────────────
    async findUserById(id) {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            const rows = await this.pgEngine.query('SELECT * FROM users WHERE id = $1', [id]);
            return rows[0] || null;
        }
        return this.localEngine.findById(id);
    }
    async findUserByEmail(email) {
        await this.init();
        const normalized = email.trim().toLowerCase();
        if (this.usePostgres && this.pgEngine) {
            const rows = await this.pgEngine.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalized]);
            return rows[0] || null;
        }
        return this.localEngine.findByEmail(normalized);
    }
    async findUserByGoogleId(googleId) {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            const rows = await this.pgEngine.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
            return rows[0] || null;
        }
        return this.localEngine.findByGoogleId(googleId);
    }
    async createUser(user) {
        await this.init();
        const now = new Date().toISOString();
        const record = {
            ...user,
            email: user.email.trim().toLowerCase(),
            display_name: user.display_name.trim(),
            language: user.language || 'en',
            account_status: user.account_status || 'active',
            picture: user.picture || null,
            work_type: user.work_type || null,
            created_at: user.created_at || now,
            updated_at: user.updated_at || now,
            last_login_at: user.last_login_at || null,
        };
        if (this.usePostgres && this.pgEngine) {
            const sql = `
        INSERT INTO users (id, email, display_name, google_id, password_hash, language, account_status, picture, work_type, created_at, updated_at, last_login_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *;
      `;
            const params = [
                record.id,
                record.email,
                record.display_name,
                record.google_id,
                record.password_hash,
                record.language,
                record.account_status,
                record.picture,
                record.work_type,
                record.created_at,
                record.updated_at,
                record.last_login_at,
            ];
            const rows = await this.pgEngine.query(sql, params);
            return rows[0];
        }
        return this.localEngine.insert(record);
    }
    async updateUser(id, updates) {
        await this.init();
        const now = new Date().toISOString();
        if (this.usePostgres && this.pgEngine) {
            const existing = await this.findUserById(id);
            if (!existing)
                return null;
            const merged = { ...existing, ...updates, updated_at: now };
            const sql = `
        UPDATE users
        SET email = $1, display_name = $2, google_id = $3, password_hash = $4, language = $5, account_status = $6, picture = $7, work_type = $8, updated_at = $9, last_login_at = $10
        WHERE id = $11
        RETURNING *;
      `;
            const params = [
                merged.email.trim().toLowerCase(),
                merged.display_name.trim(),
                merged.google_id,
                merged.password_hash,
                merged.language,
                merged.account_status,
                merged.picture !== undefined ? merged.picture : existing.picture,
                merged.work_type !== undefined ? merged.work_type : existing.work_type,
                now,
                merged.last_login_at,
                id,
            ];
            const rows = await this.pgEngine.query(sql, params);
            return rows[0] || null;
        }
        return this.localEngine.update(id, updates);
    }
    async recordLogin(id) {
        const now = new Date().toISOString();
        return this.updateUser(id, { last_login_at: now });
    }
    async getAllUsers() {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            return this.pgEngine.query('SELECT * FROM users ORDER BY created_at DESC');
        }
        return this.localEngine.getAll();
    }
    async resetDatabase() {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            await this.pgEngine.query('DROP TABLE IF EXISTS users CASCADE;');
            await this.pgEngine.query('DROP TABLE IF EXISTS _schema_migrations CASCADE;');
            await this.runMigrations();
        }
        else {
            await this.localEngine.reset();
            await this.runMigrations();
        }
        logger_1.logger.info('Database reset completed');
    }
    async getAccountMetrics() {
        const users = await this.getAllUsers();
        const today = new Date().toISOString().substring(0, 10);
        const thisMonth = new Date().toISOString().substring(0, 7);
        let activeAccounts = 0;
        let disabledAccounts = 0;
        let createdToday = 0;
        let createdThisMonth = 0;
        let latestLogin = null;
        for (const u of users) {
            if (u.account_status === 'active')
                activeAccounts++;
            if (u.account_status === 'disabled')
                disabledAccounts++;
            if (u.created_at.startsWith(today))
                createdToday++;
            if (u.created_at.startsWith(thisMonth))
                createdThisMonth++;
            if (u.last_login_at) {
                if (!latestLogin || u.last_login_at > latestLogin) {
                    latestLogin = u.last_login_at;
                }
            }
        }
        return {
            totalAccounts: users.length,
            activeAccounts,
            disabledAccounts,
            createdToday,
            createdThisMonth,
            lastLoginRecorded: latestLogin,
        };
    }
    // ── Gmail Connection Operations (CRUD) ─────────────────────────────────────
    async findGmailConnectionByUserId(userId) {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            const rows = await this.pgEngine.query('SELECT * FROM gmail_connections WHERE user_id = $1', [userId]);
            return rows[0] || null;
        }
        return this.localEngine.findGmailConnectionByUserId(userId);
    }
    /**
     * Create or replace the Gmail connection for a user (one per user —
     * connecting again simply overwrites the previous credentials).
     */
    async upsertGmailConnection(params) {
        await this.init();
        const now = new Date().toISOString();
        const existing = await this.findGmailConnectionByUserId(params.userId);
        const record = {
            id: existing?.id || `gmc_${params.userId}`,
            user_id: params.userId,
            google_account_email: params.googleAccountEmail,
            encrypted_refresh_token: params.encryptedRefreshToken,
            encrypted_access_token: params.encryptedAccessToken ?? existing?.encrypted_access_token ?? null,
            token_expiry_ms: params.tokenExpiryMs ?? existing?.token_expiry_ms ?? null,
            scope: params.scope,
            connected_at: existing?.connected_at || now,
            updated_at: now,
        };
        if (this.usePostgres && this.pgEngine) {
            const sql = `
        INSERT INTO gmail_connections (id, user_id, google_account_email, encrypted_refresh_token, encrypted_access_token, token_expiry_ms, scope, connected_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id) DO UPDATE SET
          google_account_email = EXCLUDED.google_account_email,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          token_expiry_ms = EXCLUDED.token_expiry_ms,
          scope = EXCLUDED.scope,
          updated_at = EXCLUDED.updated_at
        RETURNING *;
      `;
            const rows = await this.pgEngine.query(sql, [
                record.id,
                record.user_id,
                record.google_account_email,
                record.encrypted_refresh_token,
                record.encrypted_access_token,
                record.token_expiry_ms,
                record.scope,
                record.connected_at,
                record.updated_at,
            ]);
            return rows[0];
        }
        return this.localEngine.upsertGmailConnection(record);
    }
    /**
     * Update just the access token/expiry after a refresh (called from
     * the Gmail service, keeps the refresh token untouched).
     */
    async updateGmailAccessToken(userId, encryptedAccessToken, tokenExpiryMs) {
        const existing = await this.findGmailConnectionByUserId(userId);
        if (!existing)
            return;
        await this.upsertGmailConnection({
            userId,
            googleAccountEmail: existing.google_account_email,
            encryptedRefreshToken: existing.encrypted_refresh_token,
            encryptedAccessToken,
            tokenExpiryMs,
            scope: existing.scope,
        });
    }
    async deleteGmailConnection(userId) {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            const rows = await this.pgEngine.query('DELETE FROM gmail_connections WHERE user_id = $1 RETURNING id', [userId]);
            return rows.length > 0;
        }
        return this.localEngine.deleteGmailConnectionByUserId(userId);
    }
    // ── Gmail Processed Messages Operations ───────────────────────────────────
    async getProcessedMessageIds(userId, candidateIds) {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            let rows;
            if (candidateIds && candidateIds.length > 0) {
                rows = await this.pgEngine.query('SELECT gmail_message_id FROM gmail_processed_messages WHERE user_id = $1 AND gmail_message_id = ANY($2)', [userId, candidateIds]);
            }
            else {
                rows = await this.pgEngine.query('SELECT gmail_message_id FROM gmail_processed_messages WHERE user_id = $1', [userId]);
            }
            return new Set(rows.map((r) => r.gmail_message_id));
        }
        return this.localEngine.getProcessedMessageIds(userId, candidateIds);
    }
    async recordProcessedMessages(records) {
        if (!records.length)
            return;
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            for (const r of records) {
                const sql = `
          INSERT INTO gmail_processed_messages (id, user_id, gmail_message_id, processed_at, status, transaction_id)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
            status = EXCLUDED.status,
            processed_at = EXCLUDED.processed_at,
            transaction_id = EXCLUDED.transaction_id;
        `;
                await this.pgEngine.query(sql, [r.id, r.user_id, r.gmail_message_id, r.processed_at, r.status, r.transaction_id]);
            }
            return;
        }
        return this.localEngine.recordProcessedMessages(records);
    }
    // ── Gmail Sync State Operations ───────────────────────────────────────────
    async getGmailSyncState(userId) {
        await this.init();
        if (this.usePostgres && this.pgEngine) {
            const rows = await this.pgEngine.query('SELECT * FROM gmail_sync_states WHERE user_id = $1', [userId]);
            return rows[0] || null;
        }
        return this.localEngine.getGmailSyncState(userId);
    }
    async upsertGmailSyncState(state) {
        await this.init();
        const now = new Date().toISOString();
        if (this.usePostgres && this.pgEngine) {
            const existing = await this.getGmailSyncState(state.user_id);
            const record = await this.localEngine.upsertGmailSyncState(state);
            const sql = `
        INSERT INTO gmail_sync_states (
          user_id, last_sync_started_at, last_sync_completed_at, last_successful_message_date,
          history_id, messages_found, messages_processed, messages_deferred,
          transactions_found, transactions_inserted, deferred_message_ids, status,
          custom_start_date, custom_end_date, active_preset, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (user_id) DO UPDATE SET
          last_sync_started_at = COALESCE(EXCLUDED.last_sync_started_at, gmail_sync_states.last_sync_started_at),
          last_sync_completed_at = COALESCE(EXCLUDED.last_sync_completed_at, gmail_sync_states.last_sync_completed_at),
          last_successful_message_date = COALESCE(EXCLUDED.last_successful_message_date, gmail_sync_states.last_successful_message_date),
          history_id = COALESCE(EXCLUDED.history_id, gmail_sync_states.history_id),
          messages_found = COALESCE(EXCLUDED.messages_found, gmail_sync_states.messages_found),
          messages_processed = COALESCE(EXCLUDED.messages_processed, gmail_sync_states.messages_processed),
          messages_deferred = COALESCE(EXCLUDED.messages_deferred, gmail_sync_states.messages_deferred),
          transactions_found = COALESCE(EXCLUDED.transactions_found, gmail_sync_states.transactions_found),
          transactions_inserted = COALESCE(EXCLUDED.transactions_inserted, gmail_sync_states.transactions_inserted),
          deferred_message_ids = COALESCE(EXCLUDED.deferred_message_ids, gmail_sync_states.deferred_message_ids),
          status = COALESCE(EXCLUDED.status, gmail_sync_states.status),
          custom_start_date = COALESCE(EXCLUDED.custom_start_date, gmail_sync_states.custom_start_date),
          custom_end_date = COALESCE(EXCLUDED.custom_end_date, gmail_sync_states.custom_end_date),
          active_preset = COALESCE(EXCLUDED.active_preset, gmail_sync_states.active_preset),
          updated_at = EXCLUDED.updated_at
        RETURNING *;
      `;
            const rows = await this.pgEngine.query(sql, [
                record.user_id,
                record.last_sync_started_at,
                record.last_sync_completed_at,
                record.last_successful_message_date,
                record.history_id,
                record.messages_found,
                record.messages_processed,
                record.messages_deferred,
                record.transactions_found,
                record.transactions_inserted,
                record.deferred_message_ids,
                record.status,
                record.custom_start_date ?? null,
                record.custom_end_date ?? null,
                record.active_preset ?? null,
                record.updated_at,
            ]);
            return rows[0];
        }
        return this.localEngine.upsertGmailSyncState(state);
    }
    async close() {
        if (this.pgEngine) {
            await this.pgEngine.close();
        }
        this.initialized = false;
    }
}
exports.db = new DatabaseManager();
//# sourceMappingURL=index.js.map