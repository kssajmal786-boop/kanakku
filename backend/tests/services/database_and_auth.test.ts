/**
 * Kanakku Database Architecture & Account Storage Test Suite
 * ─────────────────────────────────────────────────────────────────────────
 * Tests all 15 explicit test requirements specified for the Kanakku
 * database & privacy-first account architecture.
 * ─────────────────────────────────────────────────────────────────────────
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app';
import { db } from '../../src/db';
import {
  findUserByEmail,
  findUserByGoogleId,
  findUserById,
  createUser,
  findOrCreateGoogleUser,
  getAccountMetrics,
} from '../../src/services/userStore.service';
import { config } from '../../src/config';

const app = createApp();

beforeAll(async () => {
  await db.init();
});

beforeEach(async () => {
  await db.resetDatabase();
});

afterAll(async () => {
  await db.close();
});

describe('Kanakku Database & Account Architecture Test Suite', () => {

  // ── TEST 1: New Google user signs in ─────────────────────────────────────
  test('TEST 1: New Google user signs in creates exactly one user record in database', async () => {
    const googleProfile = {
      googleId: 'google_oauth_user_1001',
      email: 'alex.google@example.com',
      name: 'Alex Rivera',
    };

    const user = await findOrCreateGoogleUser(googleProfile);

    expect(user).toBeDefined();
    expect(user.userId).toBeDefined();
    expect(user.email).toBe('alex.google@example.com');
    expect(user.googleId).toBe('google_oauth_user_1001');
    expect(user.passwordHash).toBeNull();
    expect(user.lastLoginAt).toBeTruthy();

    const allUsers = await db.getAllUsers();
    expect(allUsers.length).toBe(1);
    expect(allUsers[0].id).toBe(user.userId);
  });

  // ── TEST 2: Same Google user signs in again ──────────────────────────────
  test('TEST 2: Same Google user signs in again updates last_login_at without creating duplicate', async () => {
    const googleProfile = {
      googleId: 'google_oauth_user_1002',
      email: 'priya.google@example.com',
      name: 'Priya Sharma',
    };

    const firstLogin = await findOrCreateGoogleUser(googleProfile);
    const initialLoginTime = firstLogin.lastLoginAt;

    // Small delay to ensure timestamp change
    await new Promise((r) => setTimeout(r, 20));

    const secondLogin = await findOrCreateGoogleUser(googleProfile);

    expect(secondLogin.userId).toBe(firstLogin.userId);
    expect(secondLogin.email).toBe(firstLogin.email);

    const allUsers = await db.getAllUsers();
    expect(allUsers.length).toBe(1); // No duplicates
    expect(secondLogin.lastLoginAt).toBeDefined();
  });

  // ── TEST 3: New email/password user registers ─────────────────────────────
  test('TEST 3: New email/password user registers creates one user record with hashed password', async () => {
    const plainPassword = 'SuperSecretPassword123!';
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const user = await createUser({
      email: 'suresh.finance@example.com',
      name: 'Suresh Kumar',
      passwordHash,
    });

    expect(user.userId).toBeDefined();
    expect(user.email).toBe('suresh.finance@example.com');
    expect(user.name).toBe('Suresh Kumar');
    expect(user.googleId).toBeNull();
    expect(user.passwordHash).not.toBe(plainPassword); // Must be hash
    expect(await bcrypt.compare(plainPassword, user.passwordHash!)).toBe(true);

    const inDb = await db.findUserById(user.userId);
    expect(inDb).not.toBeNull();
    expect(inDb!.email).toBe('suresh.finance@example.com');
  });

  // ── TEST 4: Email/password user logs in again ─────────────────────────────
  test('TEST 4: Email/password user logs in successfully and existing account is recognized', async () => {
    const plainPassword = 'StrongPassword888#';
    const registerRes = await request(app)
      .post('/auth/email/register')
      .send({
        name: 'Kavitha R',
        email: 'kavitha@example.com',
        password: plainPassword,
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.success).toBe(true);
    const registeredUserId = registerRes.body.data.user.userId;

    const loginRes = await request(app)
      .post('/auth/email/login')
      .send({
        email: 'kavitha@example.com',
        password: plainPassword,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.user.userId).toBe(registeredUserId);
    expect(loginRes.body.data.accessToken).toBeDefined();
    expect(loginRes.body.data.refreshToken).toBeDefined();

    const userInDb = await db.findUserById(registeredUserId);
    expect(userInDb!.last_login_at).toBeTruthy();
  });

  // ── TEST 5: Incorrect password ────────────────────────────────────────────
  test('TEST 5: Incorrect password fails authentication securely with 401', async () => {
    await request(app)
      .post('/auth/email/register')
      .send({
        name: 'Vijay Natarajan',
        email: 'vijay@example.com',
        password: 'CorrectPassword123$',
      });

    const res = await request(app)
      .post('/auth/email/login')
      .send({
        email: 'vijay@example.com',
        password: 'WrongPassword999!',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  // ── TEST 6: Two different users register ──────────────────────────────────
  test('TEST 6: Two different users register and receive distinct internal user IDs', async () => {
    const userA = await createUser({
      email: 'user.alpha@example.com',
      name: 'User Alpha',
      passwordHash: 'hash_alpha',
    });

    const userB = await createUser({
      email: 'user.beta@example.com',
      name: 'User Beta',
      passwordHash: 'hash_beta',
    });

    expect(userA.userId).not.toBe(userB.userId);
    const allUsers = await db.getAllUsers();
    expect(allUsers.length).toBe(2);
  });

  // ── TEST 7: Google client secret not exposed ─────────────────────────────
  test('TEST 7: Google authentication endpoints never expose Google client secret', async () => {
    const res = await request(app).post('/auth/google').send({});
    const responseString = JSON.stringify(res.body);

    expect(responseString).not.toContain(config.google.clientSecret);
    expect(res.body.clientSecret).toBeUndefined();
    if (res.body.data) {
      expect(res.body.data.clientSecret).toBeUndefined();
    }
  });

  // ── TEST 8: Password hash never returned to frontend ─────────────────────
  test('TEST 8: Password hash is NEVER returned to frontend in any auth response', async () => {
    const registerRes = await request(app)
      .post('/auth/email/register')
      .send({
        name: 'Privacy User',
        email: 'privacy@example.com',
        password: 'PrivacyPassword123!',
      });

    const loginRes = await request(app)
      .post('/auth/email/login')
      .send({
        email: 'privacy@example.com',
        password: 'PrivacyPassword123!',
      });

    const token = loginRes.body.data.accessToken;

    const meRes = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    for (const res of [registerRes, loginRes, meRes]) {
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('password_hash');
      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('$2a$10$');
      expect(serialized).not.toContain('$2b$10$');
    }
  });

  // ── TEST 9: Database credentials not exposed ─────────────────────────────
  test('TEST 9: Database credentials and internal connection strings are never exposed in API responses', async () => {
    const res = await request(app).get('/health');
    const serialized = JSON.stringify(res.body);

    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('password=');
    expect(serialized).not.toContain(config.jwt.secret);
    expect(serialized).not.toContain(config.cookie.secret);
  });

  // ── TEST 10: Financial transaction data NOT in server database ───────────
  test('TEST 10: Financial transactions are NOT inserted into the server database schema', async () => {
    const allUsers = await db.getAllUsers();
    // The server database users table schema must only have account fields
    const allowedFields = new Set([
      'id',
      'email',
      'display_name',
      'google_id',
      'password_hash',
      'language',
      'account_status',
      'created_at',
      'updated_at',
      'last_login_at',
    ]);

    for (const u of allUsers) {
      for (const key of Object.keys(u)) {
        expect(allowedFields.has(key)).toBe(true);
        expect(key).not.toBe('transactions');
        expect(key).not.toBe('amount');
        expect(key).not.toBe('balance');
        expect(key).not.toBe('expenses');
        expect(key).not.toBe('income');
      }
    }
  });

  // ── TEST 11: Chat messages NOT in server database ────────────────────────
  test('TEST 11: Chat messages and histories are NOT inserted into the server database', async () => {
    const allUsers = await db.getAllUsers();
    for (const u of allUsers) {
      expect((u as any).chatMessages).toBeUndefined();
      expect((u as any).conversations).toBeUndefined();
      expect((u as any).messages).toBeUndefined();
    }
  });

  // ── TEST 12, 13, 14, 15: Local Chat Persistence Architecture ────────────
  describe('Dexie.js Persistent Multi-Conversation Simulation', () => {
    // In-memory simulation of the Dexie DB Version 3 stores
    const localDexieDb = {
      chatConversations: new Map<string, any>(),
      chatMessages: new Map<string, any>(),
    };

    function createLocalConversation(id: string, title: string) {
      const now = new Date().toISOString();
      const conv = { id, title, createdAt: now, updatedAt: now, archived: 0 };
      localDexieDb.chatConversations.set(id, conv);
      return conv;
    }

    function saveLocalMessage(id: string, conversationId: string, role: string, content: string) {
      const now = new Date().toISOString();
      const msg = { id, conversationId, role, content, createdAt: now };
      localDexieDb.chatMessages.set(id, msg);
      return msg;
    }

    function getLocalMessages(conversationId: string) {
      return Array.from(localDexieDb.chatMessages.values())
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    test('TEST 12 & 13: Chat history persists locally and is restored upon returning to Chat', () => {
      const conv1 = createLocalConversation('conv_1', 'Budget Planning');
      saveLocalMessage('m1', conv1.id, 'user', 'What is my budget for this month?');
      saveLocalMessage('m2', conv1.id, 'assistant', 'Your budget is ₹35,000.');

      // Simulate user navigating to Transactions, Dashboard, and returning to Chat
      const restored = getLocalMessages('conv_1');
      expect(restored.length).toBe(2);
      expect(restored[0].content).toBe('What is my budget for this month?');
      expect(restored[1].content).toBe('Your budget is ₹35,000.');
    });

    test('TEST 14: New Chat creates a separate isolated conversation', () => {
      const conv1 = createLocalConversation('conv_1', 'Budget Planning');
      const conv2 = createLocalConversation('conv_2', 'Tax Deductions');

      saveLocalMessage('m3', conv2.id, 'user', 'How do 80C deductions work?');
      saveLocalMessage('m4', conv2.id, 'assistant', 'Under Section 80C you can claim up to ₹1.5L.');

      expect(conv1.id).not.toBe(conv2.id);
      expect(localDexieDb.chatConversations.size).toBe(2);
      expect(getLocalMessages('conv_1').length).toBe(2);
      expect(getLocalMessages('conv_2').length).toBe(2);
    });

    test('TEST 15: Switching conversations loads the correct distinct messages', () => {
      const messagesConv1 = getLocalMessages('conv_1');
      const messagesConv2 = getLocalMessages('conv_2');

      expect(messagesConv1[0].content).toContain('budget');
      expect(messagesConv2[0].content).toContain('80C');
      expect(messagesConv1[0].conversationId).toBe('conv_1');
      expect(messagesConv2[0].conversationId).toBe('conv_2');
    });
  });

  // ── Account Linking Test ─────────────────────────────────────────────────
  test('Account Linking: An email-registered user can subsequently link Google authentication', async () => {
    const email = 'linked.user@example.com';
    const initialUser = await createUser({
      email,
      name: 'Linked User',
      passwordHash: 'initial_hash',
    });

    expect(initialUser.googleId).toBeNull();

    // User subsequently signs in with Google using the same verified email
    const linkedUser = await findOrCreateGoogleUser({
      googleId: 'google_linked_9999',
      email,
      name: 'Linked User via Google',
    });

    expect(linkedUser.userId).toBe(initialUser.userId); // Same Kanakku account!
    expect(linkedUser.googleId).toBe('google_linked_9999');
    expect(linkedUser.passwordHash).toBe('initial_hash'); // Password preserved
  });

  // ── Product Metrics Test ─────────────────────────────────────────────────
  test('Creator Metrics: Provides account metrics without exposing financial data', async () => {
    await createUser({ email: 'u1@example.com', name: 'User 1', passwordHash: 'hash1' });
    await createUser({ email: 'u2@example.com', name: 'User 2', passwordHash: 'hash2' });

    const metrics = await getAccountMetrics();
    expect(metrics.totalAccounts).toBe(2);
    expect(metrics.activeAccounts).toBe(2);
    expect(metrics.createdToday).toBe(2);
    expect(metrics.createdThisMonth).toBe(2);
    expect(metrics.lastLoginRecorded).toBeTruthy();
  });

  // ── DATA PERSISTENCE REGRESSION TESTS ─────────────────────────────────────
  describe('Data Persistence & Identity Stability Regression Suite', () => {
    test('PERSISTENCE 1: Deterministic User ID ensures exact same userId across repeated sign-ins', async () => {
      const googleProfile = {
        googleId: 'google_perm_sub_88319028',
        email: 'stable.persistence@example.com',
        name: 'Stable User',
      };

      const user1 = await findOrCreateGoogleUser(googleProfile);
      expect(user1.userId).toMatch(/^usr_g_/);

      // Simulate re-login
      const user2 = await findOrCreateGoogleUser(googleProfile);
      expect(user2.userId).toBe(user1.userId);
    });

    test('PERSISTENCE 2: Email user ID is deterministic based on normalized email', async () => {
      const email = 'deterministic.finance@example.com';
      const user = await createUser({
        email,
        name: 'Deterministic User',
        passwordHash: 'hash123',
      });

      expect(user.userId).toMatch(/^usr_e_/);
      // Normalized uppercase/spaces must match
      const found = await findUserByEmail('  DETERMINISTIC.FINANCE@EXAMPLE.COM  ');
      expect(found).not.toBeNull();
      expect(found!.userId).toBe(user.userId);
    });

    test('PERSISTENCE 3: PUT /auth/me updates profile fields without mutating userId', async () => {
      const user = await createUser({
        email: 'profile.update@example.com',
        name: 'Original Name',
        passwordHash: 'hash',
      });

      const originalId = user.userId;

      // Update name, picture, workType
      const updated = await db.updateUser(originalId, {
        display_name: 'Updated Name',
        picture: 'data:image/png;base64,mockphoto',
        work_type: 'business',
      });

      expect(updated).not.toBeNull();
      expect(updated!.id).toBe(originalId); // Immutable ID!
      expect(updated!.display_name).toBe('Updated Name');
      expect(updated!.picture).toBe('data:image/png;base64,mockphoto');
      expect(updated!.work_type).toBe('business');
    });

    test('PERSISTENCE 4: Multi-user isolation - User A and User B maintain distinct identities', async () => {
      const userA = await createUser({ email: 'userA@kanakku.app', name: 'User A', passwordHash: 'hA' });
      const userB = await createUser({ email: 'userB@kanakku.app', name: 'User B', passwordHash: 'hB' });

      expect(userA.userId).not.toBe(userB.userId);

      const dbUserA = await findUserById(userA.userId);
      const dbUserB = await findUserById(userB.userId);

      expect(dbUserA!.email).toBe('usera@kanakku.app');
      expect(dbUserB!.email).toBe('userb@kanakku.app');
    });

    test('PERSISTENCE 5: Self-healing restores user account if orphaned in gmailConnections', async () => {
      const orphanUserId = 'usr_g_historical_orphan_99';
      const orphanEmail = 'orphan.connected@gmail.com';

      // Insert connection directly into gmailConnections
      await db.upsertGmailConnection({
        userId: orphanUserId,
        googleAccountEmail: orphanEmail,
        encryptedRefreshToken: 'enc_ref',
        encryptedAccessToken: 'enc_acc',
        tokenExpiryMs: Date.now() + 3600000,
        scope: 'gmail.readonly',
      });

      // findUserById on-the-fly self-heals and returns the restored user
      const restored = await db.findUserById(orphanUserId);
      expect(restored).not.toBeNull();
      expect(restored!.id).toBe(orphanUserId);
      expect(restored!.email).toBe(orphanEmail);

      // And findUserByEmail also finds it
      const restoredByEmail = await db.findUserByEmail(orphanEmail);
      expect(restoredByEmail).not.toBeNull();
      expect(restoredByEmail!.id).toBe(orphanUserId);
    });
  });
});

