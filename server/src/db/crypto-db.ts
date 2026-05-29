import Database from 'better-sqlite3-multiple-ciphers';

/**
 * Encrypted database access (CLAUDE.md §5).
 *
 * The master password is the SQLCipher key — it is never persisted anywhere
 * (not env, not disk, not logs). It exists only as the in-memory key of an open
 * connection. A wrong key surfaces as SQLITE_NOTADB on the first read, which is
 * how we verify the password without storing a separate hash (that would break
 * the single-file rule). The KDF salt lives in the encrypted file header.
 */

export type DB = Database.Database;

/** Escape a passphrase for safe interpolation into a PRAGMA string. */
function q(passphrase: string): string {
  return passphrase.replace(/'/g, "''");
}

/**
 * Apply the SQLCipher v4 cipher configuration, then key the connection.
 * MUST be called before any read. Selecting the cipher + legacy=4 BEFORE keying
 * is required so the v4 KDF/page settings are used to derive the key.
 */
function keyConnection(db: DB, password: string): void {
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`legacy=4`); // SQLCipher v4 KDF/page settings (AES-256-CBC + HMAC-SHA512, PBKDF2)
  db.pragma(`key='${q(password)}'`);
}

/**
 * Open (or create) the encrypted database and key it with the master password.
 * Forces a real read so a wrong key throws immediately (SQLITE_NOTADB).
 * Throws if the password is wrong or the file is corrupt.
 */
export function openEncrypted(path: string, password: string): DB {
  const db = new Database(path);
  try {
    keyConnection(db, password);
    // Force a real page read — this is what fails loudly on a wrong key.
    db.prepare(`SELECT count(*) FROM sqlite_master`).get();

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (err) {
    // Never leave a half-open handle around on failure.
    try {
      db.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Change the master password in place (re-encrypts every page with a new key).
 * After this returns, the SAME handle continues to work with the new key.
 *
 * SQLCipher/SQLite refuses `rekey` while in WAL journal mode, so we drop to the
 * rollback journal for the rekey and restore WAL afterwards. We also checkpoint
 * first so no committed data is stranded in the WAL during the mode switch.
 */
export function rekey(db: DB, newPassword: string): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  try {
    db.pragma(`rekey='${q(newPassword)}'`);
  } finally {
    db.pragma('journal_mode = WAL');
  }
}

/**
 * Checkpoint the WAL into the main file and close, so the on-disk `aegis.db` is
 * a single self-contained encrypted file suitable for backup / migration.
 * (CLAUDE.md §5: the backup must be one file — checkpoint then close.)
 */
export function checkpointAndClose(db: DB): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

/**
 * Flush the WAL into the main file WITHOUT closing, so the on-disk `aegis.db` is
 * a consistent, self-contained single file that can be copied/streamed as a
 * backup while the app stays unlocked. (Used by the "Download backup" route.)
 */
export function checkpoint(db: DB): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
}

/** SQLite "wrong key / not a database" sentinel. */
export function isNotADbError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (('code' in err && (err as { code?: string }).code === 'SQLITE_NOTADB') ||
      /not a database/i.test(err.message) ||
      /file is not a database/i.test(err.message))
  );
}
