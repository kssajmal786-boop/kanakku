/**
 * Validation Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * express-validator based request body/query validators for each endpoint.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { Request, Response, NextFunction } from 'express';
/** Run express-validator checks and short-circuit on failure */
export declare function handleValidationErrors(req: Request, res: Response, next: NextFunction): void;
export declare const validateEmailRegister: (import("express-validator").ValidationChain | typeof handleValidationErrors)[];
export declare const validateEmailLogin: (import("express-validator").ValidationChain | typeof handleValidationErrors)[];
export declare const validateGmailSync: (import("express-validator").ValidationChain | typeof handleValidationErrors)[];
export declare const validateManualTransaction: (import("express-validator").ValidationChain | typeof handleValidationErrors)[];
export declare const validateTransactionInput: (import("express-validator").ValidationChain | typeof handleValidationErrors)[];
export declare const validateTokenRefresh: (import("express-validator").ValidationChain | typeof handleValidationErrors)[];
