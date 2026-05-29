import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  clientCreateSchema,
  clientUpdateSchema,
  controlUpdateSchema,
  controlListQuerySchema,
  evidenceCreateSchema,
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
import { listControls, getControl, updateControl, listOwners } from '../db/controls';
import {
  listEvidence,
  addLinkOrNote,
  addFile,
  getEvidenceBlob,
  deleteEvidence,
} from '../db/evidence';
import { dashboardSummary } from '../db/dashboard';
import { recordAudit } from '../db/audit';
import { checkpoint } from '../db/crypto-db';
import { controlsToCsv } from '../util/csv';
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

  /* -------------------------------- Evidence ------------------------------ */

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

  router.get(
    '/clients/:clientId/controls/:controlRowId/evidence',
    (req: Request, res: Response) => {
      const r = resolveControl(req, res);
      if (!r) return;
      res.json(listEvidence(req.db!, r.controlRowId));
    },
  );

  router.post(
    '/clients/:clientId/controls/:controlRowId/evidence',
    (req: Request, res: Response) => {
      const r = resolveControl(req, res);
      if (!r) return;
      const parsed = evidenceCreateSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error.flatten());
      res.status(201).json(addLinkOrNote(req.db!, r.controlRowId, parsed.data));
    },
  );

  router.post(
    '/clients/:clientId/controls/:controlRowId/evidence/file',
    evidenceUpload.single('file'),
    (req: Request, res: Response) => {
      const r = resolveControl(req, res);
      if (!r) return;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file || file.size === 0) return badRequest(res, 'No file uploaded');
      const label = typeof req.body.label === 'string' && req.body.label.trim() !== ''
        ? req.body.label.trim().slice(0, 200)
        : file.originalname.slice(0, 200);
      const ev = addFile(req.db!, r.controlRowId, {
        label,
        buffer: file.buffer,
        mime: file.mimetype || 'application/octet-stream',
      });
      res.status(201).json(ev);
    },
  );

  router.get('/evidence/:id/download', (req: Request, res: Response) => {
    const id = intParam(req.params.id);
    if (!id) return badRequest(res);
    const blob = getEvidenceBlob(req.db!, id);
    if (!blob) return void res.status(404).json({ error: 'File evidence not found' });
    res.setHeader('Content-Type', blob.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${blob.label.replace(/[^\w.-]+/g, '_')}"`,
    );
    res.send(blob.blob);
  });

  router.delete('/evidence/:id', (req: Request, res: Response) => {
    const id = intParam(req.params.id);
    if (!id) return badRequest(res);
    if (!deleteEvidence(req.db!, id)) return void res.status(404).json({ error: 'Evidence not found' });
    res.json({ ok: true });
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
