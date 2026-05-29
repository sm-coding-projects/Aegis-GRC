import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEncrypted, checkpointAndClose, type DB } from './crypto-db';
import { initializeSchema, getMeta, LATEST_SCHEMA_VERSION } from './init';
import { createClient, countControls, listClients } from './clients';

let dir: string;
let db: DB;
const PW = 'correct horse battery staple';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aegis-p1-'));
  db = openEncrypted(path.join(dir, 'aegis.db'), PW);
  initializeSchema(db);
});

afterEach(() => {
  try {
    checkpointAndClose(db);
  } catch {
    /* may already be closed */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('phase 1 — schema & seeding', () => {
  it('migrates to the latest schema version and stamps app_meta', () => {
    expect(getMeta(db, 'schema_version')).toBe(String(LATEST_SCHEMA_VERSION));
    expect(getMeta(db, 'template_version')).toBe('ISO/IEC 27001:2022');
  });

  it('seeds exactly 93 controls with the correct theme distribution 37/8/14/34', () => {
    const client = createClient(db, { name: 'Acme Corp', description: null });
    expect(countControls(db, client.id)).toBe(93);

    const rows = db
      .prepare(
        `SELECT theme_id, count(*) AS n FROM controls WHERE client_id = ? GROUP BY theme_id ORDER BY theme_id`,
      )
      .all(client.id) as { theme_id: string; n: number }[];
    const dist = Object.fromEntries(rows.map((r) => [r.theme_id, r.n]));
    expect(dist).toEqual({ 'A.5': 37, 'A.6': 8, 'A.7': 14, 'A.8': 34 });
  });

  it('seeds independent control sets per client', () => {
    const a = createClient(db, { name: 'Client A', description: null });
    const b = createClient(db, { name: 'Client B', description: 'second engagement' });
    expect(countControls(db, a.id)).toBe(93);
    expect(countControls(db, b.id)).toBe(93);
    expect(listClients(db)).toHaveLength(2);

    const total = db.prepare(`SELECT count(*) AS n FROM controls`).get() as { n: number };
    expect(total.n).toBe(186);
  });

  it('defaults seeded controls to applicable + not_started', () => {
    const client = createClient(db, { name: 'Defaults Co', description: null });
    const sample = db
      .prepare(`SELECT applicable, status FROM controls WHERE client_id = ? AND control_id = 'A.8.24'`)
      .get(client.id) as { applicable: number; status: string };
    expect(sample.applicable).toBe(1);
    expect(sample.status).toBe('not_started');
  });

  it('writes an audit entry when a client is created', () => {
    createClient(db, { name: 'Audited Inc', description: null });
    const audit = db.prepare(`SELECT action, entity, summary FROM audit_log`).all() as {
      action: string;
      entity: string;
      summary: string;
    }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('create');
    expect(audit[0]!.entity).toBe('client');
    expect(audit[0]!.summary).toContain('93 controls');
  });
});
