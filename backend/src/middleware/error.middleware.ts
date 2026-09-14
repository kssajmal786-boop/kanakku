/**
 * Error Handling Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * Catches all unhandled errors from route handlers.
 * Ensures no sensitive data ever leaks in error responses.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';

// Sensitive keywords that must never appear in error responses
const SENSITIVE_PATTERNS = [
  /access_token/i,
  /refresh_token/i,
  /id_token/i,
  /account.?number/i,
  /card.?number/i,
];

function sanitiseErrorMessage(message: string): string {
  let cleaned = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(cleaned)) {
      return 'An internal error occurred';
    }
  }
  return cleaned.substring(0, 200);
}

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const isOperational = err.isOperational ?? false;

  // Log with request context (never log financial data)
  logger.error('Request error', {
    method: req.method,
    path: req.path,
    statusCode,
    error: err.message,
    code: err.code,
    isOperational,
    stack: config.server.isDevelopment ? err.stack : undefined,
  });

  const message = isOperational
    ? sanitiseErrorMessage(err.message)
    : 'An unexpected error occurred';

  res.status(statusCode).json({
    success: false,
    error: message,
    code: err.code ?? 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    ...(config.server.isDevelopment && {
      devStack: err.stack,
    }),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
    code: 'NOT_FOUND',
    timestamp: new Date().toISOString(),
  });
}

/** Create an operational error (safe to expose message to client) */
export function createError(
  message: string,
  statusCode: number,
  code?: string
): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  err.code = code;
  err.isOperational = true;
  return err;
}
