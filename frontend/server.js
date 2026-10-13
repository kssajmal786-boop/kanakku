const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const API_PREFIXES = ['/api', '/auth', '/gmail', '/transactions', '/ai', '/health'];

function isApiRoute(pathname) {
  return API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function proxyToBackend(req, res) {
  try {
    const backend = new URL(BACKEND_URL);
    const proxyReq = http.request({
      protocol: backend.protocol,
      hostname: backend.hostname,
      port: backend.port || (backend.protocol === 'https:' ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: backend.host,
        'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
        'x-forwarded-proto': 'http',
      },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
      });
      res.end(JSON.stringify({
        success: false,
        error: `Backend server is unavailable at ${BACKEND_URL}. Please ensure the backend is running.`,
        code: 'BACKEND_UNAVAILABLE',
        detail: err.message,
      }));
    });

    req.pipe(proxyReq);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      error: 'Proxy configuration error',
      message: err.message,
    }));
  }
}

const server = http.createServer((req, res) => {
  // Normalize URL
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. Forward backend / API requests directly to backend server
  if (isApiRoute(pathname)) {
    return proxyToBackend(req, res);
  }

  // 2. Security check: prevent path traversal
  const normalizedRoot = path.normalize(ROOT);
  const safePath = path.normalize(path.join(normalizedRoot, pathname));
  if (!safePath.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // 3. Serve static file or directory index
  fs.stat(safePath, (err, stats) => {
    let filePath = safePath;

    if (!err && stats.isDirectory()) {
      filePath = path.join(safePath, 'index.html');
    }

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        // SPA Fallback for client-side routing
        fs.readFile(path.join(ROOT, 'index.html'), (spaErr, spaContent) => {
          if (spaErr) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          res.end(spaContent);
        });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`[Frontend] Kanakku PWA running on http://localhost:${PORT} (proxying API to ${BACKEND_URL})`);
});
