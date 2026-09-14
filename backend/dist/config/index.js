"use strict";
/**
 * Central configuration loader
 * ─────────────────────────────────────────────────────────────────────────
 * Reads environment variables and provides typed, validated config.
 * Throws on startup if required variables are missing.
 * ─────────────────────────────────────────────────────────────────────────
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.validateConfig = validateConfig;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load .env file
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
function requireEnv(key) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value.trim();
}
function optionalEnv(key, defaultValue) {
    return process.env[key]?.trim() || defaultValue;
}
function optionalEnvInt(key, defaultValue) {
    const value = process.env[key];
    if (!value)
        return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}
function optionalEnvBool(key, defaultValue) {
    const value = process.env[key];
    if (!value)
        return defaultValue;
    return value.toLowerCase() === 'true';
}
const googleClientId = optionalEnv('GOOGLE_CLIENT_ID', '');
const googleClientSecret = optionalEnv('GOOGLE_CLIENT_SECRET', '');
const googleRedirectUri = optionalEnv('GOOGLE_REDIRECT_URI', 'http://localhost:3001/auth/callback');
const isGoogleConfigured = !!(googleClientId &&
    googleClientId !== 'your_google_client_id_here' &&
    googleClientSecret &&
    googleClientSecret !== 'your_google_client_secret_here');
// ─── Config Object ────────────────────────────────────────────────────────────
exports.config = {
    server: {
        port: optionalEnvInt('PORT', 3001),
        nodeEnv: optionalEnv('NODE_ENV', 'development'),
        isDevelopment: optionalEnv('NODE_ENV', 'development') === 'development',
        isProduction: optionalEnv('NODE_ENV', 'development') === 'production',
        isTest: optionalEnv('NODE_ENV', 'development') === 'test',
        allowedOrigins: optionalEnv('ALLOWED_ORIGINS', 'http://localhost:3000')
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean),
        trustProxy: optionalEnvInt('TRUST_PROXY', 0),
    },
    google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri,
        isConfigured: isGoogleConfigured,
        scopes: optionalEnv('GOOGLE_SCOPES', 'openid email profile https://www.googleapis.com/auth/gmail.readonly').split(' ').filter(Boolean),
    },
    jwt: {
        secret: optionalEnv('JWT_SECRET', 'cashflow_jwt_secret_dev_environment_32chars_long_key_12345'),
        expiresIn: optionalEnv('JWT_EXPIRES_IN', '2h'),
        refreshSecret: optionalEnv('JWT_REFRESH_SECRET', 'cashflow_jwt_refresh_secret_dev_environment_32chars_long_key_67890'),
        refreshExpiresIn: optionalEnv('JWT_REFRESH_EXPIRES_IN', '30d'),
    },
    cookie: {
        secret: optionalEnv('COOKIE_SECRET', 'cashflow_cookie_secret_dev_16chars_min'),
        domain: optionalEnv('COOKIE_DOMAIN', ''),
        secure: optionalEnvBool('COOKIE_SECURE', false),
        sameSite: 'lax',
        httpOnly: true,
        maxAgeMs: 10 * 60 * 1000, // 10 minutes for state cookie
    },
    rateLimit: {
        windowMs: optionalEnvInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
        max: optionalEnvInt('RATE_LIMIT_MAX', 100),
        gmailSyncWindowMs: optionalEnvInt('GMAIL_SYNC_RATE_LIMIT_WINDOW_MS', 60 * 1000),
        gmailSyncMax: optionalEnvInt('GMAIL_SYNC_RATE_LIMIT_MAX', 10),
        aiWindowMs: optionalEnvInt('AI_RATE_LIMIT_WINDOW_MS', 60 * 1000),
        aiMax: optionalEnvInt('AI_RATE_LIMIT_MAX', 20),
    },
    gmail: {
        maxEmailsPerSync: optionalEnvInt('GMAIL_MAX_EMAILS_PER_SYNC', 500),
        maxMessageFetches: optionalEnvInt('GMAIL_MAX_MESSAGE_FETCHES', 20),
        fetchConcurrency: optionalEnvInt('GMAIL_FETCH_CONCURRENCY', 2),
        fetchDelayMs: optionalEnvInt('GMAIL_FETCH_DELAY_MS', 150),
        retryLimit: optionalEnvInt('GMAIL_RETRY_LIMIT', 3),
        initialLookbackDays: optionalEnvInt('GMAIL_INITIAL_LOOKBACK_DAYS', 30),
    },
    gemini: {
        get apiKey() { return optionalEnv('GEMINI_API_KEY', ''); },
        get model() { return optionalEnv('GEMINI_MODEL', 'gemini-1.5-flash'); },
        // AI features degrade gracefully when key is absent
        get isAvailable() { return !!(process.env['GEMINI_API_KEY']?.trim()); },
    },
    database: {
        url: optionalEnv('DATABASE_URL', ''),
    },
    logging: {
        level: optionalEnv('LOG_LEVEL', 'info'),
    },
    security: {
        enableCsp: optionalEnvBool('ENABLE_CSP', true),
    },
};
// ─── Validate at startup ──────────────────────────────────────────────────────
function validateConfig() {
    if (exports.config.jwt.secret.length < 32) {
        throw new Error('JWT_SECRET must be at least 32 characters long');
    }
    if (exports.config.jwt.refreshSecret.length < 32) {
        throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long');
    }
    if (exports.config.cookie.secret.length < 16) {
        throw new Error('COOKIE_SECRET must be at least 16 characters long');
    }
}
//# sourceMappingURL=index.js.map