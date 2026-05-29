import type { DB } from './crypto-db';
import type {
  Evidence,
  EvidenceControlRef,
  EvidenceCreateInput,
  EvidenceUpdateInput,
  EvidenceListQuery,
} from '@aegis/shared';
import { recordAudit } from './audit';
import { nowIso, todayIso } from '../util/now';

type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function parseTags(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToEvidence(row: Row, today: string, linkedControls?: EvidenceControlRef[]): Evidence {
  const expiresAt = (row.expires_at as string | null) ?? null;
  const mime = (row.mime as string | null) ?? null;
  return {
    id: row.id as number,
    client_id: row.client_id as number,
    kind: row.kind as Evidence['kind'],
    label: row.label as string,
    url: (row.url as string | null) ?? null,
    text: (row.text as string | null) ?? null,
    mime,
    size: (row.size as number | null) ?? null,
    tags: parseTags(row.tags),
    expires_at: expiresAt,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    expired: expiresAt != null && expiresAt < today,
    linked_control_count: (row.linked_control_count as number) ?? 0,
    previewable: row.kind === 'file' && mime != null && mime.startsWith('image/'),
    ...(linkedControls ? { linked_controls: linkedControls } : {}),
  };
}

/** Columns we read for an evidence row (never the blob bytes). */
const EVIDENCE_COLS = `
  e.id, e.client_id, e.kind, e.label, e.url, e.text, e.mime, e.size, e.tags,
  e.expires_at, e.created_at, e.updated_at,
  (SELECT count(*) FROM evidence_links l WHERE l.evidence_id = e.id) AS linked_control_count
`;

function controlRefsFor(db: DB, evidenceId: number): EvidenceControlRef[] {
  return db
    .prepare(
      `SELECT c.id AS control_row_id, c.control_id, c.title
       FROM evidence_links l JOIN controls c ON c.id = l.control_row_id
       WHERE l.evidence_id = ?
       ORDER BY length(c.control_id), c.control_id`,
    )
    .all(evidenceId) as EvidenceControlRef[];
}

/** Resolve the client that owns a control row (authorization + scoping). */
export function controlOwnerClient(db: DB, controlRowId: number): number | undefined {
  const row = db.prepare(`SELECT client_id FROM controls WHERE id = ?`).get(controlRowId) as
    | { client_id: number }
    | undefined;
  return row?.client_id;
}

function controlIdOf(db: DB, controlRowId: number): string {
  const row = db.prepare(`SELECT control_id FROM controls WHERE id = ?`).get(controlRowId) as
    | { control_id: string }
    | undefined;
  return row?.control_id ?? String(controlRowId);
}

/** True when a control row exists and belongs to the given client. */
function controlBelongsToClient(db: DB, clientId: number, controlRowId: number): boolean {
  return controlOwnerClient(db, controlRowId) === clientId;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** The engagement's evidence library, with optional search / tag / kind / status filters. */
export function listLibrary(db: DB, clientId: number, query: EvidenceListQuery): Evidence[] {
  const today = todayIso();
  const where: string[] = ['e.client_id = @client_id'];
  const params: Record<string, unknown> = { client_id: clientId };

  if (query.search) {
    where.push('(e.label LIKE @search OR e.text LIKE @search OR e.url LIKE @search OR e.tags LIKE @search)');
    params.search = `%${query.search}%`;
  }
  if (query.kind) {
    where.push('e.kind = @kind');
    params.kind = query.kind;
  }
  if (query.tag) {
    // tags is a JSON array string like ["technical","policy"].
    where.push('e.tags LIKE @tag');
    params.tag = `%"${query.tag}"%`;
  }
  if (query.status === 'stale') {
    where.push('e.expires_at IS NOT NULL AND e.expires_at < @today');
    params.today = today;
  } else if (query.status === 'active') {
    where.push('(e.expires_at IS NULL OR e.expires_at >= @today)');
    params.today = today;
  }

  const rows = db
    .prepare(
      `SELECT ${EVIDENCE_COLS} FROM evidence e
       WHERE ${where.join(' AND ')}
       ORDER BY e.updated_at DESC, e.id DESC`,
    )
    .all(params) as Row[];
  return rows.map((r) => rowToEvidence(r, today));
}

/** A single library item scoped to a client, including its linked controls. */
export function getEvidenceForClient(db: DB, clientId: number, id: number): Evidence | undefined {
  const row = db
    .prepare(`SELECT ${EVIDENCE_COLS} FROM evidence e WHERE e.id = @id AND e.client_id = @client_id`)
    .get({ id, client_id: clientId }) as Row | undefined;
  if (!row) return undefined;
  return rowToEvidence(row, todayIso(), controlRefsFor(db, id));
}

/** Evidence linked to a specific control row (the control drawer view). */
export function listForControl(db: DB, controlRowId: number): Evidence[] {
  const today = todayIso();
  const rows = db
    .prepare(
      `SELECT ${EVIDENCE_COLS} FROM evidence e
       JOIN evidence_links l ON l.evidence_id = e.id
       WHERE l.control_row_id = ?
       ORDER BY e.updated_at DESC, e.id DESC`,
    )
    .all(controlRowId) as Row[];
  return rows.map((r) => rowToEvidence(r, today, controlRefsFor(db, r.id as number)));
}

/** Distinct tags used across a client's library (for the filter dropdown). */
export function listTags(db: DB, clientId: number): string[] {
  const rows = db.prepare(`SELECT tags FROM evidence WHERE client_id = ?`).all(clientId) as Row[];
  const set = new Set<string>();
  for (const r of rows) for (const t of parseTags(r.tags)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Fetch the stored file bytes for download. */
export function getEvidenceBlob(
  db: DB,
  id: number,
): { blob: Buffer; mime: string; label: string } | undefined {
  const row = db.prepare(`SELECT blob, mime, label, kind FROM evidence WHERE id = ?`).get(id) as
    | { blob: Buffer | null; mime: string | null; label: string; kind: string }
    | undefined;
  if (!row || row.kind !== 'file' || !row.blob) return undefined;
  return { blob: row.blob, mime: row.mime ?? 'application/octet-stream', label: row.label };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/** Link evidence to a control row (idempotent). Returns true if a new link was made. */
function linkRow(db: DB, evidenceId: number, controlRowId: number, now: string): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO evidence_links (evidence_id, control_row_id, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(evidenceId, controlRowId, now);
  return res.changes > 0;
}

interface CreateBase {
  label: string;
  tags?: string[];
  expires_at?: string | null;
  control_row_ids?: number[];
}

function linkInitialControls(
  db: DB,
  clientId: number,
  evidenceId: number,
  controlRowIds: number[] | undefined,
  now: string,
): number {
  if (!controlRowIds?.length) return 0;
  let linked = 0;
  for (const rid of controlRowIds) {
    if (controlBelongsToClient(db, clientId, rid) && linkRow(db, evidenceId, rid, now)) linked++;
  }
  return linked;
}

/** Create a link/note library item, optionally pre-linked to control rows. */
export function createLinkOrNote(
  db: DB,
  clientId: number,
  input: EvidenceCreateInput,
): Evidence {
  const now = nowIso();
  const tags = normalizeTags(input.tags);
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO evidence (client_id, kind, label, url, text, tags, expires_at, created_at, updated_at)
         VALUES (@client_id, @kind, @label, @url, @text, @tags, @expires_at, @now, @now)`,
      )
      .run({
        client_id: clientId,
        kind: input.kind,
        label: input.label,
        url: input.kind === 'link' ? input.url : null,
        text: input.kind === 'note' ? input.text : null,
        tags: tags.length ? JSON.stringify(tags) : null,
        expires_at: input.expires_at ?? null,
        now,
      });
    const id = Number(res.lastInsertRowid);
    const linked = linkInitialControls(db, clientId, id, input.control_row_ids, now);
    return { id, linked };
  });
  const { id, linked } = tx();
  recordAudit(db, {
    action: 'create',
    entity: 'evidence',
    entity_id: id,
    client_id: clientId,
    summary: `Added ${input.kind} evidence "${input.label}"${linked ? ` (linked to ${linked} control${linked > 1 ? 's' : ''})` : ''}`,
    after: { kind: input.kind, label: input.label, tags, expires_at: input.expires_at ?? null, links: linked },
  });
  return getEvidenceForClient(db, clientId, id)!;
}

/** Create a file library item (blob stored in the DB), optionally pre-linked. */
export function createFile(
  db: DB,
  clientId: number,
  file: { label: string; buffer: Buffer; mime: string } & Omit<CreateBase, 'label'>,
): Evidence {
  const now = nowIso();
  const tags = normalizeTags(file.tags);
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO evidence (client_id, kind, label, blob, mime, size, tags, expires_at, created_at, updated_at)
         VALUES (@client_id, 'file', @label, @blob, @mime, @size, @tags, @expires_at, @now, @now)`,
      )
      .run({
        client_id: clientId,
        label: file.label,
        blob: file.buffer,
        mime: file.mime,
        size: file.buffer.length,
        tags: tags.length ? JSON.stringify(tags) : null,
        expires_at: file.expires_at ?? null,
        now,
      });
    const id = Number(res.lastInsertRowid);
    const linked = linkInitialControls(db, clientId, id, file.control_row_ids, now);
    return { id, linked };
  });
  const { id, linked } = tx();
  recordAudit(db, {
    action: 'create',
    entity: 'evidence',
    entity_id: id,
    client_id: clientId,
    summary: `Uploaded file "${file.label}" (${file.buffer.length} bytes)${linked ? ` (linked to ${linked} control${linked > 1 ? 's' : ''})` : ''}`,
    after: { kind: 'file', label: file.label, mime: file.mime, size: file.buffer.length, tags, expires_at: file.expires_at ?? null, links: linked },
  });
  return getEvidenceForClient(db, clientId, id)!;
}

/** Update a library item (rename / retag / refresh expiry). Audits the diff. */
export function updateEvidence(
  db: DB,
  clientId: number,
  id: number,
  patch: EvidenceUpdateInput,
): Evidence | undefined {
  const existing = getEvidenceForClient(db, clientId, id);
  if (!existing) return undefined;

  const sets: string[] = [];
  const params: Record<string, unknown> = { id, client_id: clientId, now: nowIso() };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (patch.label !== undefined && patch.label !== existing.label) {
    sets.push('label = @label');
    params.label = patch.label;
    before.label = existing.label;
    after.label = patch.label;
  }
  if (patch.tags !== undefined) {
    const tags = normalizeTags(patch.tags);
    if (JSON.stringify(tags) !== JSON.stringify(existing.tags)) {
      sets.push('tags = @tags');
      params.tags = tags.length ? JSON.stringify(tags) : null;
      before.tags = existing.tags;
      after.tags = tags;
    }
  }
  if (patch.expires_at !== undefined) {
    const next = patch.expires_at ?? null;
    if (next !== existing.expires_at) {
      sets.push('expires_at = @expires_at');
      params.expires_at = next;
      before.expires_at = existing.expires_at;
      after.expires_at = next;
    }
  }
  if (sets.length === 0) return existing;

  db.prepare(
    `UPDATE evidence SET ${sets.join(', ')}, updated_at = @now WHERE id = @id AND client_id = @client_id`,
  ).run(params);

  recordAudit(db, {
    action: 'update',
    entity: 'evidence',
    entity_id: id,
    client_id: clientId,
    summary: `Updated evidence "${existing.label}" (${Object.keys(after).join(', ')})`,
    before,
    after,
  });
  return getEvidenceForClient(db, clientId, id);
}

/** Delete a library item (cascades its links). */
export function deleteEvidence(db: DB, clientId: number, id: number): boolean {
  const existing = getEvidenceForClient(db, clientId, id);
  if (!existing) return false;
  db.prepare(`DELETE FROM evidence WHERE id = ? AND client_id = ?`).run(id, clientId);
  recordAudit(db, {
    action: 'delete',
    entity: 'evidence',
    entity_id: id,
    client_id: clientId,
    summary: `Deleted ${existing.kind} evidence "${existing.label}"`,
    before: {
      kind: existing.kind,
      label: existing.label,
      tags: existing.tags,
      links: existing.linked_control_count,
    },
  });
  return true;
}

/** Link an existing library item to a control row. Returns the updated evidence. */
export function linkControl(
  db: DB,
  clientId: number,
  evidenceId: number,
  controlRowId: number,
): Evidence | undefined {
  const existing = getEvidenceForClient(db, clientId, evidenceId);
  if (!existing) return undefined;
  if (!controlBelongsToClient(db, clientId, controlRowId)) return undefined;
  const made = linkRow(db, evidenceId, controlRowId, nowIso());
  if (made) {
    recordAudit(db, {
      action: 'link',
      entity: 'evidence',
      entity_id: evidenceId,
      client_id: clientId,
      summary: `Linked evidence "${existing.label}" to ${controlIdOf(db, controlRowId)}`,
      after: { control: controlIdOf(db, controlRowId) },
    });
  }
  return getEvidenceForClient(db, clientId, evidenceId);
}

/** Unlink a library item from a control row (the item stays in the library). */
export function unlinkControl(
  db: DB,
  clientId: number,
  evidenceId: number,
  controlRowId: number,
): Evidence | undefined {
  const existing = getEvidenceForClient(db, clientId, evidenceId);
  if (!existing) return undefined;
  const res = db
    .prepare(`DELETE FROM evidence_links WHERE evidence_id = ? AND control_row_id = ?`)
    .run(evidenceId, controlRowId);
  if (res.changes > 0) {
    recordAudit(db, {
      action: 'unlink',
      entity: 'evidence',
      entity_id: evidenceId,
      client_id: clientId,
      summary: `Unlinked evidence "${existing.label}" from ${controlIdOf(db, controlRowId)}`,
      before: { control: controlIdOf(db, controlRowId) },
    });
  }
  return getEvidenceForClient(db, clientId, evidenceId);
}
