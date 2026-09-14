/**
 * Rate Limiting Middleware
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config';

/** General API rate limiter */
export const generalRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    code: 'RATE_LIMITED',
    timestamp: new Date().toISOString(),
  },
  skip: () => config.server.isTest,
});

/** Gmail sync rate limiter — stricter to prevent Gmail API abuse */
export const gmailSyncRateLimiter = rateLimit({
  windowMs: config.rateLimit.gmailSyncWindowMs,
  max: config.rateLimit.gmailSyncMax,
  standardHeaders: true,
  legacyHeaders: false,
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
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts',
    code: 'AUTH_RATE_LIMITED',
    timestamp: new Date().toISOString(),
  },
  skip: () => config.server.isTest,
});
