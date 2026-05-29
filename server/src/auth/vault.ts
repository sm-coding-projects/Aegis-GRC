import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import path from 'node:path';
import { openEncrypted, rekey, checkpointAndClose, type DB } from '../db/crypto-db';
import { initializeSchema } from '../db/init';
import { log } from '../util/logger';

/**
 * The Vault owns the single in-memory encrypted DB handle. Container start ⇒
 * locked (db === null) ⇒ every /api route except auth bootstrap returns 401.
 * The master password lives only as the SQLCipher key of this open connection;
 * it is never stored on this object, in env, on disk, or in logs.
 */
export class Vault {
  private db: DB | null = null;
  private lastActivityMs = 0;

  constructor(private readonly dbFilePath: string) {}

  /** True when the on-disk encrypted file exists (i.e. not a first run). */
  fileExists(): boolean {
    return existsSync(this.dbFilePath);
  }

  isUnlocked(): boolean {
    return this.db !== null;
  }

  /** Lifecycle status for the client to decide which screen to show. */
  status(): { unlocked: boolean; needsSetup: boolean } {
    return { unlocked: this.isUnlocked(), needsSetup: !this.fileExists() };
  }

  /** The open handle; throws if locked (callers should gate via middleware). */
  getDb(): DB {
    if (!this.db) throw new Error('Vault is locked');
    return this.db;
  }

  private ensureDataDir(): void {
    mkdirSync(path.dirname(this.dbFilePath), { recursive: true });
  }

  /**
   * First-run: create the encrypted DB with the master password and seed the
   * schema. Throws if a DB already exists (callers map this to a 409).
   */
  createNew(password: string): void {
    if (this.fileExists()) throw new Error('ALREADY_INITIALIZED');
    this.ensureDataDir();
    const db = openEncrypted(this.dbFilePath, password);
    initializeSchema(db);
    this.db = db;
    this.touch();
    log.info('vault.created');
  }

  /**
   * Normal run: open the existing encrypted DB. A wrong password throws
   * (SQLITE_NOTADB), which callers map to a generic 401.
   */
  unlock(password: string): void {
    if (!this.fileExists()) throw new Error('NO_DB');
    const db = openEncrypted(this.dbFilePath, password);
    initializeSchema(db); // idempotent: applies any pending migrations
    this.db = db;
    this.touch();
    log.info('vault.unlocked');
  }

  /** Change the master password (re-encrypts the file) on the open handle. */
  changePassword(currentPassword: string, newPassword: string): void {
    if (!this.db) throw new Error('Vault is locked');
    // Verify current password by opening a second handle; cheap and avoids
    // re-keying with an unverified caller.
    const verify = openEncrypted(this.dbFilePath, currentPassword);
    checkpointAndClose(verify);
    rekey(this.db, newPassword);
    log.info('vault.password_changed');
  }

  /** Close + re-lock. Safe to call when already locked. */
  lock(): void {
    if (this.db) {
      try {
        checkpointAndClose(this.db);
      } catch (err) {
        log.warn('vault.lock_close_failed', { err: (err as Error).message });
      }
      this.db = null;
      log.info('vault.locked');
    }
  }

  /**
   * Restore-from-upload (§4.6): only allowed while locked and only on a
   * greenfield instance (no existing DB). Writes the uploaded bytes to the data
   * path; the user then unlocks with the original password.
   */
  restore(bytes: Buffer): void {
    if (this.isUnlocked()) throw new Error('MUST_BE_LOCKED');
    if (this.fileExists()) throw new Error('ALREADY_INITIALIZED');
    this.ensureDataDir();
    // Write atomically: temp file then rename into place.
    const tmp = this.dbFilePath + '.restore.tmp';
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, this.dbFilePath);
    // Clean any stale WAL/SHM that might shadow the restored main file.
    for (const suffix of ['-wal', '-shm']) {
      const p = this.dbFilePath + suffix;
      if (existsSync(p)) rmSync(p, { force: true });
    }
    log.info('vault.restored');
  }

  /** Record activity for idle-timeout tracking. */
  touch(): void {
    this.lastActivityMs = Date.now();
  }

  /** Milliseconds since last activity (Infinity if locked / never active). */
  idleMs(): number {
    if (!this.db) return Infinity;
    return Date.now() - this.lastActivityMs;
  }
}
