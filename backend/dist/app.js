"use strict";
/**
 * Express Application Factory
 * ─────────────────────────────────────────────────────────────────────────
 * Creates and configures the Express app without starting the server.
 * ─────────────────────────────────────────────────────────────────────────
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const morgan_1 = __importDefault(require("morgan"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
const rateLimit_middleware_1 = require("./middleware/rateLimit.middleware");
const error_middleware_1 = require("./middleware/error.middleware");
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const gmail_routes_1 = __importDefault(require("./routes/gmail.routes"));
const transactions_routes_1 = __importDefault(require("./routes/transactions.routes"));
const ai_routes_1 = __importDefault(require("./routes/ai.routes"));
function createApp() {
    const app = (0, express_1.default)();
    // ── URL Normalization for Vercel Serverless Rewrites ────────────────────
    app.use((req, _res, next) => {
        const matchedPath = req.headers['x-matched-path'] || req.headers['x-now-route-matches'];
        if (matchedPath && typeof matchedPath === 'string' && matchedPath.startsWith('/')) {
            const queryIndex = req.url.indexOf('?');
            const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
            req.url = matchedPath + queryString;
        }
        next();
    });
    // ── Lightweight Health Check (Bypasses all heavier middleware) ───────────
    const healthHandler = (_req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'kanakku-backend',
            version: '1.0.0',
            environment: config_1.config.server.nodeEnv,
            timestamp: new Date().toISOString(),
            serverless: !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME),
        });
    };
    app.get('/health', healthHandler);
    app.get('/api/health', healthHandler);
    // ── Trust proxy ────────────────────────────────────────────────────────
    if (config_1.config.server.trustProxy > 0) {
        app.set('trust proxy', config_1.config.server.trustProxy);
    }
    // ── Disable Express x-powered-by header natively ───────────────────────
    app.disable('x-powered-by');
    // ── Security headers (hidePoweredBy: false prevents removeHeader crash in serverless) ─
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: false, // Frontend sets its own CSP
        crossOriginEmbedderPolicy: false,
        hidePoweredBy: false,
    }));
    // ── CORS ───────────────────────────────────────────────────────────────
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            if (!origin || config_1.config.server.isDevelopment) {
                return callback(null, true);
            }
            if (config_1.config.server.allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            // Support Vercel deployment and preview URLs
            if (/^https:\/\/[a-zA-Z0-9-_.]+\.vercel\.app$/.test(origin)) {
                return callback(null, true);
            }
            // Permissive fallback without throwing 500 error
            return callback(null, true);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
        exposedHeaders: ['X-Request-ID'],
        maxAge: 86400,
    }));
    // ── Compression ────────────────────────────────────────────────────────
    app.use((0, compression_1.default)());
    // ── Body parsers ───────────────────────────────────────────────────────
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '2mb' }));
    // ── Cookie parser ──────────────────────────────────────────────────────
    app.use((0, cookie_parser_1.default)(config_1.config.cookie.secret));
    // ── Request ID ─────────────────────────────────────────────────────────
    app.use((req, _res, next) => {
        req.requestId = req.headers['x-request-id'] ?? crypto_1.default.randomUUID();
        next();
    });
    // ── HTTP request logging (no body content logged) ──────────────────────
    if (!config_1.config.server.isTest) {
        app.use((0, morgan_1.default)('combined', {
            stream: {
                write: (msg) => logger_1.logger.http(msg.trim()),
            },
            skip: (req) => req.path === '/health',
        }));
    }
    // ── Global rate limiter ────────────────────────────────────────────────
    app.use(rateLimit_middleware_1.generalRateLimiter);
    // ── API Routes (Dual-mounted at / and /api for serverless compatibility) ─
    const apiRouter = express_1.default.Router();
    apiRouter.use('/health', health_routes_1.default);
    apiRouter.use('/auth', auth_routes_1.default);
    apiRouter.use('/gmail', gmail_routes_1.default);
    apiRouter.use('/transactions', transactions_routes_1.default);
    apiRouter.use('/ai', ai_routes_1.default);
    app.use(apiRouter);
    app.use('/api', apiRouter);
    // ── Serve frontend static files ────────────────────────────────────────
    // In production (Render, Docker, or Vercel), backend serves static PWA as fallback
    const publicPath = path_1.default.resolve(process.cwd(), 'public');
    const frontendPath = path_1.default.resolve(__dirname, '../../frontend');
    const staticPath = fs_1.default.existsSync(publicPath) ? publicPath : (fs_1.default.existsSync(frontendPath) ? frontendPath : null);
    if (staticPath) {
        app.use(express_1.default.static(staticPath));
        // SPA fallback
        app.get('*', (_req, res, next) => {
            // If request looks like an API call that was unhandled, pass to 404 handler
            if (_req.path.startsWith('/api') || _req.path.startsWith('/auth') || _req.path.startsWith('/gmail') || _req.path.startsWith('/ai')) {
                return next();
            }
            const indexPath = path_1.default.join(staticPath, 'index.html');
            if (fs_1.default.existsSync(indexPath)) {
                res.sendFile(indexPath);
            }
            else {
                res.status(200).send('CashFlow API is live');
            }
        });
    }
    // ── 404 handler ────────────────────────────────────────────────────────
    app.use(error_middleware_1.notFoundHandler);
    // ── Global error handler ───────────────────────────────────────────────
    app.use(error_middleware_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map