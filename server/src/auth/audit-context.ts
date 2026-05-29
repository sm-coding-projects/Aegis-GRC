import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

/**
 * Request-scoped audit context (originating IP + operator/session identifier).
 *
 * The audit trail must record *who* (actor) and *from where* (ip) for every
 * mutation, but `recordAudit` lives deep in the data layer and is called from
 * many places. Rather than thread an `(ip, actor)` pair through every function
 * signature, we stash it in an AsyncLocalStorage store established once per
 * request. The store survives async boundaries (e.g. multer file parsing), so a
 * concurrent request can never read another request's context.
 */
export interface AuditScope {
  ip: string | null;
  actor: string | null;
}

const storage = new AsyncLocalStorage<AuditScope>();

/** Read the current request's audit scope, or a system default outside a request. */
export function currentAuditScope(): AuditScope {
  return storage.getStore() ?? { ip: null, actor: 'system' };
}

/** Run `fn` within an explicit audit scope (used by non-request callers + tests). */
export function runWithAuditScope<T>(scope: AuditScope, fn: () => T): T {
  return storage.run(scope, fn);
}

/**
 * Express middleware: run the rest of the request inside an audit scope derived
 * from the (already-attached) session and socket. Must run AFTER attachSession.
 */
export function auditScopeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const scope: AuditScope = {
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
    actor: req.session?.actorId ?? 'operator',
  };
  storage.run(scope, () => next());
}
