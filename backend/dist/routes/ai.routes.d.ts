/**
 * Gemini AI Route — KANAKKU Intelligent Assistant & Control Layer
 * ─────────────────────────────────────────────────────────────────────────
 * POST /ai/chat  → Unified conversational AI & action processing engine
 *
 * Privacy & Security Architecture:
 *  • Zero permanent server-side financial storage or chat history
 *  • Gemini serves as a transient intelligence & action planning layer
 *  • Financial calculations (totals, balances, scores) are deterministic
 *  • Untrusted user input safety; never leaks API keys or secrets
 *  • Bilingual (English & Tamil) support
 * ─────────────────────────────────────────────────────────────────────────
 */
declare const router: import("express-serve-static-core").Router;
export default router;
