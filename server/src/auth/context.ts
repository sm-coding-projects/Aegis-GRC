import { Vault } from './vault';
import { SessionStore } from './sessions';
import { log } from '../util/logger';

export interface ContextOptions {
  dbPath: string;
  idleTimeoutMs: number;
  /** Artificial delay (ms) added to failed unlocks to blunt online guessing. */
  failureDelayMs: number;
}

/**
 * Per-app runtime state. Bundling vault + sessions here (rather than module
 * globals) keeps tests isolated — each createApp() gets a fresh context.
 */
export class AppContext {
  readonly vault: Vault;
  readonly sessions = new SessionStore();
  readonly opts: ContextOptions;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(opts: ContextOptions) {
    this.opts = opts;
    this.vault = new Vault(opts.dbPath);
  }

  /** Lock the vault and drop every session (logout / idle / restart paths). */
  lockAll(reason: string): void {
    this.vault.lock();
    this.sessions.destroyAll();
    log.info('context.locked_all', { reason });
  }

  /** Background backstop: lock when idle even if no request arrives. */
  startIdleSweeper(): void {
    if (this.sweeper) return;
    const interval = Math.max(1000, Math.min(this.opts.idleTimeoutMs, 30_000));
    this.sweeper = setInterval(() => {
      if (this.vault.isUnlocked() && this.vault.idleMs() > this.opts.idleTimeoutMs) {
        this.lockAll('idle_timeout');
      }
    }, interval);
    // Don't keep the process alive solely for the sweeper.
    this.sweeper.unref?.();
  }

  dispose(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
    this.vault.lock();
    this.sessions.destroyAll();
  }
}
