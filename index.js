/**
 * Root Vercel Entry Point for CashFlow
 * ─────────────────────────────────────────────────────────────────────────
 * Direct static require with Express error fallback ensuring module.exports
 * is ALWAYS a valid Express instance with .handle, preventing 500 crashes.
 * ─────────────────────────────────────────────────────────────────────────
 */

let app;

try {
  // Static string literal required for @vercel/nft static analysis
  const { createApp } = require('./backend/dist/app');
  app = createApp();
} catch (err) {
  console.error('FATAL ROOT COLD-START ERROR:', err);
  const express = require('express');
  app = express();
  app.all('*', (_req, res) => {
    res.status(500).json({
      success: false,
      error: 'Backend failed to initialize on root startup',
      message: err.message,
      stack: err.stack,
      code: err.code,
    });
  });
}

module.exports = app;
