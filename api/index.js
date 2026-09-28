/**
 * Vercel Serverless Function Entry Point for Kanakku / CashFlow
 * Only API traffic is routed here. The PWA is served as static files.
 */

let app;

try {
  const { createApp } = require('../backend/dist/app');
  app = createApp();
} catch (err) {
  console.error('FATAL BACKEND COLD-START ERROR:', err);
  const express = require('express');
  app = express();
  app.all('*', (_req, res) => {
    res.status(500).json({
      success: false,
      error: 'Backend failed to initialize on startup',
      message: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : 'COLD_START',
    });
  });
}

module.exports = app;
