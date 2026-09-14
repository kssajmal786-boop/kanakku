/**
 * Authentication Middleware
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies our application JWT on every protected route.
 * Attaches the decoded SessionPayload to req.user.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { Request, Response, NextFunction } from 'express';
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
