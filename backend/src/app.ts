/**
 * Express Application Factory
 * ─────────────────────────────────────────────────────────────────────────
 * Creates and configures the Express app without starting the server.
 * ─────────────────────────────────────────────────────────────────────────
 */

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

import { config } from './config';
import { logger } from './utils/logger';
import { generalRateLimiter } from './middleware/rateLimit.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

import healthRouter from './routes/health.routes';
import authRouter from './routes/auth.routes';
import gmailRouter from './routes/gmail.routes';
import transactionsRouter from './routes/transactions.routes';
import aiRouter from './routes/ai.routes';

export function createApp(): Application {
  const app = express();

  // ── Trust proxy ────────────────────────────────────────────────────────
  if (config.server.trustProxy > 0) {
    app.set('trust proxy', config.server.trustProxy);
  }

  // ── Security headers ───────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false, // Frontend sets its own CSP
      crossOriginEmbedderPolicy: false,
    })
  );

  // ── CORS ───────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.server.isDevelopment) {
          return callback(null, true);
        }
        if (config.server.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Support Vercel deployment and preview URLs
        if (/^https:\/\/[a-zA-Z0-9-_.]+\.vercel\.app$/.test(origin)) {
          return callback(null, true);
        }
        callback(new Error(`CORS: Origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
      maxAge: 86400,
    })
  );

  // ── Compression ────────────────────────────────────────────────────────
  app.use(compression());

  // ── Body parsers ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // ── Cookie parser ──────────────────────────────────────────────────────
  app.use(cookieParser(config.cookie.secret));

  // ── Request ID ─────────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    req.requestId = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
    next();
  });

  // ── HTTP request logging (no body content logged) ──────────────────────
  if (!config.server.isTest) {
    app.use(
      morgan('combined', {
        stream: {
          write: (msg: string) => logger.http(msg.trim()),
        },
        skip: (req) => req.path === '/health',
      })
    );
  }

  // ── Global rate limiter ────────────────────────────────────────────────
  app.use(generalRateLimiter);

  // ── API Routes (Dual-mounted at / and /api for serverless compatibility) ─
  const apiRouter = express.Router();
  apiRouter.use('/health', healthRouter);
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/gmail', gmailRouter);
  apiRouter.use('/transactions', transactionsRouter);
  apiRouter.use('/ai', aiRouter);

  app.use(apiRouter);
  app.use('/api', apiRouter);

  // ── Serve frontend static files ────────────────────────────────────────
  // In production (Render, Docker, or Vercel), backend serves static PWA as fallback
  const publicPath = path.resolve(process.cwd(), 'public');
  const frontendPath = path.resolve(__dirname, '../../frontend');
  const staticPath = fs.existsSync(publicPath) ? publicPath : (fs.existsSync(frontendPath) ? frontendPath : null);

  if (staticPath) {
    app.use(express.static(staticPath));
    // SPA fallback
    app.get('*', (_req, res, next) => {
      // If request looks like an API call that was unhandled, pass to 404 handler
      if (_req.path.startsWith('/api') || _req.path.startsWith('/auth') || _req.path.startsWith('/gmail') || _req.path.startsWith('/ai')) {
        return next();
      }
      const indexPath = path.join(staticPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(200).send('CashFlow API is live');
      }
    });
  }

  // ── 404 handler ────────────────────────────────────────────────────────
  app.use(notFoundHandler);

  // ── Global error handler ───────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
