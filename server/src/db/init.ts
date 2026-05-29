import type { DB } from './crypto-db';
import { migrate, LATEST_SCHEMA_VERSION } from './migrations';
import { templateVersion } from './seed';
import { nowIso } from '../util/now';

/**
 * Bring a freshly created (or just-opened) encrypted DB up to the latest schema
 * and stamp app_meta. Idempotent: safe to call on every unlock.
 */
export function initializeSchema(db: DB): void {
  const version = migrate(db);

  const setMeta = db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  setMeta.run('schema_version', String(version));
  setMeta.run('template_version', templateVersion());
  const existing = db
    .prepare(`SELECT value FROM app_meta WHERE key = 'created_at'`)
    .get() as { value: string } | undefined;
  if (!existing) setMeta.run('created_at', nowIso());
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export { LATEST_SCHEMA_VERSION };
