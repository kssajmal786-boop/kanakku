/**
 * Server entry point
 * ─────────────────────────────────────────────────────────────────────────
 * Validates config, creates the Express app, and starts listening.
 * ─────────────────────────────────────────────────────────────────────────
 */
declare const server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
export default server;
