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

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export function createApp(): Application {
  const app = express();

  // Vercel / proxies set X-Forwarded-For. Required so express-rate-limit
  // does not throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request.
  app.set('trust proxy', isServerless ? 1 : config.server.trustProxy);
  app.disable('x-powered-by');

  // ── Lightweight Health Check (Bypasses heavier middleware) ───────────────
  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'kanakku-backend',
      version: '1.0.0',
      environment: config.server.nodeEnv,
      timestamp: new Date().toISOString(),
      serverless: isServerless,
    });
  };
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // ── Security headers (hidePoweredBy: false prevents removeHeader crash) ─
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hidePoweredBy: false,
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
        if (/^https:\/\/[a-zA-Z0-9-_.]+\.vercel\.app$/.test(origin)) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
      maxAge: 86400,
    })
  );

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser(config.cookie.secret));

  app.use((req, _res, next) => {
    req.requestId = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
    next();
  });

  if (!config.server.isTest) {
    app.use(
      morgan('combined', {
        stream: {
          write: (msg: string) => logger.http(msg.trim()),
        },
        skip: (req) => req.path === '/health' || req.path === '/api/health',
      })
    );
  }

  app.use(generalRateLimiter);

  // Dual-mounted at / and /api for Vercel rewrites
  const apiRouter = express.Router();
  apiRouter.use('/health', healthRouter);
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/gmail', gmailRouter);
  apiRouter.use('/transactions', transactionsRouter);
  apiRouter.use('/ai', aiRouter);

  app.use(apiRouter);
  app.use('/api', apiRouter);

  // Static PWA fallback (Vercel also serves /public as CDN assets)
  const publicPath = path.resolve(process.cwd(), 'public');
  const frontendPath = path.resolve(__dirname, '../../frontend');
  const staticPath = fs.existsSync(publicPath)
    ? publicPath
    : fs.existsSync(frontendPath)
      ? frontendPath
      : null;

  if (staticPath) {
    app.use(express.static(staticPath));
    app.get('*', (_req, res, next) => {
      if (
        _req.path.startsWith('/api') ||
        _req.path.startsWith('/auth') ||
        _req.path.startsWith('/gmail') ||
        _req.path.startsWith('/ai')
      ) {
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
