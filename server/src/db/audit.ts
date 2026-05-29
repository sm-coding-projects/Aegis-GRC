import type { DB } from './crypto-db';
import type { AuditEntry } from '@aegis/shared';
import { nowIso } from '../util/now';

export interface AuditInput {
  action: string;
  entity: string;
  entity_id?: string | number | null;
  client_id?: number | null;
  summary: string;
}

/** Append a row to the (append-only) audit log. */
export function recordAudit(db: DB, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (at, action, entity, entity_id, client_id, summary)
     VALUES (@at, @action, @entity, @entity_id, @client_id, @summary)`,
  ).run({
    at: nowIso(),
    action: input.action,
    entity: input.entity,
    entity_id: input.entity_id == null ? null : String(input.entity_id),
    client_id: input.client_id ?? null,
    summary: input.summary,
  });
}

/** Most recent audit entries, optionally scoped to a client. */
export function recentAudit(db: DB, limit = 10, clientId?: number): AuditEntry[] {
  if (clientId != null) {
    return db
      .prepare(`SELECT * FROM audit_log WHERE client_id = ? ORDER BY at DESC, id DESC LIMIT ?`)
      .all(clientId, limit) as AuditEntry[];
  }
  return db
    .prepare(`SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?`)
    .all(limit) as AuditEntry[];
}
