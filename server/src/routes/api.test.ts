import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, type CreatedApp } from '../app';
import { openEncrypted, checkpointAndClose } from '../db/crypto-db';
import { listClients } from '../db/clients';

const XRW = ['X-Requested-With', 'XMLHttpRequest'] as const;
const PW = 'phase-4-master-pass';

let dir: string;
let created: CreatedApp;
let agent: ReturnType<typeof request.agent>;
let csrf: string;

async function bootstrap(): Promise<void> {
  agent = request.agent(created.app);
  const res = await agent
    .post('/api/auth/create')
    .set(...XRW)
    .send({ password: PW })
    .expect(201);
  csrf = res.body.csrfToken;
}

/** Helper: authenticated mutating request with CSRF header. */
function mutate(method: 'post' | 'patch' | 'delete', url: string) {
  return agent[method](url).set('x-csrf-token', csrf);
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'aegis-p4-'));
  created = createApp({ noSweeper: true, dbPath: path.join(dir, 'aegis.db') });
  await bootstrap();
});
afterEach(() => {
  created.context.dispose();
  rmSync(dir, { recursive: true, force: true });
});

async function makeClient(name = 'Acme Corp'): Promise<number> {
  const res = await mutate('post', '/api/clients').send({ name }).expect(201);
  return res.body.id as number;
}

