"use strict";
/**
 * Rate Limiting Middleware
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRateLimiter = exports.gmailSyncRateLimiter = exports.generalRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("../config");
/** General API rate limiter */
exports.generalRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.rateLimit.windowMs,
    max: config_1.config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests, please try again later',
        code: 'RATE_LIMITED',
        timestamp: new Date().toISOString(),
    },
    skip: (req) => config_1.config.server.isTest || req.path === '/health' || req.path === '/api/health',
});
/** Gmail sync rate limiter — stricter to prevent Gmail API abuse */
exports.gmailSyncRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.rateLimit.gmailSyncWindowMs,
    max: config_1.config.rateLimit.gmailSyncMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.userId ?? req.ip ?? 'unknown',
    message: {
        success: false,
        error: 'Gmail sync rate limit exceeded. Please wait before syncing again.',
        code: 'SYNC_RATE_LIMITED',
        timestamp: new Date().toISOString(),
    },
    skip: () => config_1.config.server.isTest,
});
/** Auth endpoint rate limiter */
exports.authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many authentication attempts',
        code: 'AUTH_RATE_LIMITED',
        timestamp: new Date().toISOString(),
    },
    skip: () => config_1.config.server.isTest,
});
//# sourceMappingURL=rateLimit.middleware.js.map