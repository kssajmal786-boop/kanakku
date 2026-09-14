"use strict";
/**
 * Authentication Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies our application JWT on every protected route.
 * Attaches the decoded SessionPayload to req.user.
 * ─────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const auth_service_1 = require("../services/auth.service");
const response_1 = require("../utils/response");
const logger_1 = require("../utils/logger");
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        (0, response_1.sendError)(res, 'Authentication required', 401, 'MISSING_TOKEN');
        return;
    }
    const token = authHeader.slice(7).trim();
    try {
        const payload = (0, auth_service_1.verifySessionJwt)(token);
        req.user = payload;
        next();
    }
    catch (err) {
        const message = err.message ?? 'Invalid token';
        if (message.includes('expired')) {
            (0, response_1.sendError)(res, 'Access token expired', 401, 'TOKEN_EXPIRED');
        }
        else {
            logger_1.logger.warn('Invalid JWT presented', { error: message });
            (0, response_1.sendError)(res, 'Invalid token', 401, 'INVALID_TOKEN');
        }
    }
}
//# sourceMappingURL=auth.middleware.js.map