import path from 'node:path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppContext, type ContextOptions } from './auth/context';
import { makeAuthRouter } from './auth/routes';
import { makeAttachSession, requireUnlocked, requireCsrf } from './auth/middleware';
import { makeApiRouter } from './routes/api';
import { config } from './config';
import { log } from './util/logger';

export interface CreateAppOptions extends Partial<ContextOptions> {
  /** When true, skip starting the background idle sweeper (tests). */
  noSweeper?: boolean;
  /** Absolute path to the built client (dist) to serve as the SPA. */
  serveStaticDir?: string;
}

export interface CreatedApp {
  app: Express;
  context: AppContext;
}

export function createApp(options: CreateAppOptions = {}): CreatedApp {
  const ctxOpts: ContextOptions = {
    dbPath: options.dbPath ?? `${config.dataDir}/aegis.db`,
    idleTimeoutMs: options.idleTimeoutMs ?? config.idleTimeoutMs,
    failureDelayMs:
      options.failureDelayMs ?? (process.env.NODE_ENV === 'test' ? 0 : 250),
  };
  const context = new AppContext(ctxOpts);
  if (!options.noSweeper) context.startIdleSweeper();

  const app = express();
  app.disable('x-powered-by');
  // Behind the in-container HTTPS server, req.secure reflects TLS directly.

  app.use(
    helmet({
      hsts: { maxAge: 15552000, includeSubDomains: true },
      // Strict CSP: no inline scripts (the theme bootstrap is an external file).
      // Inline STYLE attributes are allowed (React/sonner/Radix set them); that
      // is permitted by §6.5 which forbids inline scripts specifically.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // Public health endpoint (Docker healthcheck) — never gated.
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, status: context.vault.status() });
  });

  // Attach session (if any) to every /api request before auth + business routes.
  const attachSession = makeAttachSession(context);
  app.use('/api', attachSession);

  app.use('/api/auth', makeAuthRouter(context));

  // All other /api routes require an unlocked session; mutations require CSRF.
  const api = express.Router();
  api.get('/me', (req: Request, res: Response) => {
    res.json({ unlocked: true, csrfToken: req.session!.csrfToken });
  });
  api.use(makeApiRouter(context));
  app.use('/api', requireUnlocked, requireCsrf, api);

  // JSON 404 for unknown API routes.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Centralized error handler — never leak internals or secrets.
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error('api.error', { err: err instanceof Error ? err.message : String(err) });
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  // Serve the built SPA (Phase 6 / production). API routes already handled above.
  if (options.serveStaticDir) {
    const staticDir = options.serveStaticDir;
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    // SPA history fallback: any non-/api GET returns index.html.
    app.get(/^(?!\/api(?:\/|$)).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return { app, context };
}
