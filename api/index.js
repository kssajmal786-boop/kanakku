/**
 * Vercel Serverless Entry Point
 * ─────────────────────────────────────────────────────────────────────────
 * Robust wrapper for Express application with error containment.
 * ─────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

let app = null;
let initError = null;

try {
  // Try loading compiled app from backend/dist/app
  const appPath = path.resolve(__dirname, '../backend/dist/app');
  const { createApp } = require(appPath);
  app = createApp();
  
  // Non-blocking DB warmup
  try {
    const { db } = require(path.resolve(__dirname, '../backend/dist/db'));
    db.init().catch(() => {});
  } catch (_) {}
} catch (e1) {
  try {
    // Fallback: cwd relative
    const appPath2 = path.resolve(process.cwd(), 'backend/dist/app');
    const { createApp } = require(appPath2);
    app = createApp();
  } catch (e2) {
    initError = {
      primaryError: e1 ? { message: e1.message, stack: e1.stack } : null,
      fallbackError: e2 ? { message: e2.message, stack: e2.stack } : null,
      cwd: process.cwd(),
      dirname: __dirname,
    };
  }
}

module.exports = (req, res) => {
  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Backend initialization failure',
      details: initError,
    }, null, 2));
  }

  try {
    return app(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Unhandled request exception',
      message: err.message,
      stack: err.stack,
    }, null, 2));
  }
};
