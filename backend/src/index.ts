/**
 * Server entry point
 * ─────────────────────────────────────────────────────────────────────────
 * Validates config, creates the Express app, and starts listening.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { validateConfig } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { config } from './config';

import { db } from './db';

// Validate all required environment variables before anything else
try {
  validateConfig();
} catch (err) {
  console.error('Configuration error:', (err as Error).message);
  process.exit(1);
}

const app = createApp();

// Initialize database on startup
db.init().catch(err => {
  logger.error('Failed to initialize database on startup', { error: err.message });
});

const server = app.listen(config.server.port, () => {
  logger.info(`Cashflow backend running`, {
    port: config.server.port,
    env: config.server.nodeEnv,
    pid: process.pid,
  });
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: (reason as Error)?.message ?? String(reason),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { error: err.message });
  process.exit(1);
});

export default server;
