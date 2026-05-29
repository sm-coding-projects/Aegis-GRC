import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, type CreatedApp } from '../app';
import { openEncrypted, checkpointAndClose } from '../db/crypto-db';
import { initializeSchema } from '../db/init';
import { createClient, listClients } from '../db/clients';

const XRW = ['X-Requested-With', 'XMLHttpRequest'] as const;

let dir: string;
const apps: CreatedApp[] = [];

function makeApp(opts: Parameters<typeof createApp>[0] = {}): CreatedApp {
  const created = createApp({ noSweeper: true, ...opts });
  apps.push(created);
  return created;
}

function dbPathIn(name = 'aegis.db'): string {
  return path.join(dir, name);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aegis-p3-'));
});
afterEach(() => {
  for (const a of apps) a.context.dispose();
  apps.length = 0;
  rmSync(dir, { recursive: true, force: true });
});

describe('phase 3 — auth & lifecycle', () => {
  it('health is public; other /api routes are 401 while locked', async () => {
    const { app } = makeApp({ dbPath: dbPathIn() });
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/me').expect(401);
    await request(app).get('/api/clients').expect(401); // unknown+gated → 401
  });

  it('status reports needsSetup on a greenfield instance', async () => {
    const { app } = makeApp({ dbPath: dbPathIn() });
    const res = await request(app).get('/api/auth/status').expect(200);
    expect(res.body).toEqual({ unlocked: false, needsSetup: true });
  });

  it('create-master-password flow seeds the DB and authenticates the session', async () => {
    const { app } = makeApp({ dbPath: dbPathIn() });
    const agent = request.agent(app);

    const created = await agent
      .post('/api/auth/create')
      .set(...XRW)
      .send({ password: 'a-strong-master-pass' })
      .expect(201);
    expect(created.body.ok).toBe(true);
    expect(typeof created.body.csrfToken).toBe('string');

    // Session cookie is httpOnly + SameSite=Strict.
    const setCookie = (created.headers['set-cookie'] as string[] | undefined)?.[0] ?? '';
    expect(setCookie).toMatch(/aegis_sid=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);

    await agent.get('/api/me').expect(200);

    const status = await agent.get('/api/auth/status').expect(200);
    expect(status.body.unlocked).toBe(true);
    expect(status.body.needsSetup).toBe(false);
    expect(status.body.csrfToken).toBe(created.body.csrfToken);
  });

  it('create requires the X-Requested-With header (login CSRF mitigation)', async () => {
    const { app } = makeApp({ dbPath: dbPathIn() });
    await request(app)
      .post('/api/auth/create')
      .send({ password: 'a-strong-master-pass' })
      .expect(403);
  });

  it('logout re-locks the vault (subsequent calls 401)', async () => {
    const { app } = makeApp({ dbPath: dbPathIn() });
    const agent = request.agent(app);
    const created = await agent
      .post('/api/auth/create')
      .set(...XRW)
      .send({ password: 'a-strong-master-pass' })
      .expect(201);
    const csrf = created.body.csrfToken as string;

    await agent.get('/api/me').expect(200);
    await agent.post('/api/auth/logout').set('x-csrf-token', csrf).expect(200);
    await agent.get('/api/me').expect(401); // re-locked
  });

  it('rejects a CSRF-less mutation (no X-CSRF-Token)', async () => {
    const { app } = makeApp({ dbPath: dbPathIn() });
    const agent = request.agent(app);
    await agent
      .post('/api/auth/create')
      .set(...XRW)
      .send({ password: 'a-strong-master-pass' })
      .expect(201);
    // logout is a state-changing route; without the CSRF header it must fail.
    await agent.post('/api/auth/logout').expect(403);
  });

  it('unlock with the right password works; wrong password is generic 401 and rate-limited', async () => {
    // Pre-create a DB file, then dispose (which checkpoints + locks) so a fresh
    // app instance sees an existing, locked file.
    const seedApp = makeApp({ dbPath: dbPathIn() });
    const seedAgent = request.agent(seedApp.app);
    await seedAgent
      .post('/api/auth/create')
      .set(...XRW)
      .send({ password: 'right-password-123' })
      .expect(201);
    seedApp.context.dispose();

    // New app pointed at the same (now existing) file → locked, needs unlock.
    const { app } = makeApp({ dbPath: dbPathIn() });
    const status = await request(app).get('/api/auth/status').expect(200);
    expect(status.body).toEqual({ unlocked: false, needsSetup: false });

    // Right password unlocks.
    const ok = await request(app)
      .post('/api/auth/unlock')
      .set(...XRW)
      .send({ password: 'right-password-123' })
      .expect(200);
    expect(ok.body.ok).toBe(true);

    // Wrong password → generic 401 (no info leak). Use a fresh locked app so the
    // limiter window is clean.
    const lockedApp = makeApp({ dbPath: dbPathIn() });
    const tries: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await request(lockedApp.app)
        .post('/api/auth/unlock')
        .set(...XRW)
        .send({ password: 'wrong' });
      tries.push(r.status);
      if (r.status === 401) expect(r.body.error).toBe('Incorrect password');
    }
    // First 5 are 401; the 6th is rate-limited (429).
    expect(tries.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(tries[5]).toBe(429);
  });

  it('restore-from-upload then unlock recovers all data (single-file migration)', async () => {
    // Build a source encrypted DB with a seeded client, OUTSIDE any app.
    const srcPath = path.join(dir, 'source.db');
    const srcDb = openEncrypted(srcPath, 'migrate-me-please');
    initializeSchema(srcDb);
    createClient(srcDb, { name: 'Migrated Client', description: null });
    checkpointAndClose(srcDb);
    const bytes = readFileSync(srcPath);

    // Greenfield instance at a brand-new path.
    const greenPath = path.join(dir, 'green', 'aegis.db');
    const { app, context } = makeApp({ dbPath: greenPath });

    await request(app)
      .post('/api/auth/restore')
      .set(...XRW)
      .attach('file', bytes, 'aegis.db')
      .expect(201);

    // After restore the instance is still locked; unlock with original password.
    const unlock = await request(app)
      .post('/api/auth/unlock')
      .set(...XRW)
      .send({ password: 'migrate-me-please' })
      .expect(200);
    expect(unlock.body.ok).toBe(true);

    // White-box: the migrated data is present.
    const clients = listClients(context.vault.getDb());
    expect(clients).toHaveLength(1);
    expect(clients[0]!.name).toBe('Migrated Client');
  });

  it('restore is rejected when an instance already exists', async () => {
    const { app } = makeApp({ dbPath: dbPathIn() });
    await request(app)
      .post('/api/auth/create')
      .set(...XRW)
      .send({ password: 'a-strong-master-pass' })
      .expect(201);
    // Already initialized → restore must 409.
    await request(app)
      .post('/api/auth/restore')
      .set(...XRW)
      .attach('file', Buffer.from('whatever'), 'aegis.db')
      .expect(409);
  });

  it('idle timeout closes the session and re-locks', async () => {
    const { app, context } = makeApp({ dbPath: dbPathIn(), idleTimeoutMs: 1000 });
    const agent = request.agent(app);
    const created = await agent
      .post('/api/auth/create')
      .set(...XRW)
      .send({ password: 'a-strong-master-pass' })
      .expect(201);
    await agent.get('/api/me').expect(200); // active session works

    // Deterministically simulate idleness: backdate the session's lastActivity
    // beyond the timeout (no real-time sleep → no flakiness under load).
    const setCookie = (created.headers['set-cookie'] as string[] | undefined)?.[0] ?? '';
    const sid = /aegis_sid=([^;]+)/.exec(setCookie)?.[1] ?? '';
    const session = context.sessions.get(sid)!;
    session.lastActivity = Date.now() - 2000; // > 1000ms idle window

    await agent.get('/api/me').expect(401); // idle → re-locked
    expect(context.vault.isUnlocked()).toBe(false);
  });
});
