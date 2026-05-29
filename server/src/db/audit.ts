import type { DB } from './crypto-db';
import type { AuditEntry, AuditListQuery, AuditPage } from '@aegis/shared';
import { nowIso } from '../util/now';
import { currentAuditScope } from '../auth/audit-context';

export interface AuditInput {
  action: string;
  entity: string;
  entity_id?: string | number | null;
  client_id?: number | null;
  summary: string;
  /** Changed fields' prior values (serialized to JSON), or null. */
  before?: Record<string, unknown> | null;
  /** Changed fields' new values (serialized to JSON), or null. */
  after?: Record<string, unknown> | null;
}

function toJson(value: Record<string, unknown> | null | undefined): string | null {
  if (value == null || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

/**
 * Append a row to the immutable audit log. The `ip` and `actor` are pulled from
 * the request-scoped audit context (see auth/audit-context.ts) so callers in the
 * data layer don't have to thread them through.
 */
export function recordAudit(db: DB, input: AuditInput): void {
  const { ip, actor } = currentAuditScope();
  db.prepare(
    `INSERT INTO audit_log (at, action, entity, entity_id, client_id, summary, before, after, ip, actor)
     VALUES (@at, @action, @entity, @entity_id, @client_id, @summary, @before, @after, @ip, @actor)`,
  ).run({
    at: nowIso(),
    action: input.action,
    entity: input.entity,
    entity_id: input.entity_id == null ? null : String(input.entity_id),
    client_id: input.client_id ?? null,
    summary: input.summary,
    before: toJson(input.before),
    after: toJson(input.after),
    ip,
    actor,
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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Paged + filterable view of the audit trail. When `clientId` is provided the
 * trail is scoped to that engagement; otherwise it spans all engagements.
 */
export function listAudit(
  db: DB,
  query: AuditListQuery,
  clientId?: number,
): AuditPage {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = query.offset ?? 0;

  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (clientId != null) {
    where.push('client_id = @client_id');
    params.client_id = clientId;
  }
  if (query.action) {
    where.push('action = @action');
    params.action = query.action;
  }
  if (query.entity) {
    where.push('entity = @entity');
    params.entity = query.entity;
  }
  if (query.entity_id) {
    where.push('entity_id = @entity_id');
    params.entity_id = query.entity_id;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT count(*) AS n FROM audit_log ${whereSql}`).get(params) as { n: number }
  ).n;

  const entries = db
    .prepare(
      `SELECT * FROM audit_log ${whereSql} ORDER BY at DESC, id DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as AuditEntry[];

  return { entries, total, limit, offset };
}

/** Every audit row (oldest → newest) for a full-trail export. */
export function allAudit(db: DB, clientId?: number): AuditEntry[] {
  if (clientId != null) {
    return db
      .prepare(`SELECT * FROM audit_log WHERE client_id = ? ORDER BY at ASC, id ASC`)
      .all(clientId) as AuditEntry[];
  }
  return db.prepare(`SELECT * FROM audit_log ORDER BY at ASC, id ASC`).all() as AuditEntry[];
}
