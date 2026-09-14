/**
 * Authentication Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies our application JWT on every protected route.
 * Attaches the decoded SessionPayload to req.user.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from 'express';
import { verifySessionJwt } from '../services/auth.service';
import { sendError } from '../utils/response';
import { logger } from '../utils/logger';
import type { SessionPayload } from '../types/auth.types';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Authentication required', 401, 'MISSING_TOKEN');
    return;
  }

  const token = authHeader.slice(7).trim();

  try {
    const payload = verifySessionJwt(token) as SessionPayload;
    req.user = payload;
    next();
  } catch (err: unknown) {
    const message = (err as Error).message ?? 'Invalid token';

    if (message.includes('expired')) {
      sendError(res, 'Access token expired', 401, 'TOKEN_EXPIRED');
    } else {
      logger.warn('Invalid JWT presented', { error: message });
      sendError(res, 'Invalid token', 401, 'INVALID_TOKEN');
    }
  }
}
