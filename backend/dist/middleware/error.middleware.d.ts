/**
 * Error Handling Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * Catches all unhandled errors from route handlers.
 * Ensures no sensitive data ever leaks in error responses.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { Request, Response, NextFunction } from 'express';
export interface AppError extends Error {
    statusCode?: number;
    code?: string;
    isOperational?: boolean;
}
export declare function errorHandler(err: AppError, req: Request, res: Response, _next: NextFunction): void;
export declare function notFoundHandler(req: Request, res: Response): void;
/** Create an operational error (safe to expose message to client) */
export declare function createError(message: string, statusCode: number, code?: string): AppError;