describe('phase 4 — API', () => {
  it('clients CRUD + seeds 93 controls + audits creation', async () => {
    const list0 = await agent.get('/api/clients').expect(200);
    expect(list0.body).toEqual([]);

    const id = await makeClient('Globex');
    const controls = await agent.get(`/api/clients/${id}/controls`).expect(200);
    expect(controls.body).toHaveLength(93);

    const got = await agent.get(`/api/clients/${id}`).expect(200);
    expect(got.body.name).toBe('Globex');

    await mutate('patch', `/api/clients/${id}`).send({ name: 'Globex Inc' }).expect(200);
    expect((await agent.get(`/api/clients/${id}`)).body.name).toBe('Globex Inc');

    await mutate('delete', `/api/clients/${id}`).expect(200);
    await agent.get(`/api/clients/${id}`).expect(404);
  });

  it('rejects invalid client input (zod) including unknown fields', async () => {
    await mutate('post', '/api/clients').send({}).expect(400); // missing name
    await mutate('post', '/api/clients').send({ name: '' }).expect(400); // empty
    await mutate('post', '/api/clients')
      .send({ name: 'ok', bogus: 'nope' })
      .expect(400); // strict() rejects unknown field
  });

  it('controls: filter by theme/status, update, and overdue derivation', async () => {
    const id = await makeClient();

    const org = await agent.get(`/api/clients/${id}/controls?theme=A.5`).expect(200);
    expect(org.body).toHaveLength(37);

    // Update a control: set implemented + owner.
    const rowId = org.body[0].id as number;
    const upd = await mutate('patch', `/api/clients/${id}/controls/${rowId}`)
      .send({ status: 'implemented', owner: 'Jane Auditor' })
      .expect(200);
    expect(upd.body.status).toBe('implemented');
    expect(upd.body.owner).toBe('Jane Auditor');

    const implemented = await agent
      .get(`/api/clients/${id}/controls?status=implemented`)
      .expect(200);
    expect(implemented.body).toHaveLength(1);

    // Make a control overdue: due_date in the past, not implemented.
    const rowId2 = org.body[1].id as number;
    await mutate('patch', `/api/clients/${id}/controls/${rowId2}`)
      .send({ status: 'in_progress', due_date: '2000-01-01' })
      .expect(200);
    const overdue = await agent.get(`/api/clients/${id}/controls?overdue=true`).expect(200);
    expect(overdue.body).toHaveLength(1);
    expect(overdue.body[0].id).toBe(rowId2);
    expect(overdue.body[0].overdue).toBe(true);
  });

  it('rejects invalid control update (bad status enum, unknown field)', async () => {
    const id = await makeClient();
    const rowId = (await agent.get(`/api/clients/${id}/controls`)).body[0].id;
    await mutate('patch', `/api/clients/${id}/controls/${rowId}`)
      .send({ status: 'banana' })
      .expect(400);
    await mutate('patch', `/api/clients/${id}/controls/${rowId}`)
      .send({ nope: true })
      .expect(400);
  });

  it('evidence: add link, note, upload file, list, download, delete', async () => {
    const id = await makeClient();
    const rowId = (await agent.get(`/api/clients/${id}/controls`)).body[0].id;
    const base = `/api/clients/${id}/controls/${rowId}/evidence`;

    await mutate('post', base)
      .send({ kind: 'link', label: 'Policy doc', url: 'https://example.com/policy' })
      .expect(201);
    await mutate('post', base)
      .send({ kind: 'note', label: 'Reviewer note', text: 'Looks good for audit' })
      .expect(201);

    // Upload a file (stored as a blob inside the encrypted DB).
    const fileContent = Buffer.from('PDF-LIKE-EVIDENCE-CONTENT');
    const up = await agent
      .post(`${base}/file`)
      .set('x-csrf-token', csrf)
      .field('label', 'Screenshot.png')
      .attach('file', fileContent, 'screenshot.png')
      .expect(201);
    const fileId = up.body.id as number;

    const list = await agent.get(base).expect(200);
    expect(list.body).toHaveLength(3);

    // Download returns the exact bytes.
    const dl = await agent.get(`/api/evidence/${fileId}/download`).expect(200);
    expect(Buffer.from(dl.body).equals(fileContent)).toBe(true);

    await mutate('delete', `/api/clients/${id}/evidence/${fileId}`).expect(200);
    expect((await agent.get(base)).body).toHaveLength(2);

    // Invalid evidence payload rejected.
    await mutate('post', base).send({ kind: 'link', label: 'x', url: 'not-a-url' }).expect(400);
  });

  it('dashboard aggregates reflect updates', async () => {
    const id = await makeClient();
    const controls = (await agent.get(`/api/clients/${id}/controls`)).body as { id: number }[];
    // Implement 3 controls, mark 1 not_applicable.
    for (let i = 0; i < 3; i++) {
      await mutate('patch', `/api/clients/${id}/controls/${controls[i]!.id}`)
        .send({ status: 'implemented' })
        .expect(200);
    }
    await mutate('patch', `/api/clients/${id}/controls/${controls[3]!.id}`)
      .send({ status: 'not_applicable', applicable: false })
      .expect(200);

    const dash = await agent.get(`/api/clients/${id}/dashboard`).expect(200);
    expect(dash.body.total_controls).toBe(93);
    expect(dash.body.implemented).toBe(3);
    expect(dash.body.applicable).toBe(92); // one marked not applicable
    expect(dash.body.by_theme).toHaveLength(4);
    expect(dash.body.recent_activity.length).toBeGreaterThan(0);
  });

  it('CSV export returns a well-formed SoA and audits the export', async () => {
    const id = await makeClient('Initech');
    const res = await agent.get(`/api/clients/${id}/export.csv`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/SoA-Initech-.*\.csv/);
    const lines = res.text.split('\r\n');
    expect(lines[0]).toContain('Control');
    expect(lines).toHaveLength(94); // header + 93 controls

    // Export was audited.
    const dash = await agent.get(`/api/clients/${id}/dashboard`).expect(200);
    expect(
      dash.body.recent_activity.some((a: { action: string }) => a.action === 'export'),
    ).toBe(true);
  });

  it('evidence library: M:N links, tags, expiry, search, link/unlink over HTTP', async () => {
    const id = await makeClient('Evidence Co');
    const controls = (await agent.get(`/api/clients/${id}/controls`)).body as { id: number }[];
    const rowA = controls[0]!.id;
    const rowB = controls[1]!.id;

    // Create a library item pre-linked to two controls, with tags + expiry.
    const created = await mutate('post', `/api/clients/${id}/evidence`)
      .send({
        kind: 'link',
        label: 'SOC 2 report',
        url: 'https://vendor.test/soc2',
        tags: ['vendor', 'policy'],
        expires_at: '2099-01-01',
        control_row_ids: [rowA, rowB],
      })
      .expect(201);
    const evId = created.body.id as number;
    expect(created.body.tags).toEqual(['vendor', 'policy']);
    expect(created.body.linked_control_count).toBe(2);

    // It shows up under BOTH controls (true many-to-many).
    expect((await agent.get(`/api/clients/${id}/controls/${rowA}/evidence`)).body).toHaveLength(1);
    expect((await agent.get(`/api/clients/${id}/controls/${rowB}/evidence`)).body).toHaveLength(1);

    // Library listing + tag filter + search.
    expect((await agent.get(`/api/clients/${id}/evidence`)).body).toHaveLength(1);
    expect((await agent.get(`/api/clients/${id}/evidence?tag=vendor`)).body).toHaveLength(1);
    expect((await agent.get(`/api/clients/${id}/evidence?search=soc`)).body).toHaveLength(1);
    expect((await agent.get(`/api/clients/${id}/evidence/tags`)).body.sort()).toEqual(['policy', 'vendor']);

    // Unlink from one control; still linked to the other.
    await mutate('delete', `/api/clients/${id}/evidence/${evId}/links/${rowA}`).expect(200);
    expect((await agent.get(`/api/clients/${id}/controls/${rowA}/evidence`)).body).toHaveLength(0);
    expect((await agent.get(`/api/clients/${id}/controls/${rowB}/evidence`)).body).toHaveLength(1);

    // Re-link via the explicit link endpoint.
    const relinked = await mutate('post', `/api/clients/${id}/evidence/${evId}/links`)
      .send({ control_row_id: rowA })
      .expect(200);
    expect(relinked.body.linked_control_count).toBe(2);

    // Update (refresh expiry + retag).
    const patched = await mutate('patch', `/api/clients/${id}/evidence/${evId}`)
      .send({ expires_at: '2030-06-01', tags: ['vendor'] })
      .expect(200);
    expect(patched.body.expires_at).toBe('2030-06-01');
    expect(patched.body.tags).toEqual(['vendor']);

    // Upload a file into the library, linked to control A.
    const up = await agent
      .post(`/api/clients/${id}/evidence/file`)
      .set('x-csrf-token', csrf)
      .field('label', 'evidence.png')
      .field('tags', JSON.stringify(['screenshot']))
      .field('control_row_ids', JSON.stringify([rowA]))
      .attach('file', Buffer.from('PNGDATA'), 'evidence.png')
      .expect(201);
    expect(up.body.tags).toEqual(['screenshot']);
    expect(up.body.linked_control_count).toBe(1);
    const dl = await agent.get(`/api/evidence/${up.body.id}/download`).expect(200);
    expect(Buffer.from(dl.body).toString()).toBe('PNGDATA');

    // Delete from library; gone everywhere.
    await mutate('delete', `/api/clients/${id}/evidence/${evId}`).expect(200);
    expect((await agent.get(`/api/clients/${id}/evidence`)).body).toHaveLength(1); // only the file remains
  });

  it('audit trail: records before/after + actor/ip, lists, filters, and exports CSV/JSON', async () => {
    const id = await makeClient('Audited LLC');
    const rowId = (await agent.get(`/api/clients/${id}/controls`)).body[0].id as number;
    const controlId = (await agent.get(`/api/clients/${id}/controls`)).body[0].control_id as string;

    await mutate('patch', `/api/clients/${id}/controls/${rowId}`)
      .send({ status: 'implemented', owner: 'Jane Auditor' })
      .expect(200);

    // Per-client paged trail.
    const page = await agent.get(`/api/clients/${id}/audit`).expect(200);
    expect(page.body.total).toBeGreaterThanOrEqual(2); // create client + update control
    expect(typeof page.body.limit).toBe('number');

    const updateEntry = (page.body.entries as Array<Record<string, unknown>>).find(
      (e) => e.action === 'update' && e.entity === 'control',
    )!;
    expect(updateEntry).toBeTruthy();
    expect(updateEntry.entity_id).toBe(controlId);
    expect(updateEntry.actor).toMatch(/^op-/); // session-derived actor
    expect(updateEntry.ip).toBeTruthy(); // captured from the request
    const after = JSON.parse(updateEntry.after as string);
    expect(after.status).toBe('implemented');
    expect(after.owner).toBe('Jane Auditor');

    // Filter by action.
    const onlyUpdates = await agent
      .get(`/api/clients/${id}/audit?action=update&entity=control`)
      .expect(200);
    expect(
      (onlyUpdates.body.entries as Array<{ action: string }>).every((e) => e.action === 'update'),
    ).toBe(true);

    // CSV export.
    const csv = await agent.get(`/api/clients/${id}/audit/export.csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/audit-Audited_LLC-.*\.csv/);
    expect(csv.text.split('\r\n')[0]).toContain('Before');

    // JSON export.
    const json = await agent.get(`/api/clients/${id}/audit/export.json`).expect(200);
    expect(json.headers['content-type']).toMatch(/application\/json/);
    expect(Array.isArray(json.body.entries)).toBe(true);

    // Global trail spans engagements.
    const globalTrail = await agent.get('/api/audit').expect(200);
    expect(globalTrail.body.total).toBeGreaterThanOrEqual(page.body.total);

    // Rejects unknown query fields (strict zod).
    await agent.get(`/api/clients/${id}/audit?bogus=1`).expect(400);
  });

  it('bulk update: marks a whole theme not-applicable with one justification', async () => {
    const id = await makeClient('Bulk Co');
    const tech = (await agent.get(`/api/clients/${id}/controls?theme=A.8`).expect(200))
      .body as { id: number; applicable: boolean }[];
    expect(tech).toHaveLength(34);
    const ids = tech.map((c) => c.id);

    const res = await mutate('patch', `/api/clients/${id}/controls/bulk`)
      .send({
        control_row_ids: ids,
        patch: { applicable: false, applicability_justification: 'Fully outsourced to SaaS provider' },
      })
      .expect(200);
    expect(res.body.updated).toBe(34);
    expect(res.body.controls.every((c: { applicable: boolean }) => c.applicable === false)).toBe(true);

    // Persisted: the whole theme is now not-applicable.
    const after = (await agent.get(`/api/clients/${id}/controls?theme=A.8&applicable=false`).expect(200))
      .body as unknown[];
    expect(after).toHaveLength(34);

    // Each changed control was audited individually.
    const audit = await agent
      .get(`/api/clients/${id}/audit?action=update&entity=control&limit=500`)
      .expect(200);
    expect(audit.body.total).toBeGreaterThanOrEqual(34);

    // The "bulk" path segment is not mistaken for a row id.
    await agent.get(`/api/clients/${id}/controls/bulk`).expect(400);
  });

  it('bulk update: rejects empty id list, empty patch, and unknown fields', async () => {
    const id = await makeClient();
    const rowId = (await agent.get(`/api/clients/${id}/controls`)).body[0].id as number;
    await mutate('patch', `/api/clients/${id}/controls/bulk`)
      .send({ control_row_ids: [], patch: { applicable: false } })
      .expect(400); // min(1)
    await mutate('patch', `/api/clients/${id}/controls/bulk`)
      .send({ control_row_ids: [rowId], patch: { status: 'banana' } })
      .expect(400); // bad enum
    await mutate('patch', `/api/clients/${id}/controls/bulk`)
      .send({ control_row_ids: [rowId], patch: { nope: 1 } })
      .expect(400); // unknown field (strict)
  });

  it('templates: save a baseline from one engagement and apply it to another', async () => {
    // Source engagement: mark all of A.8 not-applicable, then save as a template.
    const src = await makeClient('SaaS Vendor A');
    const tech = (await agent.get(`/api/clients/${src}/controls?theme=A.8`)).body as { id: number }[];
    await mutate('patch', `/api/clients/${src}/controls/bulk`)
      .send({
        control_row_ids: tech.map((c) => c.id),
        patch: { applicable: false, applicability_justification: 'Outsourced to SaaS' },
      })
      .expect(200);

    const created = await mutate('post', '/api/templates')
      .send({ name: 'SaaS vendor baseline', description: 'A.8 outsourced', from_client_id: src })
      .expect(201);
    const templateId = created.body.id as number;
    expect(created.body.item_count).toBe(93);

    // It appears in the list and its items are retrievable.
    expect((await agent.get('/api/templates')).body).toHaveLength(1);
    const full = await agent.get(`/api/templates/${templateId}`).expect(200);
    expect(full.body.items).toHaveLength(93);
    const a8Items = (full.body.items as { control_id: string; applicable: boolean }[]).filter((i) =>
      i.control_id.startsWith('A.8'),
    );
    expect(a8Items.every((i) => i.applicable === false)).toBe(true);

    // Duplicate name is rejected (409).
    await mutate('post', '/api/templates')
      .send({ name: 'SaaS vendor baseline', from_client_id: src })
      .expect(409);

    // Apply to a brand-new engagement (starts all-applicable).
    const dst = await makeClient('SaaS Vendor B');
    expect(
      ((await agent.get(`/api/clients/${dst}/controls?theme=A.8&applicable=false`)).body as unknown[]).length,
    ).toBe(0);

    const applied = await mutate('post', `/api/clients/${dst}/templates/${templateId}/apply`)
      .send({})
      .expect(200);
    expect(applied.body.applied).toBe(93);

    // A.8 is now not-applicable on the destination too.
    expect(
      ((await agent.get(`/api/clients/${dst}/controls?theme=A.8&applicable=false`)).body as unknown[]).length,
    ).toBe(34);

    // Apply was audited on the destination engagement.
    const audit = await agent.get(`/api/clients/${dst}/audit?entity=template&action=apply`).expect(200);
    expect(audit.body.total).toBe(1);

    // Rename, then delete.
    await mutate('patch', `/api/templates/${templateId}`).send({ name: 'SaaS baseline v2' }).expect(200);
    expect((await agent.get(`/api/templates/${templateId}`)).body.name).toBe('SaaS baseline v2');
    await mutate('delete', `/api/templates/${templateId}`).expect(200);
    await agent.get(`/api/templates/${templateId}`).expect(404);
  });

  it('templates: apply can be scoped to a single theme', async () => {
    const src = await makeClient('Theme Source');
    const all = (await agent.get(`/api/clients/${src}/controls`)).body as { id: number; theme_id: string }[];
    // Mark everything not-applicable on the source.
    await mutate('patch', `/api/clients/${src}/controls/bulk`)
      .send({ control_row_ids: all.map((c) => c.id), patch: { applicable: false } })
      .expect(200);
    const tpl = await mutate('post', '/api/templates')
      .send({ name: 'Everything off', from_client_id: src })
      .expect(201);

    const dst = await makeClient('Theme Target');
    // Apply only the A.6 slice (8 controls).
    const res = await mutate('post', `/api/clients/${dst}/templates/${tpl.body.id}/apply`)
      .send({ theme: 'A.6' })
      .expect(200);
    expect(res.body.applied).toBe(8);
    expect(
      ((await agent.get(`/api/clients/${dst}/controls?applicable=false`)).body as unknown[]).length,
    ).toBe(8);
  });

  it('templates: 404s for a missing source engagement or template', async () => {
    await mutate('post', '/api/templates')
      .send({ name: 'Orphan', from_client_id: 99999 })
      .expect(404);
    const id = await makeClient();
    await mutate('post', `/api/clients/${id}/templates/99999/apply`).send({}).expect(404);
  });

  it('backup downloads an encrypted file that re-opens with the password and has the data', async () => {
    const id = await makeClient('Backup Target');
    // Add a control update + evidence so there is data to verify post-restore.
    const rowId = (await agent.get(`/api/clients/${id}/controls`)).body[0].id;
    await mutate('patch', `/api/clients/${id}/controls/${rowId}`)
      .send({ status: 'implemented' })
      .expect(200);

    const res = await agent.get('/api/backup').expect(200);
    expect(res.headers['content-disposition']).toMatch(/aegis-backup-.*\.db/);
    const backupBytes = Buffer.from(res.body);
    // It must NOT be a plaintext SQLite file.
    expect(backupBytes.subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3 ');

    // Write it to a fresh path and open with the SAME password.
    const restored = path.join(dir, 'restored.db');
    writeFileSync(restored, backupBytes);
    const db = openEncrypted(restored, PW);
    const clients = listClients(db);
    expect(clients.map((c) => c.name)).toContain('Backup Target');
    checkpointAndClose(db);

    // And the wrong password fails on the backup.
    let threw = false;
    try {
      const bad = openEncrypted(restored, 'wrong-pass');
      bad.prepare('SELECT 1 FROM clients').get();
      checkpointAndClose(bad);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
