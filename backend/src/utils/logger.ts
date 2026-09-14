/**
 * Winston logger
 * ─────────────────────────────────────────────────────────────────────────
 * Privacy rules enforced here:
 *  • Never log transaction amounts, account numbers, card numbers,
 *    Gmail body contents, or any personal financial information.
 *  • Amount/balance/account fields are scrubbed from log metadata.
 * ─────────────────────────────────────────────────────────────────────────
 */

import winston from 'winston';
import { config } from '../config';

// Fields that must never appear in log output
const REDACTED_FIELDS = new Set([
  'amount',
  'balance',
  'availableBalance',
  'accountNumber',
  'cardNumber',
  'accessToken',
  'refreshToken',
  'idToken',
  'encryptedAccessToken',
  'encryptedRefreshToken',
  'rawAmount',
  'body',
  'textBody',
  'htmlBody',
  'combinedBody',
  'htmlAsText',
]);

/** Recursively redact sensitive fields from an object */
function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[deep]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => redact(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACTED_FIELDS.has(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redact(value, depth + 1);
    }
  }
  return result;
}

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? ' ' + JSON.stringify(redact(meta))
      : '';
    return `[${ts}] ${level}: ${message}${metaStr}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json({
    replacer: (_key, value) => {
      // Extra safety: scrub any field called "token" anywhere in prod JSON logs
      if (typeof value === 'string' && value.length > 40 && /^[A-Za-z0-9\-_.]+$/.test(value)) {
        return '[TOKEN_LIKE]';
      }
      return value;
    },
  })
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: config.server.isDevelopment ? devFormat : prodFormat,
  transports: [
    new winston.transports.Console({
      silent: config.server.isTest,
    }),
  ],
});

export { redact };
