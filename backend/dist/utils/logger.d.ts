/**
 * Winston logger
 * ─────────────────────────────────────────────────────────────────────────
 * Privacy rules enforced here:
 *  • Never log transaction amounts, account numbers, card numbers,
 *    Gmail body contents, or any personal financial information.
 *  • Amount/balance/account fields are scrubbed from log metadata.
 * ─────────────────────────────────────────────────────────────────────────
 */
import winston from 'winston';
/** Recursively redact sensitive fields from an object */
declare function redact(obj: unknown, depth?: number): unknown;
export declare const logger: winston.Logger;
export { redact };
