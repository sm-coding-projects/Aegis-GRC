import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEncrypted, checkpointAndClose, type DB } from './crypto-db';
import { initializeSchema } from './init';
import { createClient } from './clients';
import { updateControl } from './controls';
import { listAudit, allAudit, recordAudit } from './audit';
import type { ControlUpdateInput } from '@aegis/shared';

/** Apply a partial control patch (the runtime accepts partials; this satisfies the strict type). */
function patchControl(clientId: number, rowId: number, patch: Partial<ControlUpdateInput>) {
  return updateControl(db, clientId, rowId, patch as ControlUpdateInput);
}

let dir: string;
let db: DB;
const PW = 'audit-trail-master-pass';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aegis-audit-'));
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

function firstControlRowId(clientId: number): { rowId: number; controlId: string } {
  const row = db
    .prepare(`SELECT id, control_id FROM controls WHERE client_id = ? ORDER BY id LIMIT 1`)
    .get(clientId) as { id: number; control_id: string };
  return { rowId: row.id, controlId: row.control_id };
}

describe('audit trail — before/after capture', () => {
  it('records a field-level before/after diff on a control update', () => {
    const client = createClient(db, { name: 'Diff Co', description: null });
    const { rowId, controlId } = firstControlRowId(client.id);

    patchControl(client.id, rowId, { status: 'implemented', owner: 'Jane Auditor' });

    const page = listAudit(db, { entity: 'control', entity_id: controlId }, client.id);
    expect(page.entries).toHaveLength(1);
    const entry = page.entries[0]!;
    expect(entry.action).toBe('update');
    expect(entry.entity_id).toBe(controlId);

    const before = JSON.parse(entry.before!);
    const after = JSON.parse(entry.after!);
    expect(before.status).toBe('not_started');
    expect(after.status).toBe('implemented');
    expect(before.owner).toBeNull();
    expect(after.owner).toBe('Jane Auditor');
  });

  it('does not log fields whose value did not change', () => {
    const client = createClient(db, { name: 'NoOp Co', description: null });
    const { rowId, controlId } = firstControlRowId(client.id);

    // status is already not_started; only owner actually changes.
    patchControl(client.id, rowId, { status: 'not_started', owner: 'Bob' });

    const entry = listAudit(db, { entity: 'control', entity_id: controlId }, client.id).entries[0]!;
    const after = JSON.parse(entry.after!);
    expect(Object.keys(after)).toEqual(['owner']);
  });

  it('captures actor + ip from the request-scoped context when present', async () => {
    const { runWithAuditScope } = await import('../auth/audit-context');
    const client = createClient(db, { name: 'Scoped Co', description: null });
    const { rowId, controlId } = firstControlRowId(client.id);

    runWithAuditScope({ ip: '203.0.113.7', actor: 'op-abc123' }, () => {
      patchControl(client.id, rowId, { status: 'in_progress' });
    });

    const entry = listAudit(db, { entity: 'control', entity_id: controlId }, client.id).entries[0]!;
    expect(entry.ip).toBe('203.0.113.7');
    expect(entry.actor).toBe('op-abc123');
  });
});

describe('audit trail — immutability (DB triggers)', () => {
  it('rejects UPDATE of an audit row', () => {
    createClient(db, { name: 'Immutable Co', description: null });
    expect(() => db.prepare(`UPDATE audit_log SET summary = 'tampered' WHERE id = 1`).run()).toThrow(
      /append-only|immutable/i,
    );
  });

  it('rejects DELETE of an audit row', () => {
    createClient(db, { name: 'Immutable Co', description: null });
    expect(() => db.prepare(`DELETE FROM audit_log WHERE id = 1`).run()).toThrow(
      /append-only|immutable/i,
    );
  });

  it('still allows INSERT (append)', () => {
    const client = createClient(db, { name: 'Append Co', description: null });
    const before = listAudit(db, {}, client.id).total;
    recordAudit(db, {
      action: 'export',
      entity: 'audit',
      client_id: client.id,
      summary: 'manual append',
    });
    expect(listAudit(db, {}, client.id).total).toBe(before + 1);
  });
});

describe('audit trail — migration & persistence (reopen cycle)', () => {
  it('survives checkpoint+close+reopen with idempotent re-migration; columns + triggers persist', async () => {
    const { runWithAuditScope } = await import('../auth/audit-context');
    const file = path.join(dir, 'aegis.db');
    const client = createClient(db, { name: 'Persist Co', description: null });
    const { rowId, controlId } = firstControlRowId(client.id);
    runWithAuditScope({ ip: '198.51.100.42', actor: 'op-deadbeef' }, () => {
      patchControl(client.id, rowId, { status: 'implemented', owner: 'Auditor X' });
    });
    checkpointAndClose(db);

    // Reopen as a later unlock would: initializeSchema runs again (must be a no-op).
    db = openEncrypted(file, PW);
    initializeSchema(db); // idempotent — user_version already at latest
    initializeSchema(db);

    const entry = listAudit(db, { entity: 'control', entity_id: controlId }, client.id).entries[0]!;
    expect(entry.ip).toBe('198.51.100.42');
    expect(entry.actor).toBe('op-deadbeef');
    expect(JSON.parse(entry.after!).status).toBe('implemented');

    // Immutability triggers still enforced after reopen.
    expect(() => db.prepare(`DELETE FROM audit_log WHERE id = ?`).run(entry.id)).toThrow(
      /append-only|immutable/i,
    );
  });
});

describe('audit trail — listing & filtering', () => {
  it('paginates and filters by action/entity', () => {
    const client = createClient(db, { name: 'Paged Co', description: null });
    const rows = db
      .prepare(`SELECT id FROM controls WHERE client_id = ? ORDER BY id LIMIT 5`)
      .all(client.id) as { id: number }[];
    for (const r of rows) {
      patchControl(client.id, r.id, { status: 'implemented' });
    }

    // 1 create (client) + 5 updates (control)
    const all = listAudit(db, {}, client.id);
    expect(all.total).toBe(6);

    const updates = listAudit(db, { entity: 'control', action: 'update' }, client.id);
    expect(updates.total).toBe(5);

    const firstPage = listAudit(db, { limit: 2, offset: 0 }, client.id);
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.limit).toBe(2);

    // allAudit returns oldest → newest
    const ordered = allAudit(db, client.id);
    expect(ordered[0]!.action).toBe('create');
  });
});
