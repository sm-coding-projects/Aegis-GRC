import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEncrypted, checkpointAndClose, type DB } from './crypto-db';
import { initializeSchema } from './init';
import { migrate } from './migrations';
import { createClient } from './clients';
import {
  listLibrary,
  getEvidenceForClient,
  listForControl,
  listTags,
  createLinkOrNote,
  createFile,
  updateEvidence,
  deleteEvidence,
  linkControl,
  unlinkControl,
} from './evidence';
import { runWithAuditScope } from '../auth/audit-context';

let dir: string;
let db: DB;
const PW = 'evidence-library-pass';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aegis-ev-'));
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

function controlRows(clientId: number, n: number): { id: number; control_id: string }[] {
  return db
    .prepare(`SELECT id, control_id FROM controls WHERE client_id = ? ORDER BY id LIMIT ?`)
    .all(clientId, n) as { id: number; control_id: string }[];
}

describe('evidence library — create, tag, expiry, M:N links', () => {
  it('creates a link item with tags + expiry, pre-linked to multiple controls', () => {
    const client = createClient(db, { name: 'Acme', description: null });
    const rows = controlRows(client.id, 3);

    const ev = createLinkOrNote(db, client.id, {
      kind: 'link',
      label: 'Pen-test report',
      url: 'https://example.com/pentest',
      tags: ['technical', 'test-result', 'technical'], // dup should be dropped
      expires_at: '2027-01-01',
      control_row_ids: rows.map((r) => r.id),
    });

    expect(ev.kind).toBe('link');
    expect(ev.tags).toEqual(['technical', 'test-result']);
    expect(ev.expires_at).toBe('2027-01-01');
    expect(ev.expired).toBe(false);
    expect(ev.linked_control_count).toBe(3);
    expect(ev.linked_controls?.map((c) => c.control_row_id).sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );

    // Each of the 3 controls now sees this single piece of evidence.
    for (const r of rows) {
      const forControl = listForControl(db, r.id);
      expect(forControl).toHaveLength(1);
      expect(forControl[0]!.id).toBe(ev.id);
    }
  });

  it('flags expired evidence and filters by status', () => {
    const client = createClient(db, { name: 'Globex', description: null });
    const fresh = createLinkOrNote(db, client.id, {
      kind: 'note',
      label: 'Current policy',
      text: 'Up to date',
      expires_at: '2099-12-31',
    });
    const stale = createLinkOrNote(db, client.id, {
      kind: 'note',
      label: 'Old attestation',
      text: 'Expired vendor doc',
      expires_at: '2000-01-01',
    });

    expect(getEvidenceForClient(db, client.id, fresh.id)!.expired).toBe(false);
    expect(getEvidenceForClient(db, client.id, stale.id)!.expired).toBe(true);

    expect(listLibrary(db, client.id, { status: 'stale' }).map((e) => e.id)).toEqual([stale.id]);
    expect(listLibrary(db, client.id, { status: 'active' }).map((e) => e.id)).toEqual([fresh.id]);
    expect(listLibrary(db, client.id, { status: 'all' })).toHaveLength(2);
  });

  it('searches by label/text and filters by tag and kind', () => {
    const client = createClient(db, { name: 'Initech', description: null });
    createLinkOrNote(db, client.id, { kind: 'note', label: 'Firewall config', text: 'rules', tags: ['technical'] });
    createLinkOrNote(db, client.id, { kind: 'link', label: 'HR policy', url: 'https://x.test/hr', tags: ['policy'] });

    expect(listLibrary(db, client.id, { search: 'firewall' })).toHaveLength(1);
    expect(listLibrary(db, client.id, { tag: 'policy' }).map((e) => e.label)).toEqual(['HR policy']);
    expect(listLibrary(db, client.id, { kind: 'link' }).map((e) => e.label)).toEqual(['HR policy']);
    expect(listTags(db, client.id)).toEqual(['policy', 'technical']);
  });

  it('stores files with previewable flag for images', () => {
    const client = createClient(db, { name: 'Pixel Co', description: null });
    const png = createFile(db, client.id, {
      label: 'screen.png',
      buffer: Buffer.from('not-really-a-png-but-fine'),
      mime: 'image/png',
      tags: ['screenshot'],
    });
    const pdf = createFile(db, client.id, {
      label: 'report.pdf',
      buffer: Buffer.from('%PDF-1.4'),
      mime: 'application/pdf',
    });
    expect(png.previewable).toBe(true);
    expect(pdf.previewable).toBe(false);
  });

  it('links/unlinks an existing item across controls and audits both', () => {
    const client = createClient(db, { name: 'LinkCo', description: null });
    const rows = controlRows(client.id, 2);
    const ev = createLinkOrNote(db, client.id, { kind: 'link', label: 'Shared doc', url: 'https://x.test/doc' });
    expect(ev.linked_control_count).toBe(0);

    runWithAuditScope({ ip: '10.0.0.5', actor: 'op-test' }, () => {
      linkControl(db, client.id, ev.id, rows[0]!.id);
      linkControl(db, client.id, ev.id, rows[1]!.id);
      // linking again is idempotent (no duplicate)
      linkControl(db, client.id, ev.id, rows[1]!.id);
    });
    expect(getEvidenceForClient(db, client.id, ev.id)!.linked_control_count).toBe(2);

    unlinkControl(db, client.id, ev.id, rows[0]!.id);
    expect(getEvidenceForClient(db, client.id, ev.id)!.linked_control_count).toBe(1);

    const actions = db
      .prepare(`SELECT action FROM audit_log WHERE entity = 'evidence' ORDER BY id`)
      .all() as { action: string }[];
    expect(actions.map((a) => a.action)).toContain('link');
    expect(actions.map((a) => a.action)).toContain('unlink');
  });

  it('updates tags/expiry (refresh) with a before/after audit diff', () => {
    const client = createClient(db, { name: 'UpdCo', description: null });
    const ev = createLinkOrNote(db, client.id, {
      kind: 'note', label: 'Doc', text: 'x', tags: ['policy'], expires_at: '2000-01-01',
    });
    expect(getEvidenceForClient(db, client.id, ev.id)!.expired).toBe(true);

    const updated = updateEvidence(db, client.id, ev.id, { tags: ['policy', 'process'], expires_at: '2099-01-01' })!;
    expect(updated.tags).toEqual(['policy', 'process']);
    expect(updated.expired).toBe(false);

    const audit = db
      .prepare(`SELECT before, after FROM audit_log WHERE entity='evidence' AND action='update' ORDER BY id DESC LIMIT 1`)
      .get() as { before: string; after: string };
    expect(JSON.parse(audit.before).expires_at).toBe('2000-01-01');
    expect(JSON.parse(audit.after).expires_at).toBe('2099-01-01');
  });

  it('deleting a library item cascades its links', () => {
    const client = createClient(db, { name: 'DelCo', description: null });
    const rows = controlRows(client.id, 2);
    const ev = createLinkOrNote(db, client.id, {
      kind: 'link', label: 'Doomed', url: 'https://x.test/d', control_row_ids: rows.map((r) => r.id),
    });
    expect(listForControl(db, rows[0]!.id)).toHaveLength(1);

    expect(deleteEvidence(db, client.id, ev.id)).toBe(true);
    expect(getEvidenceForClient(db, client.id, ev.id)).toBeUndefined();
    expect(listForControl(db, rows[0]!.id)).toHaveLength(0);
    const links = db.prepare(`SELECT count(*) AS n FROM evidence_links`).get() as { n: number };
    expect(links.n).toBe(0);
  });

  it('rejects linking a control from a different client', () => {
    const a = createClient(db, { name: 'A', description: null });
    const b = createClient(db, { name: 'B', description: null });
    const bRow = controlRows(b.id, 1)[0]!;
    const ev = createLinkOrNote(db, a.id, { kind: 'link', label: 'A-doc', url: 'https://x.test/a' });
    // linkControl refuses a control belonging to client B → undefined (maps to 404).
    expect(linkControl(db, a.id, ev.id, bRow.id)).toBeUndefined();
    // ...and no link was created.
    expect(getEvidenceForClient(db, a.id, ev.id)!.linked_control_count).toBe(0);
  });
});

