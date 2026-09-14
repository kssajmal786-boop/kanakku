/**
 * Gmail Sync Routes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POST /gmail/sync        → Full or incremental Gmail sync
 * GET  /gmail/sync/status → Check sync availability / last sync info
 *
 * The sync result is returned directly to the client (no persistence).
 * The client is responsible for storing transactions locally (local-first).
 * ─────────────────────────────────────────────────────────────────────────
 */
declare const router: import("express-serve-static-core").Router;
export default router;
