/**
 * Rate Limiting Middleware
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config';

const serverlessSafe = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: true,
  legacyHeaders: false,
  // Vercel sets X-Forwarded-For. Skip the v7 validation crash.
  validate: {
    xForwardedForHeader: false,
    default: true,
  },
} as const;

/** General API rate limiter */
export const generalRateLimiter = rateLimit({
  ...serverlessSafe,
  max: config.rateLimit.max,
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    code: 'RATE_LIMITED',
    timestamp: new Date().toISOString(),
  },
  skip: (req) =>
    config.server.isTest || req.path === '/health' || req.path === '/api/health',
});

/** Gmail sync rate limiter — stricter to prevent Gmail API abuse */
export const gmailSyncRateLimiter = rateLimit({
  ...serverlessSafe,
  windowMs: config.rateLimit.gmailSyncWindowMs,
  max: config.rateLimit.gmailSyncMax,
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? 'unknown',
  message: {
    success: false,
    error: 'Gmail sync rate limit exceeded. Please wait before syncing again.',
    code: 'SYNC_RATE_LIMITED',
    timestamp: new Date().toISOString(),
  },
  skip: () => config.server.isTest,
});

/** Auth endpoint rate limiter */
export const authRateLimiter = rateLimit({
  ...serverlessSafe,
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: 'Too many authentication attempts',
    code: 'AUTH_RATE_LIMITED',
    timestamp: new Date().toISOString(),
  },
  skip: () => config.server.isTest,
});
