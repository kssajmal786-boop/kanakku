/**
 * Vercel Serverless Function Entry Point for CashFlow
 * ─────────────────────────────────────────────────────────────────────────
 * Wraps the Express application into a serverless handler for Vercel.
 * Normalizes rewritten URLs and initializes database connections.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createApp } from '../backend/src/app';
import { validateConfig } from '../backend/src/config';
import { db } from '../backend/src/db';
import { logger } from '../backend/src/utils/logger';

let appInstance: ReturnType<typeof createApp> | null = null;
let isInitialized = false;

function getApp(): ReturnType<typeof createApp> {
  if (!appInstance) {
    try {
      validateConfig();
    } catch (err) {
      logger.warn('Configuration validation warning in serverless environment', {
        error: (err as Error).message,
      });
    }

    appInstance = createApp();

    // Warm up database connection on container startup
    if (!isInitialized) {
      isInitialized = true;
      db.init().catch((err) => {
        logger.error('Failed to initialize database during cold start', {
          error: (err as Error).message,
        });
      });
    }
  }

  return appInstance;
}

export default async function handler(req: any, res: any) {
  const app = getApp();

  // If Vercel edge rewrite modified the URL, restore original matched path
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-now-route-matches'];
  if (matchedPath && typeof matchedPath === 'string' && matchedPath.startsWith('/')) {
    const queryIndex = req.url.indexOf('?');
    const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
    req.url = matchedPath + queryString;
  }

  return app(req, res);
}
