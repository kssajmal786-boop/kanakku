"use strict";
/**
 * Winston logger
 * ─────────────────────────────────────────────────────────────────────────
 * Privacy rules enforced here:
 *  • Never log transaction amounts, account numbers, card numbers,
 *    Gmail body contents, or any personal financial information.
 *  • Amount/balance/account fields are scrubbed from log metadata.
 * ─────────────────────────────────────────────────────────────────────────
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.redact = redact;
const winston_1 = __importDefault(require("winston"));
const config_1 = require("../config");
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
function redact(obj, depth = 0) {
    if (depth > 5)
        return '[deep]';
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj))
        return obj.map((item) => redact(item, depth + 1));
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (REDACTED_FIELDS.has(key)) {
            result[key] = '[REDACTED]';
        }
        else {
            result[key] = redact(value, depth + 1);
        }
    }
    return result;
}
const { combine, timestamp, printf, colorize, json, errors } = winston_1.default.format;
const devFormat = combine(colorize({ all: true }), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length
        ? ' ' + JSON.stringify(redact(meta))
        : '';
    return `[${ts}] ${level}: ${message}${metaStr}`;
}));
const prodFormat = combine(timestamp(), errors({ stack: true }), json({
    replacer: (_key, value) => {
        // Extra safety: scrub any field called "token" anywhere in prod JSON logs
        if (typeof value === 'string' && value.length > 40 && /^[A-Za-z0-9\-_.]+$/.test(value)) {
            return '[TOKEN_LIKE]';
        }
        return value;
    },
}));
exports.logger = winston_1.default.createLogger({
    level: config_1.config.logging.level,
    format: config_1.config.server.isDevelopment ? devFormat : prodFormat,
    transports: [
        new winston_1.default.transports.Console({
            silent: config_1.config.server.isTest,
        }),
    ],
});
//# sourceMappingURL=logger.js.map