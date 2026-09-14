/**
 * Vercel Serverless Entry Point
 * ─────────────────────────────────────────────────────────────────────────
 * Exports Express application directly for Vercel's @vercel/node runtime.
 * ─────────────────────────────────────────────────────────────────────────
 */

const path = require('path');

let app;
try {
  const { createApp } = require('../backend/dist/app');
  app = createApp();
} catch (e) {
  const { createApp } = require(path.resolve(process.cwd(), 'backend/dist/app'));
  app = createApp();
}

module.exports = app;
