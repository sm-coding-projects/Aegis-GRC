import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface Session {
  id: string;
  csrfToken: string;
  /**
   * Short, non-sensitive identifier for this login session, used as the audit
   * `actor`. Deliberately NOT the session id or CSRF token (which are secrets
   * that must never leak into an exported audit trail).
   */
  actorId: string;
  createdAt: number;
  lastActivity: number;
}

/**
 * In-memory session store. One operator, so a Map is sufficient and means
 * sessions evaporate on restart (container start ⇒ locked ⇒ must re-unlock),
 * which is exactly the intended security posture.
 */
export class SessionStore {
  private sessions = new Map<string, Session>();

  create(): Session {
    const now = Date.now();
    const session: Session = {
      id: randomBytes(32).toString('hex'),
      csrfToken: randomBytes(32).toString('hex'),
      actorId: `op-${randomBytes(4).toString('hex')}`,
      createdAt: now,
      lastActivity: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | undefined {
    if (!id) return undefined;
    return this.sessions.get(id);
  }

  touch(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.lastActivity = Date.now();
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  destroyAll(): void {
    this.sessions.clear();
  }

  /** Constant-time CSRF token comparison. */
  static csrfMatches(expected: string, provided: string | undefined): boolean {
    if (!provided) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
