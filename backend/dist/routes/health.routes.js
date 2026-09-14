"use strict";
/**
 * Health Check Route
 * GET /health
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
router.get('/', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'cashflow-backend',
        version: '1.0.0',
        environment: config_1.config.server.nodeEnv,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
    });
});
exports.default = router;
//# sourceMappingURL=health.routes.js.map