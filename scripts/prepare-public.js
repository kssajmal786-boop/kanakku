/**
 * Prepare static assets for Vercel.
 * Writes to /www (not /public) so Vercel does not lose the output
 * directory when the existing public/ folder is replaced.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(ROOT, 'frontend');
const OUT_DIR = path.resolve(ROOT, 'www');

console.log('[Build] Preparing static output directory for Vercel...');

if (!fs.existsSync(FRONTEND_DIR)) {
  console.error('[Build Error] frontend directory not found at', FRONTEND_DIR);
  process.exit(1);
}

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

fs.cpSync(FRONTEND_DIR, OUT_DIR, {
  recursive: true,
  filter: (src) => {
    const filename = path.basename(src);
    if (filename === 'server.js' || filename === 'package.json') {
      return false;
    }
    return true;
  },
});

console.log('[Build] Successfully prepared static directory at', OUT_DIR);
