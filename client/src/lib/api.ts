/**
 * Typed API client. All requests are same-origin with credentials (the session
 * cookie). Mutations attach the per-session CSRF token via the X-CSRF-Token
 * header; bootstrap auth calls (create/unlock/restore) attach X-Requested-With.
 *
 * The CSRF token is held in module memory after unlock/create and refreshed
 * from GET /api/auth/status on load.
 */
import { CSRF_HEADER } from '@aegis/shared';
import type {
  AuthState,
  Client,
  ClientCreateInput,
  ClientUpdateInput,
  ControlRow,
  ControlUpdateInput,
  BulkControlUpdateInput,
  BulkUpdateResult,
  ControlTemplate,
  TemplateCreateInput,
  TemplateUpdateInput,
  TemplateApplyInput,
  TemplateApplyResult,
  Evidence,
  EvidenceCreateInput,
  EvidenceUpdateInput,
  EvidenceListQuery,
  DashboardSummary,
  AuditPage,
} from '@aegis/shared';

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}
export function getCsrfToken(): string | null {
  return csrfToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send the bootstrap header instead of the CSRF token (create/unlock). */
  bootstrap?: boolean;
  /** Raw FormData (file upload); skips JSON serialization. */
  form?: FormData;
}

async function req<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  const isMutation = method !== 'GET';

  if (isMutation) {
    if (opts.bootstrap) headers['X-Requested-With'] = 'XMLHttpRequest';
    else if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  }

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form; // browser sets multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, (payload as { details?: unknown })?.details);
  }

  return payload as T;
}

/* --------------------------------- Auth ---------------------------------- */

export const authApi = {
  status: () => req<AuthState & { csrfToken?: string }>('/api/auth/status'),
  create: (password: string) =>
    req<{ ok: true; csrfToken: string }>('/api/auth/create', {
      method: 'POST',
      body: { password },
      bootstrap: true,
    }),
  unlock: (password: string) =>
    req<{ ok: true; csrfToken: string }>('/api/auth/unlock', {
      method: 'POST',
      body: { password },
      bootstrap: true,
    }),
  restore: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return req<{ ok: true }>('/api/auth/restore', { method: 'POST', form, bootstrap: true });
  },
  logout: () => req<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: true; relock: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
};

/* -------------------------------- Clients -------------------------------- */

export const clientsApi = {
  list: () => req<Client[]>('/api/clients'),
  get: (id: number) => req<Client>(`/api/clients/${id}`),
  create: (input: ClientCreateInput) =>
    req<Client>('/api/clients', { method: 'POST', body: input }),
  update: (id: number, input: ClientUpdateInput) =>
    req<Client>(`/api/clients/${id}`, { method: 'PATCH', body: input }),
  remove: (id: number) => req<{ ok: true }>(`/api/clients/${id}`, { method: 'DELETE' }),
};

/* -------------------------------- Controls ------------------------------- */

export const controlsApi = {
  list: (clientId: number, query: Record<string, string> = {}) => {
    const qs = new URLSearchParams(query).toString();
    return req<ControlRow[]>(`/api/clients/${clientId}/controls${qs ? `?${qs}` : ''}`);
  },
  owners: (clientId: number) => req<string[]>(`/api/clients/${clientId}/controls/owners`),
  get: (clientId: number, rowId: number) =>
    req<ControlRow>(`/api/clients/${clientId}/controls/${rowId}`),
  update: (clientId: number, rowId: number, patch: ControlUpdateInput) =>
    req<ControlRow>(`/api/clients/${clientId}/controls/${rowId}`, {
      method: 'PATCH',
      body: patch,
    }),
  /** Apply one patch to many control rows at once. */
  bulkUpdate: (clientId: number, input: BulkControlUpdateInput) =>
    req<BulkUpdateResult>(`/api/clients/${clientId}/controls/bulk`, {
      method: 'PATCH',
      body: input,
    }),
};

/* ---------------------------- Control templates -------------------------- */

export const templatesApi = {
  /** All saved templates (with item counts). */
  list: () => req<ControlTemplate[]>('/api/templates'),
  /** One template, including its per-control decisions. */
  get: (id: number) => req<ControlTemplate>(`/api/templates/${id}`),
  /** Save an engagement's current applicability as a reusable template. */
  create: (input: TemplateCreateInput) =>
    req<ControlTemplate>('/api/templates', { method: 'POST', body: input }),
  /** Rename / re-describe a template. */
  update: (id: number, input: TemplateUpdateInput) =>
    req<ControlTemplate>(`/api/templates/${id}`, { method: 'PATCH', body: input }),
  /** Delete a template. */
  remove: (id: number) => req<{ ok: true }>(`/api/templates/${id}`, { method: 'DELETE' }),
  /** Apply a template's decisions to an engagement (optionally one theme). */
  apply: (clientId: number, templateId: number, input: TemplateApplyInput = {}) =>
    req<TemplateApplyResult>(`/api/clients/${clientId}/templates/${templateId}/apply`, {
      method: 'POST',
      body: input,
    }),
};