describe('evidence library — migration from v2 (old 1:N schema)', () => {
  it('rebuilds old per-control evidence into the library + backfills links', () => {
    // Build a DB at schema v2 (pre-library), then seed old-shape evidence.
    const v2dir = mkdtempSync(path.join(tmpdir(), 'aegis-ev2-'));
    const v2db = openEncrypted(path.join(v2dir, 'aegis.db'), PW);
    try {
      migrate(v2db, 2); // stop at v2 — evidence still has control_row_id, no library
      expect(Number(v2db.pragma('user_version', { simple: true }))).toBe(2);

      const client = createClient(v2db, { name: 'Legacy Co', description: null });
      const rows = v2db
        .prepare(`SELECT id FROM controls WHERE client_id = ? ORDER BY id LIMIT 2`)
        .all(client.id) as { id: number }[];

      // Insert two pieces of old-shape evidence (1:N via control_row_id).
      v2db
        .prepare(
          `INSERT INTO evidence (control_row_id, kind, label, url, created_at)
           VALUES (?, 'link', ?, ?, ?)`,
        )
        .run(rows[0]!.id, 'Legacy policy', 'https://legacy.test/p', '2025-01-01T00:00:00.000Z');
      v2db
        .prepare(
          `INSERT INTO evidence (control_row_id, kind, label, text, created_at)
           VALUES (?, 'note', ?, ?, ?)`,
        )
        .run(rows[1]!.id, 'Legacy note', 'some note', '2025-02-01T00:00:00.000Z');

      // Now apply the v3 library migration (in isolation, up to v3).
      migrate(v2db, 3);
      expect(Number(v2db.pragma('user_version', { simple: true }))).toBe(3);

      // Both pieces survived, gained client_id, and got one link each.
      const lib = listLibrary(v2db, client.id, {});
      expect(lib).toHaveLength(2);
      expect(lib.every((e) => e.client_id === client.id)).toBe(true);
      expect(listForControl(v2db, rows[0]!.id).map((e) => e.label)).toEqual(['Legacy policy']);
      expect(listForControl(v2db, rows[1]!.id).map((e) => e.label)).toEqual(['Legacy note']);

      // The new columns exist and default sensibly.
      const legacyPolicy = lib.find((e) => e.label === 'Legacy policy')!;
      expect(legacyPolicy.tags).toEqual([]);
      expect(legacyPolicy.expires_at).toBeNull();
      expect(legacyPolicy.url).toBe('https://legacy.test/p');
    } finally {
      checkpointAndClose(v2db);
      rmSync(v2dir, { recursive: true, force: true });
    }
  });
});
