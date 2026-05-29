import type { DB } from './crypto-db';
import type { Client, ClientCreateInput, ClientUpdateInput } from '@aegis/shared';
import { seedControlsForClient } from './seed';
import { recordAudit } from './audit';
import { nowIso } from '../util/now';

function rowToClient(row: Record<string, unknown>): Client {
  return {
    id: row.id as number,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Create a new engagement: insert the client and seed all 93 Annex A controls
 * for it, atomically. Returns the created client.
 */
export function createClient(db: DB, input: ClientCreateInput): Client {
  const now = nowIso();
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO clients (name, description, created_at, updated_at)
         VALUES (@name, @description, @now, @now)`,
      )
      .run({ name: input.name, description: input.description ?? null, now });
    const clientId = Number(res.lastInsertRowid);
    const count = seedControlsForClient(db, clientId, now);
    recordAudit(db, {
      action: 'create',
      entity: 'client',
      entity_id: clientId,
      client_id: clientId,
      summary: `Created engagement "${input.name}" and seeded ${count} controls`,
    });
    return clientId;
  });
  const id = tx();
  return getClient(db, id)!;
}

export function listClients(db: DB): Client[] {
  return (db.prepare(`SELECT * FROM clients ORDER BY name COLLATE NOCASE ASC`).all() as Record<
    string,
    unknown
  >[]).map(rowToClient);
}

export function getClient(db: DB, id: number): Client | undefined {
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToClient(row) : undefined;
}

export function updateClient(db: DB, id: number, input: ClientUpdateInput): Client | undefined {
  const existing = getClient(db, id);
  if (!existing) return undefined;
  const next = {
    name: input.name ?? existing.name,
    description: 'description' in input ? (input.description ?? null) : existing.description,
    now: nowIso(),
    id,
  };
  db.prepare(
    `UPDATE clients SET name = @name, description = @description, updated_at = @now WHERE id = @id`,
  ).run(next);
  recordAudit(db, {
    action: 'update',
    entity: 'client',
    entity_id: id,
    client_id: id,
    summary: `Updated engagement "${next.name}"`,
  });
  return getClient(db, id);
}

export function deleteClient(db: DB, id: number): boolean {
  const existing = getClient(db, id);
  if (!existing) return false;
  // ON DELETE CASCADE removes controls + evidence.
  db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
  recordAudit(db, {
    action: 'delete',
    entity: 'client',
    entity_id: id,
    client_id: null,
    summary: `Deleted engagement "${existing.name}"`,
  });
  return true;
}

export function countControls(db: DB, clientId: number): number {
  const row = db.prepare(`SELECT count(*) AS n FROM controls WHERE client_id = ?`).get(clientId) as {
    n: number;
  };
  return row.n;
}
