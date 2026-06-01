import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  clientCreateSchema,
  clientUpdateSchema,
  controlUpdateSchema,
  controlListQuerySchema,
  bulkControlUpdateSchema,
  templateCreateSchema,
  templateUpdateSchema,
  templateApplySchema,
  evidenceCreateSchema,
  evidenceUpdateSchema,
  evidenceLinkControlSchema,
  evidenceListQuerySchema,
  auditListQuerySchema,
} from '@aegis/shared';
import type { AppContext } from '../auth/context';
import { config } from '../config';
import {
  createClient,
  listClients,
  getClient,
  updateClient,
  deleteClient,
} from '../db/clients';
import {
  listControls,
  getControl,
  updateControl,
  bulkUpdateControls,
  listOwners,
} from '../db/controls';
import {
  listTemplates,
  getTemplate,
  getTemplateByName,
  getTemplateWithItems,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
} from '../db/templates';
import {
  listLibrary,
  getEvidenceForClient,
  listForControl,
  listTags,
  createLinkOrNote,
  createFile,
  updateEvidence,
  deleteEvidence,
  linkControl,
  unlinkControl,
  getEvidenceBlob,
} from '../db/evidence';
import { dashboardSummary } from '../db/dashboard';
import { recordAudit, listAudit, allAudit } from '../db/audit';
import { checkpoint } from '../db/crypto-db';
import { controlsToCsv, auditToCsv } from '../util/csv';
import { todayIso } from '../util/now';

function badRequest(res: Response, details?: unknown): void {
  res.status(400).json({ error: 'Invalid input', details });
}

