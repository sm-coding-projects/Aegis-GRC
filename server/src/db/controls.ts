import type { DB } from './crypto-db';
import type { ControlRow, ControlListQuery, ControlUpdateInput } from '@aegis/shared';
import { recordAudit } from './audit';
import { nowIso, todayIso } from '../util/now';

type Row = Record<string, unknown>;

function rowToControl(row: Row, today: string): ControlRow {
  const status = row.status as ControlRow['status'];
  const applicable = (row.applicable as number) === 1;
  const due = (row.due_date as string | null) ?? null;
  const overdue =
    applicable && status !== 'implemented' && due != null && due < today;
  return {
    id: row.id as number,
    client_id: row.client_id as number,
    control_id: row.control_id as string,
    theme_id: row.theme_id as ControlRow['theme_id'],
    theme: row.theme as string,
    title: row.title as string,
    applicable,
    applicability_justification: (row.applicability_justification as string | null) ?? null,
    status,
    owner: (row.owner as string | null) ?? null,
    due_date: due,
    last_reviewed: (row.last_reviewed as string | null) ?? null,
    implementation_notes: (row.implementation_notes as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    overdue,
    evidence_count: (row.evidence_count as number) ?? 0,
  };
}

const SELECT_WITH_EVIDENCE = `
  SELECT c.*, (SELECT count(*) FROM evidence_links l WHERE l.control_row_id = c.id) AS evidence_count
  FROM controls c
`;

/** List a client's controls with optional filters, grouped/sorted by theme. */
export function listControls(db: DB, clientId: number, query: ControlListQuery): ControlRow[] {
  const today = todayIso();
  const where: string[] = ['c.client_id = @client_id'];
  const params: Record<string, unknown> = { client_id: clientId };

  if (query.theme) {
    where.push('c.theme_id = @theme');
    params.theme = query.theme;
  }
  if (query.status) {
    where.push('c.status = @status');
    params.status = query.status;
  }
  if (query.owner) {
    where.push('c.owner = @owner');
    params.owner = query.owner;
  }
  if (query.applicable !== undefined) {
    where.push('c.applicable = @applicable');
    params.applicable = query.applicable ? 1 : 0;
  }
  if (query.overdue) {
    where.push(
      `c.applicable = 1 AND c.status != 'implemented' AND c.due_date IS NOT NULL AND c.due_date < @today`,
    );
    params.today = today;
  }
  if (query.search) {
    where.push('(c.title LIKE @search OR c.control_id LIKE @search)');
    params.search = `%${query.search}%`;
  }

  const sql = `${SELECT_WITH_EVIDENCE}
    WHERE ${where.join(' AND ')}
    ORDER BY c.theme_id ASC, length(c.control_id) ASC, c.control_id ASC`;
  const rows = db.prepare(sql).all(params) as Row[];
  return rows.map((r) => rowToControl(r, today));
}

export function getControl(db: DB, clientId: number, controlRowId: number): ControlRow | undefined {
  const row = db
    .prepare(`${SELECT_WITH_EVIDENCE} WHERE c.id = @id AND c.client_id = @client_id`)
    .get({ id: controlRowId, client_id: clientId }) as Row | undefined;
  return row ? rowToControl(row, todayIso()) : undefined;
}

const UPDATABLE: (keyof ControlUpdateInput)[] = [
  'applicable',
  'applicability_justification',
  'status',
  'owner',
  'due_date',
  'last_reviewed',
  'implementation_notes',
];

/** Apply a partial update to a control row, recording an audit entry. */
export function updateControl(
  db: DB,
  clientId: number,
  controlRowId: number,
  patch: ControlUpdateInput,
): ControlRow | undefined {
  const existing = getControl(db, clientId, controlRowId);
  if (!existing) return undefined;

  const sets: string[] = [];
  const params: Record<string, unknown> = { id: controlRowId, now: nowIso() };
  // Field-level diff for the audit trail: only fields whose value actually changed.
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const existingRecord = existing as unknown as Record<string, unknown>;
  for (const key of UPDATABLE) {
    if (key in patch && patch[key] !== undefined) {
      const newValue = (patch[key] ?? null) as unknown;
      const oldValue = existingRecord[key] ?? null;
      if (oldValue === newValue) continue; // no-op field, don't log it
      let stored: unknown = newValue;
      if (key === 'applicable') stored = newValue ? 1 : 0;
      sets.push(`${key} = @${key}`);
      params[key] = stored;
      before[key] = oldValue;
      after[key] = newValue;
    }
  }
  if (sets.length === 0) return existing;

  db.prepare(`UPDATE controls SET ${sets.join(', ')}, updated_at = @now WHERE id = @id`).run(params);

  const changes = Object.keys(after).join(', ');
  recordAudit(db, {
    action: 'update',
    entity: 'control',
    entity_id: existing.control_id,
    client_id: clientId,
    summary: `Updated ${existing.control_id} (${changes})`,
    before,
    after,
  });

  return getControl(db, clientId, controlRowId);
}

/** Distinct owners for a client (for the controls table owner filter). */
export function listOwners(db: DB, clientId: number): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT owner FROM controls WHERE client_id = ? AND owner IS NOT NULL AND owner != '' ORDER BY owner COLLATE NOCASE`,
    )
    .all(clientId) as { owner: string }[];
  return rows.map((r) => r.owner);
}