/* ---------------------------- Evidence library --------------------------- */

interface FileUploadOpts {
  label?: string;
  tags?: string[];
  expires_at?: string | null;
  control_row_ids?: number[];
}

function evidenceQs(query: EvidenceListQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.tag) params.set('tag', query.tag);
  if (query.kind) params.set('kind', query.kind);
  if (query.status) params.set('status', query.status);
  const s = params.toString();
  return s ? `?${s}` : '';
}

function evidenceFileForm(file: File, opts: FileUploadOpts): FormData {
  const form = new FormData();
  form.append('file', file);
  if (opts.label) form.append('label', opts.label);
  if (opts.tags?.length) form.append('tags', JSON.stringify(opts.tags));
  if (opts.expires_at) form.append('expires_at', opts.expires_at);
  if (opts.control_row_ids?.length)
    form.append('control_row_ids', JSON.stringify(opts.control_row_ids));
  return form;
}

export const evidenceApi = {
  /** The engagement's full evidence library (with filters). */
  library: (clientId: number, query: EvidenceListQuery = {}) =>
    req<Evidence[]>(`/api/clients/${clientId}/evidence${evidenceQs(query)}`),
  /** Distinct tags in the library (for filter dropdowns). */
  tags: (clientId: number) => req<string[]>(`/api/clients/${clientId}/evidence/tags`),
  /** One library item, including its linked controls. */
  get: (clientId: number, eid: number) =>
    req<Evidence>(`/api/clients/${clientId}/evidence/${eid}`),
  /** Evidence linked to a specific control (the control drawer view). */
  forControl: (clientId: number, rowId: number) =>
    req<Evidence[]>(`/api/clients/${clientId}/controls/${rowId}/evidence`),
  /** Create a link/note library item (optionally pre-linked). */
  create: (clientId: number, input: EvidenceCreateInput) =>
    req<Evidence>(`/api/clients/${clientId}/evidence`, { method: 'POST', body: input }),
  /** Upload a file into the library (optionally pre-linked). */
  uploadFile: (clientId: number, file: File, opts: FileUploadOpts = {}) =>
    req<Evidence>(`/api/clients/${clientId}/evidence/file`, {
      method: 'POST',
      form: evidenceFileForm(file, opts),
    }),
  /** Rename / retag / refresh expiry. */
  update: (clientId: number, eid: number, patch: EvidenceUpdateInput) =>
    req<Evidence>(`/api/clients/${clientId}/evidence/${eid}`, { method: 'PATCH', body: patch }),
  /** Delete from the library (cascades links). */
  remove: (clientId: number, eid: number) =>
    req<{ ok: true }>(`/api/clients/${clientId}/evidence/${eid}`, { method: 'DELETE' }),
  /** Link an existing library item to a control row. */
  link: (clientId: number, eid: number, controlRowId: number) =>
    req<Evidence>(`/api/clients/${clientId}/evidence/${eid}/links`, {
      method: 'POST',
      body: { control_row_id: controlRowId },
    }),
  /** Unlink from a control row (item stays in the library). */
  unlink: (clientId: number, eid: number, controlRowId: number) =>
    req<Evidence>(`/api/clients/${clientId}/evidence/${eid}/links/${controlRowId}`, {
      method: 'DELETE',
    }),
  /** Force-download a file. */
  downloadUrl: (id: number) => `/api/evidence/${id}/download`,
  /** Open a file inline (preview in a new tab). */
  viewUrl: (id: number) => `/api/evidence/${id}/download?view=1`,
};

/* ------------------------------- Dashboard ------------------------------- */

export const dashboardApi = {
  get: (clientId: number) => req<DashboardSummary>(`/api/clients/${clientId}/dashboard`),
};

export const exportApi = {
  csvUrl: (clientId: number) => `/api/clients/${clientId}/export.csv`,
  backupUrl: () => '/api/backup',
};

/* --------------------------------- Audit --------------------------------- */

interface AuditQuery {
  action?: string;
  entity?: string;
  entity_id?: string;
  limit?: number;
  offset?: number;
}

function auditQs(query: AuditQuery): string {
  const params = new URLSearchParams();
  if (query.action) params.set('action', query.action);
  if (query.entity) params.set('entity', query.entity);
  if (query.entity_id) params.set('entity_id', query.entity_id);
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const auditApi = {
  /** Paged audit trail. Omit clientId for the cross-engagement trail. */
  list: (clientId: number | null, query: AuditQuery = {}) =>
    req<AuditPage>(
      `/api${clientId != null ? `/clients/${clientId}` : ''}/audit${auditQs(query)}`,
    ),
  csvUrl: (clientId: number | null) =>
    clientId != null ? `/api/clients/${clientId}/audit/export.csv` : '/api/audit/export.csv',
  jsonUrl: (clientId: number | null) =>
    clientId != null ? `/api/clients/${clientId}/audit/export.json` : '/api/audit/export.json',
};
