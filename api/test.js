/**
 * Diagnostic Endpoint for Vercel Serverless Runtime
 */
module.exports = (req, res) => {
  let appLoadError = null;
  let distFiles = [];

  try {
    const fs = require('fs');
    const path = require('path');
    const distPath = path.resolve(process.cwd(), 'backend/dist');
    if (fs.existsSync(distPath)) {
      distFiles = fs.readdirSync(distPath);
    }

    try {
      require(path.resolve(distPath, 'app'));
    } catch (e) {
      appLoadError = {
        message: e.message,
        stack: e.stack,
        code: e.code,
      };
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'diagnostic_ok',
      nodeVersion: process.version,
      cwd: process.cwd(),
      dirname: __dirname,
      distFiles,
      appLoadError,
      envKeys: Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET')),
    }, null, 2));
  } catch (globalErr) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'diagnostic_failed',
      error: globalErr.message,
      stack: globalErr.stack,
    }, null, 2));
  }
};
