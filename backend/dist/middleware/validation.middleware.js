"use strict";
/**
 * Validation Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * express-validator based request body/query validators for each endpoint.
 * ─────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTokenRefresh = exports.validateTransactionInput = exports.validateManualTransaction = exports.validateGmailSync = exports.validateEmailLogin = exports.validateEmailRegister = void 0;
exports.handleValidationErrors = handleValidationErrors;
const express_validator_1 = require("express-validator");
const response_1 = require("../utils/response");
/** Run express-validator checks and short-circuit on failure */
function handleValidationErrors(req, res, next) {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        const formatted = errors.array().map((e) => ({
            field: e.type === 'field' ? e.path : 'unknown',
            message: e.msg,
        }));
        (0, response_1.sendValidationError)(res, formatted);
        return;
    }
    next();
}
// ─── Email/password auth validators ───────────────────────────────────────────
exports.validateEmailRegister = [
    (0, express_validator_1.body)('name')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Name is required')
        .matches(/^[a-zA-Z\u0B80-\u0BFF\s'-]+$/)
        .withMessage('Name can only contain letters'),
    (0, express_validator_1.body)('email')
        .trim()
        .isEmail()
        .withMessage('A valid email is required')
        .normalizeEmail(),
    (0, express_validator_1.body)('password')
        .isLength({ min: 8, max: 128 })
        .withMessage('Password must be at least 8 characters'),
    handleValidationErrors,
];
exports.validateEmailLogin = [
    (0, express_validator_1.body)('email')
        .trim()
        .isEmail()
        .withMessage('A valid email is required')
        .normalizeEmail(),
    (0, express_validator_1.body)('password')
        .isString()
        .isLength({ min: 1, max: 128 })
        .withMessage('Password is required'),
    handleValidationErrors,
];
// NOTE: /gmail/sync is a POST endpoint — validate request body, not query params.
exports.validateGmailSync = [
    (0, express_validator_1.body)('since')
        .optional()
        .isISO8601()
        .withMessage('since must be an ISO 8601 date string'),
    (0, express_validator_1.body)('maxResults')
        .optional()
        .isInt({ min: 1, max: 500 })
        .withMessage('maxResults must be between 1 and 500'),
    (0, express_validator_1.body)('historyId')
        .optional()
        .isString()
        .withMessage('historyId must be a string'),
    (0, express_validator_1.body)('existingTransactions')
        .optional()
        .isArray({ max: 5000 })
        .withMessage('existingTransactions must be an array (max 5000 items)'),
    handleValidationErrors,
];
// ─── Manual transaction validators ────────────────────────────────────────────
exports.validateManualTransaction = [
    (0, express_validator_1.body)('date')
        .notEmpty()
        .isISO8601()
        .withMessage('date must be a valid ISO 8601 date'),
    (0, express_validator_1.body)('amount')
        .notEmpty()
        .isInt({ min: 1 })
        .withMessage('amount must be a positive integer (paise)'),
    (0, express_validator_1.body)('type')
        .notEmpty()
        .isIn(['income', 'expense', 'transfer'])
        .withMessage('type must be income, expense, or transfer'),
    (0, express_validator_1.body)('category')
        .notEmpty()
        .isString()
        .withMessage('category is required'),
    (0, express_validator_1.body)('paymentMethod')
        .notEmpty()
        .isIn(['upi', 'card', 'cash', 'bank', 'atm', 'netbanking', 'unknown'])
        .withMessage('paymentMethod must be a valid payment method'),
    (0, express_validator_1.body)('description')
        .notEmpty()
        .isString()
        .isLength({ min: 1, max: 500 })
        .withMessage('description is required (max 500 chars)'),
    (0, express_validator_1.body)('merchant')
        .optional()
        .isString()
        .isLength({ max: 100 })
        .withMessage('merchant must be a string (max 100 chars)'),
    (0, express_validator_1.body)('reference')
        .optional()
        .isString()
        .isLength({ max: 50 })
        .withMessage('reference must be a string (max 50 chars)'),
    (0, express_validator_1.body)('currency')
        .optional()
        .isLength({ min: 3, max: 3 })
        .isAlpha()
        .withMessage('currency must be 3-letter ISO code'),
    handleValidationErrors,
];
// ─── Transaction validate endpoint validators ─────────────────────────────────
exports.validateTransactionInput = [
    (0, express_validator_1.body)('transactions')
        .isArray({ min: 1, max: 500 })
        .withMessage('transactions must be a non-empty array (max 500)'),
    handleValidationErrors,
];
// ─── Token refresh validators ─────────────────────────────────────────────────
exports.validateTokenRefresh = [
    (0, express_validator_1.body)('refreshToken')
        .notEmpty()
        .isString()
        .withMessage('refreshToken is required'),
    handleValidationErrors,
];
//# sourceMappingURL=validation.middleware.js.map