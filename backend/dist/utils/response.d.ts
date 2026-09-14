/**
 * Standard API response helpers
 */
import { Response } from 'express';
export declare function sendSuccess<T>(res: Response, data: T, statusCode?: number, message?: string): void;
export declare function sendError(res: Response, message: string, statusCode?: number, code?: string): void;
export declare function sendValidationError(res: Response, errors: Array<{
    field: string;
    message: string;
}>): void;
