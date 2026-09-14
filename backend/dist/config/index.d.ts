/**
 * Central configuration loader
 * ─────────────────────────────────────────────────────────────────────────
 * Reads environment variables and provides typed, validated config.
 * Throws on startup if required variables are missing.
 * ─────────────────────────────────────────────────────────────────────────
 */
export declare const config: {
    readonly server: {
        readonly port: number;
        readonly nodeEnv: string;
        readonly isDevelopment: boolean;
        readonly isProduction: boolean;
        readonly isTest: boolean;
        readonly allowedOrigins: string[];
        readonly trustProxy: number;
    };
    readonly google: {
        readonly clientId: string;
        readonly clientSecret: string;
        readonly redirectUri: string;
        readonly isConfigured: boolean;
        readonly scopes: string[];
    };
    readonly jwt: {
        readonly secret: string;
        readonly expiresIn: string;
        readonly refreshSecret: string;
        readonly refreshExpiresIn: string;
    };
    readonly cookie: {
        readonly secret: string;
        readonly domain: string;
        readonly secure: boolean;
        readonly sameSite: "lax";
        readonly httpOnly: true;
        readonly maxAgeMs: number;
    };
    readonly rateLimit: {
        readonly windowMs: number;
        readonly max: number;
        readonly gmailSyncWindowMs: number;
        readonly gmailSyncMax: number;
        readonly aiWindowMs: number;
        readonly aiMax: number;
    };
    readonly gmail: {
        readonly maxEmailsPerSync: number;
        readonly maxMessageFetches: number;
        readonly fetchConcurrency: number;
        readonly fetchDelayMs: number;
        readonly retryLimit: number;
        readonly initialLookbackDays: number;
    };
    readonly gemini: {
        readonly apiKey: string;
        readonly model: string;
        readonly isAvailable: boolean;
    };
    readonly database: {
        readonly url: string;
    };
    readonly logging: {
        readonly level: string;
    };
    readonly security: {
        readonly enableCsp: boolean;
    };
};
export type AppConfig = typeof config;
export declare function validateConfig(): void;