function intParam(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function makeApiRouter(ctx: AppContext): Router {
  const router = Router();

  const evidenceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxEvidenceBytes, files: 1 },
  });

  /* -------------------------------- Clients ------------------------------- */

  router.get('/clients', (req: Request, res: Response) => {
    res.json(listClients(req.db!));
  });

  router.post('/clients', (req: Request, res: Response) => {
    const parsed = clientCreateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const client = createClient(req.db!, parsed.data);
    res.status(201).json(client);
  });

  router.get('/clients/:clientId', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    const client = getClient(req.db!, id);
    if (!client) return void res.status(404).json({ error: 'Client not found' });
    res.json(client);
  });

  router.patch('/clients/:clientId', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    const parsed = clientUpdateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const client = updateClient(req.db!, id, parsed.data);
    if (!client) return void res.status(404).json({ error: 'Client not found' });
    res.json(client);
  });

  router.delete('/clients/:clientId', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    if (!deleteClient(req.db!, id)) return void res.status(404).json({ error: 'Client not found' });
    res.json({ ok: true });
  });

  /* -------------------------------- Controls ------------------------------ */

  router.get('/clients/:clientId/controls', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    if (!getClient(req.db!, id)) return void res.status(404).json({ error: 'Client not found' });
    const parsed = controlListQuerySchema.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    res.json(listControls(req.db!, id, parsed.data));
  });

  router.get('/clients/:clientId/controls/owners', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    res.json(listOwners(req.db!, id));
  });

  // Bulk-edit many control rows at once (registered BEFORE the :controlRowId
  // route so "bulk" isn't mistaken for a row id).
  router.patch('/clients/:clientId/controls/bulk', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    if (!getClient(req.db!, id)) return void res.status(404).json({ error: 'Client not found' });
    const parsed = bulkControlUpdateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const controls = bulkUpdateControls(req.db!, id, parsed.data.control_row_ids, parsed.data.patch);
    res.json({ updated: controls.length, controls });
  });

  router.get('/clients/:clientId/controls/:controlRowId', (req: Request, res: Response) => {
    const clientId = intParam(req.params.clientId);
    const controlRowId = intParam(req.params.controlRowId);
    if (!clientId || !controlRowId) return badRequest(res);
    const control = getControl(req.db!, clientId, controlRowId);
    if (!control) return void res.status(404).json({ error: 'Control not found' });
    res.json(control);
  });

  router.patch('/clients/:clientId/controls/:controlRowId', (req: Request, res: Response) => {
    const clientId = intParam(req.params.clientId);
    const controlRowId = intParam(req.params.controlRowId);
    if (!clientId || !controlRowId) return badRequest(res);
    const parsed = controlUpdateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const control = updateControl(req.db!, clientId, controlRowId, parsed.data);
    if (!control) return void res.status(404).json({ error: 'Control not found' });
    res.json(control);
  });

  /* --------------------------- Control templates -------------------------- */

  // List all templates (global, with item counts).
  router.get('/templates', (req: Request, res: Response) => {
    res.json(listTemplates(req.db!));
  });

  // Create a template by snapshotting an engagement's applicability decisions.
  router.post('/templates', (req: Request, res: Response) => {
    const parsed = templateCreateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    if (!getClient(req.db!, parsed.data.from_client_id))
      return void res.status(404).json({ error: 'Source engagement not found' });
    if (getTemplateByName(req.db!, parsed.data.name))
      return void res.status(409).json({ error: 'A template with that name already exists' });
    const template = createTemplate(req.db!, parsed.data);
    if (!template) return void res.status(404).json({ error: 'Source engagement not found' });
    res.status(201).json(template);
  });

  // One template, including its stored per-control decisions.
  router.get('/templates/:templateId', (req: Request, res: Response) => {
    const id = intParam(req.params.templateId);
    if (!id) return badRequest(res);
    const template = getTemplateWithItems(req.db!, id);
    if (!template) return void res.status(404).json({ error: 'Template not found' });
    res.json(template);
  });

  // Rename / re-describe a template.
  router.patch('/templates/:templateId', (req: Request, res: Response) => {
    const id = intParam(req.params.templateId);
    if (!id) return badRequest(res);
    const parsed = templateUpdateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    if (!getTemplate(req.db!, id)) return void res.status(404).json({ error: 'Template not found' });
    if (parsed.data.name) {
      const clash = getTemplateByName(req.db!, parsed.data.name);
      if (clash && clash.id !== id)
        return void res.status(409).json({ error: 'A template with that name already exists' });
    }
    const template = updateTemplate(req.db!, id, parsed.data);
    res.json(template);
  });

  // Delete a template (cascades its items).
  router.delete('/templates/:templateId', (req: Request, res: Response) => {
    const id = intParam(req.params.templateId);
    if (!id) return badRequest(res);
    if (!deleteTemplate(req.db!, id))
      return void res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  });

  // Apply a template's decisions to an engagement (optionally one theme).
  router.post(
    '/clients/:clientId/templates/:templateId/apply',
    (req: Request, res: Response) => {
      const clientId = intParam(req.params.clientId);
      const templateId = intParam(req.params.templateId);
      if (!clientId || !templateId) return badRequest(res);
      if (!getClient(req.db!, clientId))
        return void res.status(404).json({ error: 'Client not found' });
      const parsed = templateApplySchema.safeParse(req.body ?? {});
      if (!parsed.success) return badRequest(res, parsed.error.flatten());
      const result = applyTemplate(req.db!, clientId, templateId, parsed.data);
      if (!result) return void res.status(404).json({ error: 'Template not found' });
      res.json(result);
    },
  );

  /* --------------------------- Evidence library --------------------------- */

  // Guard: the named client must exist; returns its id or null (after responding).
  function resolveClient(req: Request, res: Response): number | null {
    const id = intParam(req.params.clientId);
    if (!id) {
      badRequest(res);
      return null;
    }
    if (!getClient(req.db!, id)) {
      res.status(404).json({ error: 'Client not found' });
      return null;
    }
    return id;
  }

  // Guard: the control row must exist and belong to the named client.
  function resolveControl(req: Request, res: Response): { clientId: number; controlRowId: number } | null {
    const clientId = intParam(req.params.clientId);
    const controlRowId = intParam(req.params.controlRowId);
    if (!clientId || !controlRowId) {
      badRequest(res);
      return null;
    }
    if (!getControl(req.db!, clientId, controlRowId)) {
      res.status(404).json({ error: 'Control not found' });
      return null;
    }
    return { clientId, controlRowId };
  }

  /** Parse multipart text fields (tags / control_row_ids JSON, expires_at) into typed values. */
  function parseFileMeta(body: Record<string, unknown>): {
    tags?: string[];
    expires_at?: string | null;
    control_row_ids?: number[];
  } {
    const out: { tags?: string[]; expires_at?: string | null; control_row_ids?: number[] } = {};
    if (typeof body.tags === 'string' && body.tags.trim() !== '') {
      try {
        const v = JSON.parse(body.tags);
        if (Array.isArray(v)) out.tags = v.filter((x) => typeof x === 'string').slice(0, 20);
      } catch {
        /* ignore malformed tags */
      }
    }
    if (typeof body.expires_at === 'string' && body.expires_at.trim() !== '') {
      out.expires_at = body.expires_at.trim();
    }
    if (typeof body.control_row_ids === 'string' && body.control_row_ids.trim() !== '') {
      try {
        const v = JSON.parse(body.control_row_ids);
        if (Array.isArray(v)) out.control_row_ids = v.filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  // List the engagement's library (search / tag / kind / status filters).
  router.get('/clients/:clientId/evidence', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    const parsed = evidenceListQuerySchema.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    res.json(listLibrary(req.db!, id, parsed.data));
  });

  // Distinct tags in this library (for the filter dropdown).
  router.get('/clients/:clientId/evidence/tags', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    res.json(listTags(req.db!, id));
  });

  // Create a link/note library item (optionally pre-linked via control_row_ids).
  router.post('/clients/:clientId/evidence', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    const parsed = evidenceCreateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    res.status(201).json(createLinkOrNote(req.db!, id, parsed.data));
  });

  // Upload a file into the library (blob stored in the encrypted DB).
  router.post(
    '/clients/:clientId/evidence/file',
    evidenceUpload.single('file'),
    (req: Request, res: Response) => {
      const id = resolveClient(req, res);
      if (!id) return;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file || file.size === 0) return badRequest(res, 'No file uploaded');
      const label =
        typeof req.body.label === 'string' && req.body.label.trim() !== ''
          ? req.body.label.trim().slice(0, 200)
          : file.originalname.slice(0, 200);
      const meta = parseFileMeta(req.body);
      res.status(201).json(
        createFile(req.db!, id, {
          label,
          buffer: file.buffer,
          mime: file.mimetype || 'application/octet-stream',
          ...meta,
        }),
      );
    },
  );

  // A single library item with its linked controls.
  router.get('/clients/:clientId/evidence/:eid', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    const eid = intParam(req.params.eid);
    if (!eid) return badRequest(res);
    const ev = getEvidenceForClient(req.db!, id, eid);
    if (!ev) return void res.status(404).json({ error: 'Evidence not found' });
    res.json(ev);
  });

  // Update (rename / retag / refresh expiry).
  router.patch('/clients/:clientId/evidence/:eid', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    const eid = intParam(req.params.eid);
    if (!eid) return badRequest(res);
    const parsed = evidenceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const ev = updateEvidence(req.db!, id, eid, parsed.data);
    if (!ev) return void res.status(404).json({ error: 'Evidence not found' });
    res.json(ev);
  });

  // Delete from the library (cascades its links).
  router.delete('/clients/:clientId/evidence/:eid', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    const eid = intParam(req.params.eid);
    if (!eid) return badRequest(res);
    if (!deleteEvidence(req.db!, id, eid))
      return void res.status(404).json({ error: 'Evidence not found' });
    res.json({ ok: true });
  });

  // Link an existing library item to a control row.
  router.post('/clients/:clientId/evidence/:eid/links', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    const eid = intParam(req.params.eid);
    if (!eid) return badRequest(res);
    const parsed = evidenceLinkControlSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const ev = linkControl(req.db!, id, eid, parsed.data.control_row_id);
    if (!ev) return void res.status(404).json({ error: 'Evidence or control not found' });
    res.json(ev);
  });

  // Unlink a library item from a control row (the item stays in the library).
  router.delete('/clients/:clientId/evidence/:eid/links/:rowId', (req: Request, res: Response) => {
    const id = resolveClient(req, res);
    if (!id) return;
    const eid = intParam(req.params.eid);
    const rowId = intParam(req.params.rowId);
    if (!eid || !rowId) return badRequest(res);
    const ev = unlinkControl(req.db!, id, eid, rowId);
    if (!ev) return void res.status(404).json({ error: 'Evidence not found' });
    res.json(ev);
  });

  /* ----------------------- Evidence linked to a control ------------------- */

  router.get(
    '/clients/:clientId/controls/:controlRowId/evidence',
    (req: Request, res: Response) => {
      const r = resolveControl(req, res);
      if (!r) return;
      res.json(listForControl(req.db!, r.controlRowId));
    },
  );

  // Convenience: create a link/note already linked to this control.
  router.post(
    '/clients/:clientId/controls/:controlRowId/evidence',
    (req: Request, res: Response) => {
      const r = resolveControl(req, res);
      if (!r) return;
      const parsed = evidenceCreateSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error.flatten());
      const data = { ...parsed.data, control_row_ids: [r.controlRowId] };
      res.status(201).json(createLinkOrNote(req.db!, r.clientId, data));
    },
  );

  // Convenience: upload a file already linked to this control.
  router.post(
    '/clients/:clientId/controls/:controlRowId/evidence/file',
    evidenceUpload.single('file'),
    (req: Request, res: Response) => {
      const r = resolveControl(req, res);
      if (!r) return;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file || file.size === 0) return badRequest(res, 'No file uploaded');
      const label =
        typeof req.body.label === 'string' && req.body.label.trim() !== ''
          ? req.body.label.trim().slice(0, 200)
          : file.originalname.slice(0, 200);
      const meta = parseFileMeta(req.body);
      res.status(201).json(
        createFile(req.db!, r.clientId, {
          label,
          buffer: file.buffer,
          mime: file.mimetype || 'application/octet-stream',
          ...meta,
          control_row_ids: [r.controlRowId, ...(meta.control_row_ids ?? [])],
        }),
      );
    },
  );

  /* --------------------------- Evidence download -------------------------- */

  router.get('/evidence/:id/download', (req: Request, res: Response) => {
    const id = intParam(req.params.id);
    if (!id) return badRequest(res);
    const blob = getEvidenceBlob(req.db!, id);
    if (!blob) return void res.status(404).json({ error: 'File evidence not found' });
    res.setHeader('Content-Type', blob.mime);
    // `?view=1` serves inline (for previewing in a tab); default forces download.
    const disposition = req.query.view ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${blob.label.replace(/[^\w.-]+/g, '_')}"`,
    );
    res.send(blob.blob);
  });

  /* ------------------------------- Dashboard ------------------------------ */

  router.get('/clients/:clientId/dashboard', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    if (!getClient(req.db!, id)) return void res.status(404).json({ error: 'Client not found' });
    res.json(dashboardSummary(req.db!, id));
  });

  /* --------------------------- CSV export of SoA -------------------------- */

  router.get('/clients/:clientId/export.csv', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    const client = getClient(req.db!, id);
    if (!client) return void res.status(404).json({ error: 'Client not found' });
    const csv = controlsToCsv(listControls(req.db!, id, {}));
    const safeName = client.name.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="SoA-${safeName}-${todayIso()}.csv"`,
    );
    recordAudit(req.db!, {
      action: 'export',
      entity: 'client',
      entity_id: id,
      client_id: id,
      summary: `Exported SoA CSV for "${client.name}"`,
    });
    res.send(csv);
  });

  /* ------------------------------ Audit trail ----------------------------- */

  // Shared helpers so the per-client and global trail behave identically.
  function sendAuditExport(
    req: Request,
    res: Response,
    clientId: number | undefined,
    format: 'csv' | 'json',
    filenameStem: string,
  ): void {
    const entries = allAudit(req.db!, clientId);
    recordAudit(req.db!, {
      action: 'export',
      entity: 'audit',
      entity_id: clientId ?? null,
      client_id: clientId ?? null,
      summary: `Exported audit trail (${format.toUpperCase()}${
        clientId ? `, client ${clientId}` : ', all engagements'
      })`,
    });
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameStem}-${todayIso()}.csv"`);
      res.send(auditToCsv(entries));
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameStem}-${todayIso()}.json"`);
      res.send(JSON.stringify({ exported_at: new Date().toISOString(), entries }, null, 2));
    }
  }

  // Global trail (all engagements) — export routes registered before the list.
  router.get('/audit/export.csv', (req: Request, res: Response) => {
    sendAuditExport(req, res, undefined, 'csv', 'audit-trail');
  });
  router.get('/audit/export.json', (req: Request, res: Response) => {
    sendAuditExport(req, res, undefined, 'json', 'audit-trail');
  });
  router.get('/audit', (req: Request, res: Response) => {
    const parsed = auditListQuerySchema.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    res.json(listAudit(req.db!, parsed.data));
  });

  // Per-client trail.
  router.get('/clients/:clientId/audit/export.csv', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    const client = getClient(req.db!, id);
    if (!client) return void res.status(404).json({ error: 'Client not found' });
    sendAuditExport(req, res, id, 'csv', `audit-${client.name.replace(/[^\w.-]+/g, '_')}`);
  });
  router.get('/clients/:clientId/audit/export.json', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    const client = getClient(req.db!, id);
    if (!client) return void res.status(404).json({ error: 'Client not found' });
    sendAuditExport(req, res, id, 'json', `audit-${client.name.replace(/[^\w.-]+/g, '_')}`);
  });
  router.get('/clients/:clientId/audit', (req: Request, res: Response) => {
    const id = intParam(req.params.clientId);
    if (!id) return badRequest(res);
    if (!getClient(req.db!, id)) return void res.status(404).json({ error: 'Client not found' });
    const parsed = auditListQuerySchema.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    res.json(listAudit(req.db!, parsed.data, id));
  });

  /* --------------------------- Encrypted backup --------------------------- */

  router.get('/backup', (req: Request, res: Response) => {
    // Record the export first so it is flushed into the checkpointed file...
    recordAudit(req.db!, {
      action: 'backup',
      entity: 'database',
      entity_id: null,
      client_id: null,
      summary: 'Downloaded encrypted database backup',
    });
    // ...then checkpoint the WAL into the main file for a self-contained copy.
    checkpoint(req.db!);
    res.download(ctx.opts.dbPath, `aegis-backup-${todayIso()}.db`, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: 'Backup failed' });
    });
  });

  return router;
}
