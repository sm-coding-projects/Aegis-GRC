import type { DB } from './crypto-db';

/**
 * Forward-only migrations, versioned via PRAGMA user_version. Each migration is
 * applied inside a transaction; user_version is bumped only on success.
 */

interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE app_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE clients (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          description TEXT,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE TABLE controls (
          id                          INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id                   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          control_id                  TEXT NOT NULL,
          theme_id                    TEXT NOT NULL,
          theme                       TEXT NOT NULL,
          title                       TEXT NOT NULL,
          applicable                  INTEGER NOT NULL DEFAULT 1 CHECK (applicable IN (0, 1)),
          applicability_justification TEXT,
          status                      TEXT NOT NULL DEFAULT 'not_started'
                                        CHECK (status IN ('not_started','in_progress','implemented','not_applicable')),
          owner                       TEXT,
          due_date                    TEXT,
          last_reviewed               TEXT,
          implementation_notes        TEXT,
          created_at                  TEXT NOT NULL,
          updated_at                  TEXT NOT NULL,
          UNIQUE (client_id, control_id)
        );

        CREATE INDEX idx_controls_client      ON controls (client_id);
        CREATE INDEX idx_controls_client_theme ON controls (client_id, theme_id);
        CREATE INDEX idx_controls_client_status ON controls (client_id, status);

        CREATE TABLE evidence (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          control_row_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
          kind           TEXT NOT NULL CHECK (kind IN ('link','note','file')),
          label          TEXT NOT NULL,
          url            TEXT,
          text           TEXT,
          blob           BLOB,
          mime           TEXT,
          size           INTEGER,
          created_at     TEXT NOT NULL
        );

        CREATE INDEX idx_evidence_control ON evidence (control_row_id);

        -- Append-only audit trail. No UPDATE/DELETE in application code.
        CREATE TABLE audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          at         TEXT NOT NULL,
          action     TEXT NOT NULL,
          entity     TEXT NOT NULL,
          entity_id  TEXT,
          client_id  INTEGER,
          summary    TEXT NOT NULL
        );

        CREATE INDEX idx_audit_at ON audit_log (at DESC);
        CREATE INDEX idx_audit_client ON audit_log (client_id, at DESC);
      `);
    },
  },
  {
    version: 2,
    name: 'enrich + harden audit trail',
    up: (db) => {
      // Enrich the audit trail toward the canonical compliance tuple:
      // (timestamp, user_id, action, control_id, before, after, ip).
      //   before/after → JSON of the changed fields' old/new values
      //   ip           → originating request IP
      //   actor        → operator/session identifier (the single-user "user_id")
      db.exec(`
        ALTER TABLE audit_log ADD COLUMN before TEXT;
        ALTER TABLE audit_log ADD COLUMN after  TEXT;
        ALTER TABLE audit_log ADD COLUMN ip     TEXT;
        ALTER TABLE audit_log ADD COLUMN actor  TEXT;

        CREATE INDEX idx_audit_action ON audit_log (action);
        CREATE INDEX idx_audit_entity ON audit_log (entity);

        -- Enforce immutability at the database level, not just by convention.
        -- The audit trail is evidence; the application must never be able to
        -- rewrite or erase history.
        CREATE TRIGGER trg_audit_no_update
          BEFORE UPDATE ON audit_log
        BEGIN
          SELECT RAISE(ABORT, 'audit_log is append-only (immutable)');
        END;

        CREATE TRIGGER trg_audit_no_delete
          BEFORE DELETE ON audit_log
        BEGIN
          SELECT RAISE(ABORT, 'audit_log is append-only (immutable)');
        END;
      `);
    },
  },
  {
    version: 3,
    name: 'evidence library (M:N) + tags + expiry',
    up: (db) => {
      // Evidence moves from a per-control row (1:N) to an engagement-level
      // LIBRARY (client-scoped) that links MANY-to-MANY to control rows. We also
      // add tags + an expiry date so stale evidence can be surfaced/refreshed.
      //
      // SQLite table rebuild: rename the old table, create the new shape, copy
      // data (deriving client_id from each piece's control), seed one link per
      // existing piece, then drop the old table. evidence_links is created AFTER
      // the new evidence table so its FK resolves to the rebuilt table.
      db.exec(`
        ALTER TABLE evidence RENAME TO evidence_old;

        CREATE TABLE evidence (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          kind        TEXT NOT NULL CHECK (kind IN ('link','note','file')),
          label       TEXT NOT NULL,
          url         TEXT,
          text        TEXT,
          blob        BLOB,
          mime        TEXT,
          size        INTEGER,
          tags        TEXT,        -- JSON array of strings, e.g. ["technical","policy"]
          expires_at  TEXT,        -- YYYY-MM-DD or NULL (no expiry)
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        INSERT INTO evidence
          (id, client_id, kind, label, url, text, blob, mime, size, tags, expires_at, created_at, updated_at)
        SELECT e.id, c.client_id, e.kind, e.label, e.url, e.text, e.blob, e.mime, e.size,
               NULL, NULL, e.created_at, e.created_at
        FROM evidence_old e
        JOIN controls c ON c.id = e.control_row_id;

        CREATE TABLE evidence_links (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          evidence_id    INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
          control_row_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
          created_at     TEXT NOT NULL,
          UNIQUE (evidence_id, control_row_id)
        );

        INSERT INTO evidence_links (evidence_id, control_row_id, created_at)
        SELECT e.id, e.control_row_id, e.created_at FROM evidence_old e;

        DROP TABLE evidence_old;

        CREATE INDEX idx_evidence_client       ON evidence (client_id);
        CREATE INDEX idx_evidence_expires       ON evidence (expires_at);
        CREATE INDEX idx_evlinks_evidence       ON evidence_links (evidence_id);
        CREATE INDEX idx_evlinks_control        ON evidence_links (control_row_id);
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

/**
 * Apply pending migrations up to `target` (default: all). Returns the resulting
 * schema version. `target` exists so tests can build an old-schema DB and then
 * exercise a later migration's data upgrade in isolation.
 */
export function migrate(db: DB, target: number = LATEST_SCHEMA_VERSION): number {
  let current = Number(db.pragma('user_version', { simple: true }));
  for (const m of migrations) {
    if (m.version > current && m.version <= target) {
      const run = db.transaction(() => {
        m.up(db);
        db.pragma(`user_version = ${m.version}`);
      });
      run();
      current = m.version;
    }
  }
  return current;
}
