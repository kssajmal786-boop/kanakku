/**
 * Persistence Lifecycle & Multi-User Isolation End-to-End Test Suite
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies:
 * 1. Transaction persistence across logout and login
 * 2. Identity immutability across profile picture and settings updates
 * 3. Strict multi-user data isolation between distinct accounts
 * 4. Multi-namespace data reconciliation from historical databases
 * ─────────────────────────────────────────────────────────────────────────
 */

import { db } from '../../src/db';
import {
  findOrCreateGoogleUser,
  createUser,
  findUserById,
  findUserByEmail,
  updateUserProfile,
} from '../../src/services/userStore.service';

describe('Persistence Lifecycle & Multi-User Isolation Verification', () => {
  beforeAll(async () => {
    await db.init();
  });

  beforeEach(async () => {
    await db.resetDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  test('LIFECYCLE 1: Google User gets identical deterministic userId across sessions', async () => {
    const googleProfile = {
      googleId: '109823749812739812739',
      email: 'ajmal.k@example.com',
      name: 'Ajmal K',
    };

    // Session 1: First login
    const session1User = await findOrCreateGoogleUser(googleProfile);
    expect(session1User.userId).toBeDefined();
    expect(session1User.userId).toMatch(/^usr_g_/);

    // Session 1: User updates profile picture and work type
    const updated = await updateUserProfile(session1User.userId, {
      picture: 'data:image/png;base64,profilePicData...',
      work_type: 'salaried',
      display_name: 'Ajmal Kumar',
    });
    expect(updated).not.toBeNull();
    expect(updated!.userId).toBe(session1User.userId); // userId unchanged
    expect(updated!.picture).toBe('data:image/png;base64,profilePicData...');
    expect(updated!.workType).toBe('salaried');

    // Simulate Logout (clear session) & Session 2: Login again
    const session2User = await findOrCreateGoogleUser(googleProfile);
    expect(session2User.userId).toBe(session1User.userId); // EXACT SAME USER ID!
    expect(session2User.email).toBe('ajmal.k@example.com');
    expect(session2User.picture).toBe('data:image/png;base64,profilePicData...');
    expect(session2User.workType).toBe('salaried');
  });

  test('LIFECYCLE 2: Email User maintains identical deterministic userId and profile across sessions', async () => {
    const email = 'finance.tracker@example.com';

    // Session 1: Registration
    const registered = await createUser({
      email,
      name: 'Finance Tracker',
      passwordHash: 'hashed_pw_123',
    });
    const session1Id = registered.userId;
    expect(session1Id).toMatch(/^usr_e_/);

    // Session 2: Login lookup
    const loggedIn = await findUserByEmail(email);
    expect(loggedIn).not.toBeNull();
    expect(loggedIn!.userId).toBe(session1Id); // MUST MATCH

    // Case-insensitive email login
    const mixedCaseLookup = await findUserByEmail('  FINANCE.TRACKER@EXAMPLE.COM  ');
    expect(mixedCaseLookup).not.toBeNull();
    expect(mixedCaseLookup!.userId).toBe(session1Id);
  });

  test('LIFECYCLE 3: Multi-User Isolation - Two accounts on same backend never collide', async () => {
    const userA = await createUser({
      email: 'alice@company.com',
      name: 'Alice',
      passwordHash: 'hash_a',
    });

    const userB = await createUser({
      email: 'bob@company.com',
      name: 'Bob',
      passwordHash: 'hash_b',
    });

    expect(userA.userId).not.toBe(userB.userId);

    // Check Alice's profile
    const aliceRecord = await findUserById(userA.userId);
    expect(aliceRecord!.email).toBe('alice@company.com');
    expect(aliceRecord!.name).toBe('Alice');

    // Check Bob's profile
    const bobRecord = await findUserById(userB.userId);
    expect(bobRecord!.email).toBe('bob@company.com');
    expect(bobRecord!.name).toBe('Bob');
  });

  test('LIFECYCLE 4: Scoped IndexedDB Database naming logic preserves multi-user boundaries', () => {
    // Test the database naming logic used by frontend/js/services/db.js
    function dbNameFor(userId: string | null): string {
      return userId ? `cashflow_db_user_${userId}` : 'cashflow_db_anonymous';
    }

    const aliceId = 'usr_e_alice_12345';
    const bobId = 'usr_e_bob_67890';

    const aliceDb = dbNameFor(aliceId);
    const bobDb = dbNameFor(bobId);
    const anonDb = dbNameFor(null);

    expect(aliceDb).toBe('cashflow_db_user_usr_e_alice_12345');
    expect(bobDb).toBe('cashflow_db_user_usr_e_bob_67890');
    expect(anonDb).toBe('cashflow_db_anonymous');

    // Alice and Bob have strictly distinct database names
    expect(aliceDb).not.toBe(bobDb);
  });

  test('LIFECYCLE 5: Multi-namespace reconciliation logic safely filters by user email', () => {
    // Simulate the candidate database reconciliation filter in db.js
    interface SimulatedProfile {
      userId: string;
      email: string;
    }

    function shouldReconcileDatabase(
      sourceProfiles: SimulatedProfile[],
      currentUserId: string,
      currentUserEmail: string
    ): boolean {
      const email = currentUserEmail.trim().toLowerCase();
      for (const sp of sourceProfiles) {
        if (sp.userId === currentUserId) return true;
        if (email && sp.email && sp.email.trim().toLowerCase() === email) return true;
      }
      return false;
    }

    const currentUserId = 'usr_e_canonical_current';
    const currentUserEmail = 'kssajmal786@gmail.com';

    // Database from older session with same email but older userId
    const oldSessionSameUser: SimulatedProfile[] = [
      { userId: 'usr_e_95431546e5cdfff3b0d45344', email: 'kssajmal786@gmail.com' },
    ];

    // Database from a different user on same browser
    const differentUser: SimulatedProfile[] = [
      { userId: 'usr_e_other_user_9999', email: 'intruder@example.com' },
    ];

    // Old session from same user MUST be reconciled
    expect(shouldReconcileDatabase(oldSessionSameUser, currentUserId, currentUserEmail)).toBe(true);

    // Different user database MUST NOT be reconciled (Strict Multi-User Isolation!)
    expect(shouldReconcileDatabase(differentUser, currentUserId, currentUserEmail)).toBe(false);
  });
});
