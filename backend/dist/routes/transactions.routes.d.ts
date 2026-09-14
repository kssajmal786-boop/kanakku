/**
 * Transaction Routes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POST /transactions/validate    → Validate a batch of transactions
 * POST /transactions/normalize   → Normalize + validate a batch
 * POST /transactions/deduplicate → Run deduplication check
 * POST /transactions/manual      → Build a manual transaction (no storage)
 * GET  /transactions/schema      → Return the canonical schema definition
 * GET  /transactions/categories  → Return available categories
 * GET  /transactions/methods     → Return available payment methods
 *
 * IMPORTANT: This backend does NOT store transactions.
 * These endpoints process transaction data on-the-fly and return the result.
 * All durable storage is the client's responsibility (local-first).
 * ─────────────────────────────────────────────────────────────────────────
 */
declare const router: import("express-serve-static-core").Router;
export default router;
