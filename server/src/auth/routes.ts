import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import {
  createMasterPasswordSchema,
  unlockSchema,
  changePasswordSchema,
  type AuthState,
} from '@aegis/shared';
import type { AppContext } from './context';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  requireUnlocked,
  requireCsrf,
  requireCustomHeader,
} from './middleware';
import { isNotADbError } from '../db/crypto-db';
import { log } from '../util/logger';

// Restore accepts a whole encrypted DB upload; allow generously (256 MB).
const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024 * 1024, files: 1 },
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function startSession(ctx: AppContext, req: Request, res: Response): string {
  const session = ctx.sessions.create();
  res.cookie(SESSION_COOKIE, session.id, sessionCookieOptions(req, ctx.opts.idleTimeoutMs));
  return session.csrfToken;
}

export function makeAuthRouter(ctx: AppContext): Router {
  const router = Router();

  // Brute-force resistance on the unlock route (§6.3).
  const unlockLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  });

  /** Public: which screen should the client show? Includes csrf when authed. */
  router.get('/status', (req: Request, res: Response) => {
    const state: AuthState = ctx.vault.status();
    const sid = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const session = ctx.sessions.get(sid);
    if (session && ctx.vault.isUnlocked()) {
      res.json({ ...state, csrfToken: session.csrfToken });
      return;
    }
    res.json(state);
  });

  /** First-run: create master password, create + seed the DB, start session. */
  router.post('/create', requireCustomHeader, (req: Request, res: Response) => {
    const parsed = createMasterPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    try {
      ctx.vault.createNew(parsed.data.password);
    } catch (err) {
      if ((err as Error).message === 'ALREADY_INITIALIZED') {
        res.status(409).json({ error: 'Already initialized' });
        return;
      }
      throw err;
    }
    const csrfToken = startSession(ctx, req, res);
    res.status(201).json({ ok: true, csrfToken });
  });

  /** Normal run: unlock with the master password. Generic errors + rate limit. */
  router.post('/unlock', unlockLimiter, requireCustomHeader, async (req: Request, res: Response) => {
    const parsed = unlockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    try {
      ctx.vault.unlock(parsed.data.password);
    } catch (err) {
      // Wrong password (NOTADB) and "no db yet" (NO_DB) both return the SAME
      // generic message so we never reveal which case occurred.
      if (isNotADbError(err) || (err as Error).message === 'NO_DB') {
        await sleep(ctx.opts.failureDelayMs);
        res.status(401).json({ error: 'Incorrect password' });
        return;
      }
      throw err;
    }
    const csrfToken = startSession(ctx, req, res);
    res.json({ ok: true, csrfToken });
  });

  /** Restore-from-upload on a greenfield instance (§4.6). */
  router.post(
    '/restore',
    requireCustomHeader,
    restoreUpload.single('file'),
    (req: Request, res: Response) => {
      const file = (req as Request & { file?: { buffer: Buffer } }).file;
      if (!file || !file.buffer || file.buffer.length === 0) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      try {
        ctx.vault.restore(file.buffer);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'ALREADY_INITIALIZED' || msg === 'MUST_BE_LOCKED') {
          res.status(409).json({ error: 'Cannot restore: an instance already exists' });
          return;
        }
        throw err;
      }
      res.status(201).json({ ok: true });
    },
  );

  /** Authenticated mutation: logout re-locks the vault and destroys the session. */
  router.post('/logout', requireUnlocked, requireCsrf, (req: Request, res: Response) => {
    ctx.lockAll('logout');
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req, 0));
    res.json({ ok: true });
  });

  /** Authenticated mutation: change master password (re-keys), then re-lock. */
  router.post('/change-password', requireUnlocked, requireCsrf, (req: Request, res: Response) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    try {
      ctx.vault.changePassword(parsed.data.currentPassword, parsed.data.newPassword);
    } catch (err) {
      if (isNotADbError(err)) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }
      throw err;
    }
    // Force re-authentication with the new password.
    ctx.lockAll('password_changed');
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req, 0));
    log.info('auth.password_changed_relock');
    res.json({ ok: true, relock: true });
  });

  return router;
}
