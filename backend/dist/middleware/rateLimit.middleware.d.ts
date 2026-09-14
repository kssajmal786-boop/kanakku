/**
 * Rate Limiting Middleware
 */
/** General API rate limiter */
export declare const generalRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/** Gmail sync rate limiter — stricter to prevent Gmail API abuse */
export declare const gmailSyncRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/** Auth endpoint rate limiter */
export declare const authRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
