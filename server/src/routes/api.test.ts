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

    await mutate('delete', `/api/evidence/${fileId}`).expect(200);
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
