-- ─────────────────────────────────────────────────────────────
-- Kanakku Account Database Migration: 001_create_users_table
-- ─────────────────────────────────────────────────────────────
-- STRICT PRIVACY: Stores only user account identity & auth metadata.
-- NO financial transactions, bank data, receipts, or chat logs.
-- ─────────────────────────────────────────────────────────────

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
