import type { Request, Response, NextFunction, CookieOptions } from 'express';
import { CSRF_HEADER } from '@aegis/shared';
import { SessionStore } from './sessions';
import type { AppContext } from './context';

export const SESSION_COOKIE = 'aegis_sid';

/** Cookie options: httpOnly + SameSite=Strict always; Secure when over HTTPS. */
export function sessionCookieOptions(req: Request, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure, // true behind the in-container HTTPS server
    path: '/',
    maxAge: maxAgeMs,
  };
}

function genericUnauthorized(res: Response): void {
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Resolve the session from the cookie and enforce idle timeout. Attaches
 * req.session + req.db on success. Never throws; absence of req.session means
 * "not authenticated" and is handled by requireUnlocked.
 */
export function makeAttachSession(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const sid = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const session = ctx.sessions.get(sid);
    if (!session) return next();

    // If the vault locked underneath us (e.g. idle sweeper), the session is dead.
    if (!ctx.vault.isUnlocked()) {
      ctx.sessions.destroy(sid);
      return next();
    }

    // Idle timeout (request-time check, in addition to the background sweeper).
    if (Date.now() - session.lastActivity > ctx.opts.idleTimeoutMs) {
      ctx.lockAll('idle_timeout');
      return next();
    }

    session.lastActivity = Date.now();
    ctx.vault.touch();
    req.session = session;
    req.db = ctx.vault.getDb();
    next();
  };
}

/** 401 unless a valid session + unlocked vault are present. */
export function requireUnlocked(req: Request, res: Response, next: NextFunction): void {
  if (!req.session || !req.db) return genericUnauthorized(res);
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for session-authenticated mutations: the X-CSRF-Token header
 * must match the per-session token (constant-time compare). Pairs with the
 * SameSite=Strict cookie. Must run AFTER requireUnlocked.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const provided = req.get(CSRF_HEADER) ?? undefined;
  if (!req.session || !SessionStore.csrfMatches(req.session.csrfToken, provided)) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }
  next();
}

/**
 * CSRF mitigation for PRE-session bootstrap mutations (create/unlock/restore):
 * require a custom header that a cross-site HTML form cannot set without a CORS
 * preflight. Combined with SameSite=Strict this blocks login/restore CSRF.
 */
export function requireCustomHeader(req: Request, res: Response, next: NextFunction): void {
  const xrw = req.get('x-requested-with');
  if (xrw !== 'XMLHttpRequest') {
    res.status(403).json({ error: 'Missing X-Requested-With header' });
    return;
  }
  next();
}
