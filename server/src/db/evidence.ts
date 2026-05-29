import type { DB } from './crypto-db';
import type { Evidence, EvidenceCreateInput } from '@aegis/shared';
import { recordAudit } from './audit';
import { nowIso } from '../util/now';

type Row = Record<string, unknown>;

function rowToEvidence(row: Row): Evidence {
  return {
    id: row.id as number,
    control_row_id: row.control_row_id as number,
    kind: row.kind as Evidence['kind'],
    label: row.label as string,
    url: (row.url as string | null) ?? null,
    text: (row.text as string | null) ?? null,
    mime: (row.mime as string | null) ?? null,
    size: (row.size as number | null) ?? null,
    created_at: row.created_at as string,
  };
}

/** Resolve which client owns a control row (for authorization + audit scope). */
export function controlOwnerClient(db: DB, controlRowId: number): number | undefined {
  const row = db.prepare(`SELECT client_id, control_id FROM controls WHERE id = ?`).get(controlRowId) as
    | { client_id: number; control_id: string }
    | undefined;
  return row?.client_id;
}

function controlIdOf(db: DB, controlRowId: number): string {
  const row = db.prepare(`SELECT control_id FROM controls WHERE id = ?`).get(controlRowId) as
    | { control_id: string }
    | undefined;
  return row?.control_id ?? String(controlRowId);
}

/** List evidence for a control (never includes the blob bytes). */
export function listEvidence(db: DB, controlRowId: number): Evidence[] {
  const rows = db
    .prepare(
      `SELECT id, control_row_id, kind, label, url, text, mime, size, created_at
       FROM evidence WHERE control_row_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(controlRowId) as Row[];
  return rows.map(rowToEvidence);
}

export function addLinkOrNote(
  db: DB,
  controlRowId: number,
  input: EvidenceCreateInput,
): Evidence {
  const now = nowIso();
  const clientId = controlOwnerClient(db, controlRowId);
  const res = db
    .prepare(
      `INSERT INTO evidence (control_row_id, kind, label, url, text, created_at)
       VALUES (@control_row_id, @kind, @label, @url, @text, @now)`,
    )
    .run({
      control_row_id: controlRowId,
      kind: input.kind,
      label: input.label,
      url: input.kind === 'link' ? input.url : null,
      text: input.kind === 'note' ? input.text : null,
      now,
    });
  recordAudit(db, {
    action: 'create',
    entity: 'evidence',
    entity_id: Number(res.lastInsertRowid),
    client_id: clientId ?? null,
    summary: `Added ${input.kind} evidence "${input.label}" to ${controlIdOf(db, controlRowId)}`,
    after: {
      kind: input.kind,
      label: input.label,
      url: input.kind === 'link' ? input.url : null,
      text: input.kind === 'note' ? input.text : null,
      control: controlIdOf(db, controlRowId),
    },
  });
  return getEvidence(db, Number(res.lastInsertRowid))!;
}

export function addFile(
  db: DB,
  controlRowId: number,
  file: { label: string; buffer: Buffer; mime: string },
): Evidence {
  const now = nowIso();
  const clientId = controlOwnerClient(db, controlRowId);
  const res = db
    .prepare(
      `INSERT INTO evidence (control_row_id, kind, label, blob, mime, size, created_at)
       VALUES (@control_row_id, 'file', @label, @blob, @mime, @size, @now)`,
    )
    .run({
      control_row_id: controlRowId,
      label: file.label,
      blob: file.buffer,
      mime: file.mime,
      size: file.buffer.length,
      now,
    });
  recordAudit(db, {
    action: 'create',
    entity: 'evidence',
    entity_id: Number(res.lastInsertRowid),
    client_id: clientId ?? null,
    summary: `Uploaded file "${file.label}" (${file.buffer.length} bytes) to ${controlIdOf(db, controlRowId)}`,
    after: {
      kind: 'file',
      label: file.label,
      mime: file.mime,
      size: file.buffer.length,
      control: controlIdOf(db, controlRowId),
    },
  });
  return getEvidence(db, Number(res.lastInsertRowid))!;
}

export function getEvidence(db: DB, id: number): Evidence | undefined {
  const row = db
    .prepare(
      `SELECT id, control_row_id, kind, label, url, text, mime, size, created_at FROM evidence WHERE id = ?`,
    )
    .get(id) as Row | undefined;
  return row ? rowToEvidence(row) : undefined;
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

export function deleteEvidence(db: DB, id: number): boolean {
  const existing = getEvidence(db, id);
  if (!existing) return false;
  const clientId = controlOwnerClient(db, existing.control_row_id);
  db.prepare(`DELETE FROM evidence WHERE id = ?`).run(id);
  recordAudit(db, {
    action: 'delete',
    entity: 'evidence',
    entity_id: id,
    client_id: clientId ?? null,
    summary: `Deleted ${existing.kind} evidence "${existing.label}"`,
    before: {
      kind: existing.kind,
      label: existing.label,
      url: existing.url,
      mime: existing.mime,
      size: existing.size,
    },
  });
  return true;
}
