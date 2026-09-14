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

import crypto from 'crypto';
import { db, UserRecord, AccountMetrics } from '../db';
import { logger } from '../utils/logger';

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

function toStoredUser(record: UserRecord): StoredUser {
  return {
    userId: record.id,
    email: record.email,
    name: record.display_name,
    passwordHash: record.password_hash,
    googleId: record.google_id,
    language: record.language || 'en',
    accountStatus: record.account_status || 'active',
    picture: record.picture || null,
    workType: record.work_type || null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    lastLoginAt: record.last_login_at,
  };
}

export async function findUserById(id: string): Promise<StoredUser | null> {
  const record = await db.findUserById(id);
  return record ? toStoredUser(record) : null;
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const record = await db.findUserByEmail(email);
  return record ? toStoredUser(record) : null;
}

export async function findUserByGoogleId(googleId: string): Promise<StoredUser | null> {
  const record = await db.findUserByGoogleId(googleId);
  return record ? toStoredUser(record) : null;
}

export async function createUser(params: {
  email: string;
  name: string;
  passwordHash?: string | null;
  googleId?: string | null;
  language?: string;
}): Promise<StoredUser> {
  const normalizedEmail = params.email.trim().toLowerCase();

  const existingEmail = await db.findUserByEmail(normalizedEmail);
  if (existingEmail) {
    throw new Error('EMAIL_ALREADY_REGISTERED');
  }

  if (params.googleId) {
    const existingGoogle = await db.findUserByGoogleId(params.googleId);
    if (existingGoogle) {
      throw new Error('GOOGLE_ACCOUNT_ALREADY_REGISTERED');
    }
  }

  const prefix = params.googleId ? 'usr_g_' : 'usr_e_';
  const seed = params.googleId ? params.googleId : normalizedEmail;
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
  const id = `${prefix}${hash}`;
  const now = new Date().toISOString();

  const record = await db.createUser({
    id,
    email: normalizedEmail,
    display_name: params.name.trim() || normalizedEmail.split('@')[0],
    google_id: params.googleId || null,
    password_hash: params.passwordHash || null,
    language: params.language || 'en',
    account_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  });

  logger.info('Created new user account in database', { userId: record.id, email: record.email, isGoogle: !!record.google_id });
  return toStoredUser(record);
}

/**
 * Finds or creates a user account after successful Google authentication.
 * If user already exists by Google ID or by verified Email, updates last_login_at
 * and links google_id if it was an email-created account.
 */
export async function findOrCreateGoogleUser(params: {
  googleId: string;
  email: string;
  name: string;
  language?: string;
}): Promise<StoredUser> {
  const normalizedEmail = params.email.trim().toLowerCase();

  // 1. Check if user already exists by Google ID
  let record = await db.findUserByGoogleId(params.googleId);
  if (record) {
    const updated = await db.recordLogin(record.id);
    return toStoredUser(updated || record);
  }

  // 2. Check if user already exists by Email (Account Linking)
  record = await db.findUserByEmail(normalizedEmail);
  if (record) {
    logger.info('Linking Google account to existing user by verified email', { userId: record.id, email: normalizedEmail });
    const updated = await db.updateUser(record.id, {
      google_id: params.googleId,
      display_name: record.display_name || params.name,
      last_login_at: new Date().toISOString(),
    });
    return toStoredUser(updated || record);
  }

  // 3. User does not exist, create new user
  return createUser({
    email: normalizedEmail,
    name: params.name,
    googleId: params.googleId,
    language: params.language || 'en',
  });
}

export async function recordUserLogin(userId: string): Promise<StoredUser | null> {
  const updated = await db.recordLogin(userId);
  return updated ? toStoredUser(updated) : null;
}

export async function updateUserProfile(
  userId: string,
  updates: {
    display_name?: string;
    language?: string;
    account_status?: 'active' | 'disabled' | 'deleted';
    picture?: string | null;
    work_type?: string | null;
  }
): Promise<StoredUser | null> {
  const updated = await db.updateUser(userId, updates);
  return updated ? toStoredUser(updated) : null;
}

export async function linkPasswordToAccount(userId: string, passwordHash: string): Promise<StoredUser | null> {
  const updated = await db.updateUser(userId, { password_hash: passwordHash });
  return updated ? toStoredUser(updated) : null;
}

export async function getAccountMetrics(): Promise<AccountMetrics> {
  return db.getAccountMetrics();
}
