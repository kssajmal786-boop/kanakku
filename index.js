/**
 * Local-only helper. Production API is /api/index.js.
 * Static PWA files are served from /public on Vercel.
 *
 * Do not export an Express app from this file — Vercel would treat it as
 * a catch-all serverless function and break static hosting.
 */
if (require.main === module) {
  require('./backend/dist/index.js');
}
