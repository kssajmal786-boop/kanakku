/**
 * Prepare Public Assets for Vercel Deployment
 * Copies frontend static assets to /public for Vercel's Edge CDN.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(ROOT, 'frontend');
const PUBLIC_DIR = path.resolve(ROOT, 'public');

console.log('[Build] Preparing public directory for Vercel...');

if (!fs.existsSync(FRONTEND_DIR)) {
  console.error('[Build Error] frontend directory not found at', FRONTEND_DIR);
  process.exit(1);
}

// Ensure clean public directory
if (fs.existsSync(PUBLIC_DIR)) {
  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
}
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Copy all frontend files to public
fs.cpSync(FRONTEND_DIR, PUBLIC_DIR, {
  recursive: true,
  filter: (src) => {
    const filename = path.basename(src);
    // Skip backend server.js and dev package files
    if (filename === 'server.js' || filename === 'package.json') {
      return false;
    }
    return true;
  },
});

console.log('[Build] Successfully prepared public directory at', PUBLIC_DIR);
