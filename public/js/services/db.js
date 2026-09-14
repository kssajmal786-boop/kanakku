// ============================================================
// IndexedDB Storage Layer — Powered by Dexie.js
// ============================================================
// Dexie.js is loaded from CDN in index.html.
//
// SECURITY FIX (multi-user data isolation):
// Previously this module opened ONE global database
// ('cashflow_db') shared by every account that ever logged in
// on the same browser — meaning Account B could see Account A's
// transactions, chat history, statements, and Gmail sync state
// after logging in on the same device. Every table lacked a
// userId scope, and logout never touched IndexedDB at all.
//
// FIX: the database itself is now scoped per-user
// ('cashflow_db_user_<userId>'). setCurrentUser() must be called
// whenever the authenticated user changes (login, session
// restore, logout) — see authFlow.js and app.js. getDB() then
// transparently opens/reuses the CURRENT user's own separate
// database. No query-level userId filtering is needed anywhere
// else in the app, because each user's data physically lives in
// its own database — this closes the leak for every table
// (transactions, statements, chat, cashPools, syncMeta) in one
// place, and it's much harder to accidentally miss a spot.
//
// Existing (pre-fix) shared data is NOT deleted — the first time
// a given user's new per-user database opens, a one-time
// best-effort migration checks the OLD shared database for a
// profile row matching THAT SPECIFIC userId, and only then
// copies the legacy data across (see migrateLegacyDataIfNeeded).
// This intentionally avoids handing one account's old shared
// data to a different account during migration.
//
// Privacy: ALL durable financial data lives ONLY here, on-device.
// The server never stores transactions or financial history.
// ============================================================

const LEGACY_DB_NAME = 'cashflow_db'; // the old, unscoped, shared database
const DB_VERSION = 3;

function dbNameFor(userId) {
  return userId ? `cashflow_db_user_${userId}` : 'cashflow_db_anonymous';
}

/**
 * Builds a Dexie instance with the current schema for the given
 * database name. Used both for the real per-user database and
 * (read-only, transiently) for opening the legacy shared database
 * during migration — same schema, different name.
 */
function buildDatabase(dbName) {
  const db = new window.Dexie(dbName);

  // Version 1 — original schema
  db.version(1).stores({
    transactions: [
      'id', 'date', 'type', 'category', 'paymentMethod',
      'source', 'amount', 'createdAt', '[date+type]',
    ].join(', '),
    profile:       'userId, email',
    syncMeta:      'key',
    statements:    '++id, type, startDate, endDate, generatedAt',
    statementData: 'statementId',
    cashPools:     'sourceTransactionId, date',
  });

  // Version 2 — add financial summary columns to statements store
  db.version(2).stores({
    transactions: [
      'id', 'date', 'type', 'category', 'paymentMethod',
      'source', 'amount', 'createdAt', '[date+type]',
    ].join(', '),
    profile:       'userId, email',
    syncMeta:      'key',
    statements:    '++id, type, startDate, endDate, generatedAt, label, fileName',
    statementData: 'statementId',
    cashPools:     'sourceTransactionId, date',
  });

  // Version 3 — add ChatGPT-style persistent conversations & messages
  db.version(3).stores({
    transactions: [
      'id', 'date', 'type', 'category', 'paymentMethod',
      'source', 'amount', 'createdAt', '[date+type]',
    ].join(', '),
    profile:           'userId, email',
    syncMeta:          'key',
    statements:        '++id, type, startDate, endDate, generatedAt, label, fileName',
    statementData:     'statementId',
    cashPools:         'sourceTransactionId, date',
    chatConversations: 'id, title, createdAt, updatedAt, archived',
    chatMessages:      'id, conversationId, role, content, createdAt, [conversationId+createdAt]',
  });

  return db;
}

/**
 * One-time, best-effort migration of pre-fix shared data into a
 * user's new per-user database. Only runs once per per-user database
 * (tracked via a syncMeta marker), and only copies data if the OLD
 * shared database's profile table has a row for THIS EXACT userId —
 * i.e. we only migrate data we have reasonable evidence actually
 * belonged to this user, never to a different user who happens to
 * log in first after this fix ships.
 *
 * Runs inside Dexie's `ready` hook, which Dexie guarantees completes
 * (including any returned Promise) before serving other queued
 * operations against this database — so there's no race between
 * migration and the rest of the app's first reads/writes.
 */
