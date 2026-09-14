"use strict";
/**
 * Server entry point
 * ─────────────────────────────────────────────────────────────────────────
 * Validates config, creates the Express app, and starts listening.
 * ─────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const app_1 = require("./app");
const logger_1 = require("./utils/logger");
const config_2 = require("./config");
const db_1 = require("./db");
// Validate all required environment variables before anything else
try {
    (0, config_1.validateConfig)();
}
catch (err) {
    console.error('Configuration error:', err.message);
    process.exit(1);
}
const app = (0, app_1.createApp)();
// Initialize database on startup
db_1.db.init().catch(err => {
    logger_1.logger.error('Failed to initialize database on startup', { error: err.message });
});
const server = app.listen(config_2.config.server.port, '0.0.0.0', () => {
    logger_1.logger.info(`Cashflow backend running`, {
        port: config_2.config.server.port,
        env: config_2.config.server.nodeEnv,
        pid: process.pid,
    });
});
// ── Graceful shutdown ──────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
    logger_1.logger.info(`Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
        logger_1.logger.info('Server closed');
        process.exit(0);
    });
    // Force exit after 10 seconds
    setTimeout(() => {
        logger_1.logger.warn('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection', {
        reason: reason?.message ?? String(reason),
    });
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception — shutting down', { error: err.message });
    process.exit(1);
});
exports.default = server;
//# sourceMappingURL=index.js.map