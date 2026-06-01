import type { DB } from './crypto-db';
import type {
  ControlTemplate,
  ControlTemplateItem,
  TemplateCreateInput,
  TemplateUpdateInput,
  TemplateApplyInput,
} from '@aegis/shared';
import { recordAudit } from './audit';
import { updateControl } from './controls';
import { nowIso } from '../util/now';

type Row = Record<string, unknown>;

function rowToTemplate(row: Row): ControlTemplate {
  return {
    id: row.id as number,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    item_count: (row.item_count as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToItem(row: Row): ControlTemplateItem {
  return {
    control_id: row.control_id as string,
    applicable: (row.applicable as number) === 1,
    applicability_justification: (row.applicability_justification as string | null) ?? null,
  };
}

const SELECT_WITH_COUNT = `
  SELECT t.*, (SELECT count(*) FROM template_items i WHERE i.template_id = t.id) AS item_count
  FROM templates t
`;

/** All templates, newest first, with their item counts. */
export function listTemplates(db: DB): ControlTemplate[] {
  const rows = db.prepare(`${SELECT_WITH_COUNT} ORDER BY t.name COLLATE NOCASE ASC`).all() as Row[];
  return rows.map(rowToTemplate);
}

/** A template by id (without its items). */
export function getTemplate(db: DB, id: number): ControlTemplate | undefined {
  const row = db.prepare(`${SELECT_WITH_COUNT} WHERE t.id = ?`).get(id) as Row | undefined;
  return row ? rowToTemplate(row) : undefined;
}

/** Look up a template by name (used to return a friendly 409 on duplicates). */
export function getTemplateByName(db: DB, name: string): ControlTemplate | undefined {
  const row = db
    .prepare(`${SELECT_WITH_COUNT} WHERE t.name = ? COLLATE NOCASE`)
    .get(name) as Row | undefined;
  return row ? rowToTemplate(row) : undefined;
}

/** The stored applicability decisions for a template, ordered by control id. */
export function getTemplateItems(db: DB, templateId: number): ControlTemplateItem[] {
  const rows = db
    .prepare(
      `SELECT control_id, applicable, applicability_justification
       FROM template_items WHERE template_id = ?
       ORDER BY length(control_id) ASC, control_id ASC`,
    )
    .all(templateId) as Row[];
  return rows.map(rowToItem);
}

/** A template with its items populated. */
export function getTemplateWithItems(db: DB, id: number): ControlTemplate | undefined {
  const template = getTemplate(db, id);
  if (!template) return undefined;
  return { ...template, items: getTemplateItems(db, id) };
}

/**
 * Create a template by snapshotting an engagement's applicability decisions
 * (applicable + justification per control). Returns undefined if the source
 * engagement doesn't exist. Throws on a duplicate name (UNIQUE constraint) —
 * the route checks for that first to return a clean 409.
 */
export function createTemplate(db: DB, input: TemplateCreateInput): ControlTemplate | undefined {
  const source = db
    .prepare(
      `SELECT control_id, applicable, applicability_justification
       FROM controls WHERE client_id = ?`,
    )
    .all(input.from_client_id) as Row[];
  if (source.length === 0) return undefined; // no such engagement (or it has no controls)

  const now = nowIso();
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO templates (name, description, created_at, updated_at)
         VALUES (@name, @description, @now, @now)`,
      )
      .run({ name: input.name, description: input.description ?? null, now });
    const templateId = Number(res.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO template_items (template_id, control_id, applicable, applicability_justification)
       VALUES (@template_id, @control_id, @applicable, @justification)`,
    );
    for (const c of source) {
      insItem.run({
        template_id: templateId,
        control_id: c.control_id as string,
        applicable: (c.applicable as number) === 1 ? 1 : 0,
        justification: (c.applicability_justification as string | null) ?? null,
      });
    }

    recordAudit(db, {
      action: 'create',
      entity: 'template',
      entity_id: templateId,
      client_id: null,
      summary: `Created control template "${input.name}" (${source.length} controls)`,
      after: { name: input.name, description: input.description ?? null, item_count: source.length },
    });
    return templateId;
  });
  return getTemplate(db, tx());
}

/** Rename / re-describe a template. */
export function updateTemplate(
  db: DB,
  id: number,
  input: TemplateUpdateInput,
): ControlTemplate | undefined {
  const existing = getTemplate(db, id);
  if (!existing) return undefined;
  const next = {
    name: input.name ?? existing.name,
    description: 'description' in input ? (input.description ?? null) : existing.description,
    now: nowIso(),
    id,
  };
  db.prepare(
    `UPDATE templates SET name = @name, description = @description, updated_at = @now WHERE id = @id`,
  ).run(next);
  recordAudit(db, {
    action: 'update',
    entity: 'template',
    entity_id: id,
    client_id: null,
    summary: `Updated control template "${next.name}"`,
    before: { name: existing.name, description: existing.description },
    after: { name: next.name, description: next.description },
  });
  return getTemplate(db, id);
}

/** Delete a template (cascades its items). */
export function deleteTemplate(db: DB, id: number): boolean {
  const existing = getTemplate(db, id);
  if (!existing) return false;
  db.prepare(`DELETE FROM templates WHERE id = ?`).run(id);
  recordAudit(db, {
    action: 'delete',
    entity: 'template',
    entity_id: id,
    client_id: null,
    summary: `Deleted control template "${existing.name}"`,
    before: { name: existing.name, item_count: existing.item_count },
  });
  return true;
}

/**
 * Apply a template's applicability decisions to an engagement, matching by
 * control_id. Each control that actually changes is audited individually (via
 * updateControl); a single summary entry records the apply itself. Optionally
 * scope to one Annex A theme. Returns undefined if the template doesn't exist.
 */
export function applyTemplate(
  db: DB,
  clientId: number,
  templateId: number,
  opts: TemplateApplyInput = {},
): { applied: number } | undefined {
  const template = getTemplate(db, templateId);
  if (!template) return undefined;
  const items = getTemplateItems(db, templateId);

  const tx = db.transaction(() => {
    let applied = 0;
    for (const item of items) {
      const row = db
        .prepare(
          `SELECT id FROM controls WHERE client_id = @client_id AND control_id = @control_id
           ${opts.theme ? 'AND theme_id = @theme' : ''}`,
        )
        .get({ client_id: clientId, control_id: item.control_id, theme: opts.theme }) as
        | { id: number }
        | undefined;
      if (!row) continue;
      updateControl(db, clientId, row.id, {
        applicable: item.applicable,
        applicability_justification: item.applicability_justification,
      });
      applied++;
    }
    recordAudit(db, {
      action: 'apply',
      entity: 'template',
      entity_id: templateId,
      client_id: clientId,
      summary: `Applied control template "${template.name}"${
        opts.theme ? ` (theme ${opts.theme})` : ''
      } — ${applied} controls`,
      after: { template_id: templateId, theme: opts.theme ?? null, applied },
    });
    return applied;
  });

  return { applied: tx() };
}