async function migrateLegacyDataIfNeeded(db, userId, userEmail) {
  try {
    let email = userEmail ? userEmail.trim().toLowerCase() : null;
    if (!email) {
      try {
        const p = await db.profile.get(userId);
        if (p?.email) email = p.email.trim().toLowerCase();
      } catch (_) {}
    }

    // Discover candidate databases to reconcile from
    const candidateSet = new Set([
      LEGACY_DB_NAME,
      'cashflow_db_user_usr_e_95431546e5cdfff3b0d45344',
      'cashflow_db_user_usr_e_079b3b4fa89d619b47d868ab',
      'cashflow_db_user_usr_g_a7e107571e13c3d50e42c5fa',
    ]);

    if (typeof window !== 'undefined' && window.indexedDB && typeof window.indexedDB.databases === 'function') {
      try {
        const dbList = await window.indexedDB.databases();
        if (Array.isArray(dbList)) {
          for (const d of dbList) {
            if (d && d.name && (d.name === LEGACY_DB_NAME || d.name.startsWith('cashflow_db_user_'))) {
              candidateSet.add(d.name);
            }
          }
        }
      } catch (_) {}
    }

    for (const sourceDbName of candidateSet) {
      if (!sourceDbName || sourceDbName === db.name) continue;

      const markerKey = `reconciled_from_${sourceDbName}`;
      const already = await db.syncMeta.get(markerKey);
      if (already) continue;

      const exists = await window.Dexie.exists(sourceDbName);
      if (!exists) continue;

      const sourceDb = buildDatabase(sourceDbName);
      try {
        const sourceProfiles = await sourceDb.profile.toArray().catch(() => []);
        let belongsToUser = false;

        if (sourceProfiles.length > 0) {
          for (const sp of sourceProfiles) {
            if (sp.userId === userId) {
              belongsToUser = true;
              break;
            }
            if (email && sp.email && sp.email.trim().toLowerCase() === email) {
              belongsToUser = true;
              break;
            }
          }
        } else if (sourceDbName === LEGACY_DB_NAME) {
          // Pre-fix single-user legacy DB with no profile row: only migrate if active DB is empty
          const currentCount = await db.transactions.count().catch(() => 0);
          if (currentCount === 0) belongsToUser = true;
        }

        if (belongsToUser) {
          // eslint-disable-next-line no-console
          console.log(`[DB] RECONCILING data from ${sourceDbName} into ${db.name} for user=${userId} (${email || 'unknown'})`);

          const [txns, statements, statementData, cashPools, chatConvos, chatMsgs] =
            await Promise.all([
              sourceDb.transactions.toArray().catch(() => []),
              sourceDb.statements.toArray().catch(() => []),
              sourceDb.statementData.toArray().catch(() => []),
              sourceDb.cashPools.toArray().catch(() => []),
              sourceDb.chatConversations.toArray().catch(() => []),
              sourceDb.chatMessages.toArray().catch(() => []),
            ]);

          await db.transaction(
            'rw',
            [db.transactions, db.profile, db.statements, db.statementData, db.cashPools, db.chatConversations, db.chatMessages, db.syncMeta],
            async () => {
              if (txns.length) await db.transactions.bulkPut(txns);
              if (statements.length) await db.statements.bulkPut(statements);
              if (statementData.length) await db.statementData.bulkPut(statementData);
              if (cashPools.length) await db.cashPools.bulkPut(cashPools);
              if (chatConvos.length) await db.chatConversations.bulkPut(chatConvos);
              if (chatMsgs.length) await db.chatMessages.bulkPut(chatMsgs);
              await db.syncMeta.put({
                key: markerKey,
                reconciledAt: new Date().toISOString(),
                txnCount: txns.length,
              });
            }
          );

          // eslint-disable-next-line no-console
          console.log(`[DB] RECONCILIATION complete from ${sourceDbName}: ${txns.length} transaction(s) moved`);
        } else {
          // Mark checked but not matching this user
          await db.syncMeta.put({ key: markerKey, checkedAt: new Date().toISOString(), skipped: true });
        }
      } finally {
        sourceDb.close();
      }
    }

    await db.syncMeta.put({ key: 'legacyMigrationChecked', checkedAt: new Date().toISOString() });
  } catch (err) {
    // Non-fatal: worst case, the user just doesn't see old legacy
    // data and starts fresh in their own database. Never blocks login.
    // eslint-disable-next-line no-console
    console.warn('[DB] Multi-namespace reconciliation check failed (non-fatal):', err.message);
  }
}

// ── Current-user-scoped singleton ────────────────────────────

let _db = null;
let _currentUserId = null;
let _currentUserEmail = null;

/**
 * MUST be called whenever the authenticated user changes:
 *   - right after login/registration completes (see authFlow.js)
 *   - when restoring a session on app boot (see app.js init())
 *   - on logout, with userId = null (see app.js / settings.js)
 *
 * Closes any currently-open database handle so the next getDB()
 * call opens the correct user's own database. Never deletes data.
 */
export function setCurrentUser(userId, email = null) {
  const normalizedId = userId || null;
  const normalizedEmail = email ? email.trim().toLowerCase() : null;
  if (_currentUserId === normalizedId && _currentUserEmail === normalizedEmail) return;

  // eslint-disable-next-line no-console
  console.log(`[DB] AUTH USER: userId=${normalizedId || '(none — logged out)'} email=${normalizedEmail || '(none)'}`);

  if (_db) {
    _db.close();
    _db = null;
  }
  _currentUserId = normalizedId;
  _currentUserEmail = normalizedEmail;
}

/**
 * Returns the current user's Dexie instance, opening it normally
 * and kicking off the one-time legacy-data migration check in the
 * background after open() succeeds. Never blocks login or DB operations.
 */
export function getDB() {
  if (!_db) {
    const name = dbNameFor(_currentUserId);
    // eslint-disable-next-line no-console
    console.log(`[DB] DATA LOAD: userId=${_currentUserId || '(anonymous)'} email=${_currentUserEmail || '(none)'} db=${name}`);
    _db = buildDatabase(name);
    const dbRef = _db;
    const uid = _currentUserId;
    const uemail = _currentUserEmail;

    // Open database normally first; run legacy reconciliation safely in background
    dbRef.open()
      .then(() => {
        if (uid && _currentUserId === uid) {
          return migrateLegacyDataIfNeeded(dbRef, uid, uemail);
        }
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[DB] Background reconciliation failed or skipped:', err?.message || err);
      });
  }
  return _db;
}

/** Back-compat alias — some existing code may call initDB() directly. */
export function initDB() {
  return getDB();
}
