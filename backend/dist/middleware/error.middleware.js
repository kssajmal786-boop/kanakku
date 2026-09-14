"use strict";
/**
 * Error Handling Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * Catches all unhandled errors from route handlers.
 * Ensures no sensitive data ever leaks in error responses.
 * ─────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
exports.createError = createError;
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
// Sensitive keywords that must never appear in error responses
const SENSITIVE_PATTERNS = [
    /access_token/i,
    /refresh_token/i,
    /id_token/i,
    /account.?number/i,
    /card.?number/i,
];
function sanitiseErrorMessage(message) {
    let cleaned = message;
    for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(cleaned)) {
            return 'An internal error occurred';
        }
    }
    return cleaned.substring(0, 200);
}
function errorHandler(err, req, res, _next) {
    const statusCode = err.statusCode ?? 500;
    const isOperational = err.isOperational ?? false;
    // Log with request context (never log financial data)
    logger_1.logger.error('Request error', {
        method: req.method,
        path: req.path,
        statusCode,
        error: err.message,
        code: err.code,
        isOperational,
        stack: config_1.config.server.isDevelopment ? err.stack : undefined,
    });
    const message = isOperational
        ? sanitiseErrorMessage(err.message)
        : 'An unexpected error occurred';
    res.status(statusCode).json({
        success: false,
        error: message,
        code: err.code ?? 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
        ...(config_1.config.server.isDevelopment && {
            devStack: err.stack,
        }),
    });
}
function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: `Route not found: ${req.method} ${req.path}`,
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
    });
}
/** Create an operational error (safe to expose message to client) */
function createError(message, statusCode, code) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    err.isOperational = true;
    return err;
}
//# sourceMappingURL=error.middleware.js.map