/**
 * Authentication Routes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POST /auth/google       → Initiate OAuth flow (returns redirect URL)
 * GET  /auth/callback     → OAuth callback (exchanges code, issues tokens)
 * POST /auth/google/quick → Quick Google login (instant DB account & session)
 * POST /auth/email/register → Email/password registration (stored in users table)
 * POST /auth/email/login    → Email/password login (verified against users table)
 * POST /auth/refresh      → Refresh access token
 * POST /auth/logout       → Revoke session (client must discard tokens)
 * GET  /auth/me           → Get current user profile
 *
 * Security:
 *   • Single unified 'users' table in server database
 *   • Passwords securely hashed with bcrypt (10 rounds)
 *   • Password hash and credentials NEVER returned to client
 *   • NO financial transactions or chat logs stored on server
 * ─────────────────────────────────────────────────────────────────────────
 */
declare const router: import("express-serve-static-core").Router;
export default router;
