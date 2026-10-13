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
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
function createApp() {
    const app = (0, express_1.default)();
    // Vercel / proxies set X-Forwarded-For. Required so express-rate-limit
    // does not throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request.
    app.set('trust proxy', isServerless ? 1 : config_1.config.server.trustProxy);
    app.disable('x-powered-by');
    // ── Security headers (hidePoweredBy: false prevents removeHeader crash) ─
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        hidePoweredBy: false,
    }));
    // ── Lightweight Health Check (Bypasses heavier middleware) ───────────────
    const healthHandler = (_req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'kanakku-backend',
            version: '1.0.0',
            environment: config_1.config.server.nodeEnv,
            timestamp: new Date().toISOString(),
            serverless: isServerless,
        });
    };
    app.get('/health', healthHandler);
    app.get('/api/health', healthHandler);
    // ── CORS ───────────────────────────────────────────────────────────────
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            if (!origin || config_1.config.server.isDevelopment) {
                return callback(null, true);
            }
            if (config_1.config.server.allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            if (/^https:\/\/[a-zA-Z0-9-_.]+\.vercel\.app$/.test(origin)) {
                return callback(null, true);
            }
            return callback(null, true);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
        exposedHeaders: ['X-Request-ID'],
        maxAge: 86400,
    }));
    app.use((0, compression_1.default)());
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '2mb' }));
    app.use((0, cookie_parser_1.default)(config_1.config.cookie.secret));
    app.use((req, _res, next) => {
        req.requestId = req.headers['x-request-id'] ?? crypto_1.default.randomUUID();
        next();
    });
    if (!config_1.config.server.isTest) {
        app.use((0, morgan_1.default)('combined', {
            stream: {
                write: (msg) => logger_1.logger.http(msg.trim()),
            },
            skip: (req) => req.path === '/health' || req.path === '/api/health',
        }));
    }
    app.use(rateLimit_middleware_1.generalRateLimiter);
    // Dual-mounted at / and /api for Vercel rewrites
    const apiRouter = express_1.default.Router();
    apiRouter.use('/health', health_routes_1.default);
    apiRouter.use('/auth', auth_routes_1.default);
    apiRouter.use('/gmail', gmail_routes_1.default);
    apiRouter.use('/transactions', transactions_routes_1.default);
    apiRouter.use('/ai', ai_routes_1.default);
    app.use(apiRouter);
    app.use('/api', apiRouter);
    // Static PWA fallback (Vercel also serves /public as CDN assets)
    const publicPath = path_1.default.resolve(process.cwd(), 'public');
    const frontendPath = path_1.default.resolve(__dirname, '../../frontend');
    const staticPath = fs_1.default.existsSync(publicPath)
        ? publicPath
        : fs_1.default.existsSync(frontendPath)
            ? frontendPath
            : null;
    if (!config_1.config.server.isTest && staticPath) {
        app.get(['/privacy', '/privacy/'], (_req, res) => {
            const privacyPath = path_1.default.join(staticPath, 'privacy', 'index.html');
            if (fs_1.default.existsSync(privacyPath)) {
                return res.sendFile(privacyPath);
            }
            const altPath = path_1.default.join(staticPath, 'privacy.html');
            if (fs_1.default.existsSync(altPath))
                return res.sendFile(altPath);
            res.redirect('/');
        });
        app.get(['/terms', '/terms/'], (_req, res) => {
            const termsPath = path_1.default.join(staticPath, 'terms', 'index.html');
            if (fs_1.default.existsSync(termsPath)) {
                return res.sendFile(termsPath);
            }
            const altPath = path_1.default.join(staticPath, 'terms.html');
            if (fs_1.default.existsSync(altPath))
                return res.sendFile(altPath);
            res.redirect('/');
        });
        app.use(express_1.default.static(staticPath));
        // SPA fallback
        app.get('*', (_req, res, next) => {
            if (_req.path.startsWith('/api') ||
                _req.path.startsWith('/auth') ||
                _req.path.startsWith('/gmail') ||
                _req.path.startsWith('/ai')) {
                return next();
            }
            const indexPath = path_1.default.join(staticPath, 'index.html');
            if (fs_1.default.existsSync(indexPath)) {
                res.sendFile(indexPath);
            }
            else {
                res.status(200).send('Kanakku API is live');
            }
        });
    }
    app.use(error_middleware_1.notFoundHandler);
    app.use(error_middleware_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map