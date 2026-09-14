/**
 * Vercel Serverless Function Entry Point for CashFlow
 * ─────────────────────────────────────────────────────────────────────────
 * Exports Express app directly for Vercel's Node.js runtime.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createApp } from '../backend/src/app';
import { db } from '../backend/src/db';
import { logger } from '../backend/src/utils/logger';

const app = createApp();

// Warm up database non-blockingly during cold start
db.init().catch((err) => {
  logger.warn('Database cold-start initialization warning', {
    error: (err as Error).message,
  });
});

export default app;
