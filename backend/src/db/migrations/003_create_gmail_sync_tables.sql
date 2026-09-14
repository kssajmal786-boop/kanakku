-- ─────────────────────────────────────────────────────────────
-- Kanakku Account Database Migration: 003_create_gmail_sync_tables
-- ─────────────────────────────────────────────────────────────
-- PRIVACY: Stores only Gmail message sync metadata (message IDs and sync status).
-- NEVER stores financial transactions or email bodies.
-- ─────────────────────────────────────────────────────────────

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
