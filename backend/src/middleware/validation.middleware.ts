/**
 * Validation Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * express-validator based request body/query validators for each endpoint.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { sendValidationError } from '../utils/response';

/** Run express-validator checks and short-circuit on failure */
export function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({
      field: e.type === 'field' ? (e as { path: string }).path : 'unknown',
      message: e.msg,
    }));
    sendValidationError(res, formatted);
    return;
  }
  next();
}

// ─── Email/password auth validators ───────────────────────────────────────────

export const validateEmailRegister = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name is required')
    .matches(/^[a-zA-Z\u0B80-\u0BFF\s'-]+$/)
    .withMessage('Name can only contain letters'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email is required')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be at least 8 characters'),
  handleValidationErrors,
];

export const validateEmailLogin = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email is required')
    .normalizeEmail(),
  body('password')
    .isString()
    .isLength({ min: 1, max: 128 })
    .withMessage('Password is required'),
  handleValidationErrors,
];

// NOTE: /gmail/sync is a POST endpoint — validate request body, not query params.

export const validateGmailSync = [
  body('since')
    .optional()
    .isISO8601()
    .withMessage('since must be an ISO 8601 date string'),
  body('maxResults')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('maxResults must be between 1 and 500'),
  body('historyId')
    .optional()
    .isString()
    .withMessage('historyId must be a string'),
  body('existingTransactions')
    .optional()
    .isArray({ max: 5000 })
    .withMessage('existingTransactions must be an array (max 5000 items)'),
  handleValidationErrors,
];

// ─── Manual transaction validators ────────────────────────────────────────────

export const validateManualTransaction = [
  body('date')
    .notEmpty()
    .isISO8601()
    .withMessage('date must be a valid ISO 8601 date'),
  body('amount')
    .notEmpty()
    .isInt({ min: 1 })
    .withMessage('amount must be a positive integer (paise)'),
  body('type')
    .notEmpty()
    .isIn(['income', 'expense', 'transfer'])
    .withMessage('type must be income, expense, or transfer'),
  body('category')
    .notEmpty()
    .isString()
    .withMessage('category is required'),
  body('paymentMethod')
    .notEmpty()
    .isIn(['upi', 'card', 'cash', 'bank', 'atm', 'netbanking', 'unknown'])
    .withMessage('paymentMethod must be a valid payment method'),
  body('description')
    .notEmpty()
    .isString()
    .isLength({ min: 1, max: 500 })
    .withMessage('description is required (max 500 chars)'),
  body('merchant')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('merchant must be a string (max 100 chars)'),
  body('reference')
    .optional()
    .isString()
    .isLength({ max: 50 })
    .withMessage('reference must be a string (max 50 chars)'),
  body('currency')
    .optional()
    .isLength({ min: 3, max: 3 })
    .isAlpha()
    .withMessage('currency must be 3-letter ISO code'),
  handleValidationErrors,
];

// ─── Transaction validate endpoint validators ─────────────────────────────────

export const validateTransactionInput = [
  body('transactions')
    .isArray({ min: 1, max: 500 })
    .withMessage('transactions must be a non-empty array (max 500)'),
  handleValidationErrors,
];

// ─── Token refresh validators ─────────────────────────────────────────────────

export const validateTokenRefresh = [
  body('refreshToken')
    .notEmpty()
    .isString()
    .withMessage('refreshToken is required'),
  handleValidationErrors,
];
