/**
 * @aegis/shared — the single source of validation truth.
 *
 * These zod schemas and derived TypeScript types are imported by BOTH the
 * Express server (request validation) and the React client (form validation),
 * so client and server can never disagree about what a valid payload is.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Domain constants
 * ------------------------------------------------------------------ */

/** The four ISO/IEC 27001:2022 Annex A themes and their canonical sizes. */
export const THEMES = [
  { id: 'A.5', name: 'Organizational controls', count: 37 },
  { id: 'A.6', name: 'People controls', count: 8 },
  { id: 'A.7', name: 'Physical controls', count: 14 },
  { id: 'A.8', name: 'Technological controls', count: 34 },
] as const;

export const THEME_IDS = ['A.5', 'A.6', 'A.7', 'A.8'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const TOTAL_CONTROLS = 93;

/**
 * Implementation status. NOTE: "Overdue" is intentionally NOT a stored status —
 * it is derived (applicable && status !== 'implemented' && due_date < today).
 */
export const STATUSES = ['not_started', 'in_progress', 'implemented', 'not_applicable'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  implemented: 'Implemented',
  not_applicable: 'Not applicable',
};

export const EVIDENCE_KINDS = ['link', 'note', 'file'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/* ------------------------------------------------------------------ *
 * Shared field helpers
 * ------------------------------------------------------------------ */

/**
 * ISO date (YYYY-MM-DD) or null. Stored as TEXT in SQLite.
 * An empty string (e.g. a cleared <input type="date">) is coerced to null so a
 * form can save other fields without being blocked by an untouched date input.
 */
export const isoDateSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'), z.literal(''), z.null()])
  .transform((v) => (v === '' || v == null ? null : v));

const trimmedNonEmpty = (max: number) => z.string().trim().min(1).max(max);
const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === '' ? null : v));

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

/**
 * Master password. This single secret both gates the UI and is the SQLCipher
 * key. We enforce a reasonable minimum; there is exactly one operator.
 */
export const masterPasswordSchema = z
  .string()
  .min(8, 'Master password must be at least 8 characters')
  .max(256, 'Master password is too long');

export const unlockSchema = z.object({
  password: z.string().min(1, 'Password is required').max(256),
});
export type UnlockInput = z.infer<typeof unlockSchema>;

export const createMasterPasswordSchema = z.object({
  password: masterPasswordSchema,
});
export type CreateMasterPasswordInput = z.infer<typeof createMasterPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: masterPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* ------------------------------------------------------------------ *
 * Clients
 * ------------------------------------------------------------------ */

export const clientCreateSchema = z
  .object({
    name: trimmedNonEmpty(120),
    description: trimmedOptional(2000),
  })
  .strict();
export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

export const clientUpdateSchema = z
  .object({
    name: trimmedNonEmpty(120).optional(),
    description: trimmedOptional(2000),
  })
  .strict();
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export interface Client {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ *
 * Controls (the per-client SoA rows)
 * ------------------------------------------------------------------ */

export const controlUpdateSchema = z
  .object({
    applicable: z.boolean().optional(),
    applicability_justification: trimmedOptional(4000),
    status: z.enum(STATUSES).optional(),
    owner: trimmedOptional(120),
    due_date: isoDateSchema.optional(),
    last_reviewed: isoDateSchema.optional(),
    implementation_notes: trimmedOptional(8000),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type ControlUpdateInput = z.infer<typeof controlUpdateSchema>;

export interface ControlRow {
  id: number;
  client_id: number;
  control_id: string; // e.g. "A.8.24"
  theme_id: ThemeId;
  theme: string;
  title: string;
  applicable: boolean;
  applicability_justification: string | null;
  status: Status;
  owner: string | null;
  due_date: string | null;
  last_reviewed: string | null;
  implementation_notes: string | null;
  created_at: string;
  updated_at: string;
  /** Derived server-side: applicable && status !== 'implemented' && due_date < today. */
  overdue: boolean;
  evidence_count: number;
}

/** Query params for listing/filtering controls. */
export const controlListQuerySchema = z
  .object({
    theme: z.enum(THEME_IDS).optional(),
    status: z.enum(STATUSES).optional(),
    owner: z.string().trim().max(120).optional(),
    applicable: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    overdue: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export type ControlListQuery = z.infer<typeof controlListQuerySchema>;

/* ------------------------------------------------------------------ *
 * Bulk control operations
 * ------------------------------------------------------------------ *
 * Apply one partial patch to many control rows at once — e.g. mark a whole
 * Annex A theme not-applicable with a single justification. The patch reuses
 * `controlUpdateSchema` (same fields, same validation, same non-empty rule),
 * so client and server agree on exactly what a bulk edit may change.
 */
export const bulkControlUpdateSchema = z
  .object({
    control_row_ids: z.array(z.number().int().positive()).min(1).max(TOTAL_CONTROLS),
    patch: controlUpdateSchema,
  })
  .strict();
export type BulkControlUpdateInput = z.infer<typeof bulkControlUpdateSchema>;

/** Result of a bulk control update. */
export interface BulkUpdateResult {
  /** Number of control rows that matched and were updated. */
  updated: number;
  /** The updated control rows (so the client can refresh its cache). */
  controls: ControlRow[];
}

/* ------------------------------------------------------------------ *
 * Control templates (reusable applicability baselines)
 * ------------------------------------------------------------------ *
 * A template captures an applicability decision per control — which controls
 * apply and the justification — so a consultant can save, e.g., a "SaaS vendor
 * baseline" once and apply it to every new SaaS engagement. Templates are
 * global (shared across engagements) and live in the single encrypted file.
 * Templates intentionally do NOT capture engagement-specific data (status,
 * owner, dates): those are progress, not a reusable baseline.
 */
export interface ControlTemplateItem {
  control_id: string; // e.g. "A.8.24"
  applicable: boolean;
  applicability_justification: string | null;
}

export interface ControlTemplate {
  id: number;
  name: string;
  description: string | null;
  /** Number of control decisions stored in this template. */
  item_count: number;
  created_at: string;
  updated_at: string;
  /** Populated on the single-template view; omitted in list views. */
  items?: ControlTemplateItem[];
}

/** Create a template by snapshotting an existing engagement's applicability. */
export const templateCreateSchema = z
  .object({
    name: trimmedNonEmpty(120),
    description: trimmedOptional(2000),
    /** The engagement whose applicability decisions are captured. */
    from_client_id: z.number().int().positive(),
  })
  .strict();
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;

/** Rename a template or edit its description. */
export const templateUpdateSchema = z
  .object({
    name: trimmedNonEmpty(120).optional(),
    description: trimmedOptional(2000),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;

/** Apply a template to an engagement, optionally scoped to a single theme. */
export const templateApplySchema = z
  .object({
    theme: z.enum(THEME_IDS).optional(),
  })
  .strict();
export type TemplateApplyInput = z.infer<typeof templateApplySchema>;

/** Result of applying a template. */
export interface TemplateApplyResult {
  /** Number of control rows the template touched (matched by control_id). */
  applied: number;
}

/* ------------------------------------------------------------------ *
 * Evidence library (engagement-scoped, M:N linked to controls)
 * ------------------------------------------------------------------ */

/** A starter palette of evidence tags; users may also enter their own. */
export const SUGGESTED_EVIDENCE_TAGS = [
  'technical',
  'process',
  'policy',
  'vendor',
  'test-result',
  'screenshot',
] as const;

/** A single tag: short, free-form, trimmed. */
export const evidenceTagSchema = z.string().trim().min(1).max(40);

/** A set of tags; capped, de-duplicated by the server. Optional everywhere. */
export const evidenceTagsSchema = z.array(evidenceTagSchema).max(20);

/** List of control row ids to link a piece of evidence to (M:N). */
const controlRowIdsSchema = z.array(z.number().int().positive()).max(200);

const evidenceCommon = {
  label: trimmedNonEmpty(200),
  tags: evidenceTagsSchema.optional(),
  /** Expiry date; evidence past this is flagged stale. Empty/null = never expires. */
  expires_at: isoDateSchema.optional(),
  /** Optionally link to these control rows on create. */
  control_row_ids: controlRowIdsSchema.optional(),
};

export const evidenceLinkSchema = z
  .object({
    kind: z.literal('link'),
    url: z.string().trim().url('Must be a valid URL').max(2000),
    ...evidenceCommon,
  })
  .strict();

export const evidenceNoteSchema = z
  .object({
    kind: z.literal('note'),
    text: trimmedNonEmpty(8000),
    ...evidenceCommon,
  })
  .strict();

/** Link/note evidence created via JSON. File evidence goes through multipart. */
export const evidenceCreateSchema = z.discriminatedUnion('kind', [
  evidenceLinkSchema,
  evidenceNoteSchema,
]);
export type EvidenceCreateInput = z.infer<typeof evidenceCreateSchema>;

/** Patch an existing library item: rename, retag, or refresh/expire. */
export const evidenceUpdateSchema = z
  .object({
    label: trimmedNonEmpty(200).optional(),
    tags: evidenceTagsSchema.optional(),
    expires_at: isoDateSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type EvidenceUpdateInput = z.infer<typeof evidenceUpdateSchema>;

/** Link an existing library item to one more control row. */
export const evidenceLinkControlSchema = z
  .object({ control_row_id: z.number().int().positive() })
  .strict();
export type EvidenceLinkControlInput = z.infer<typeof evidenceLinkControlSchema>;

/** Filters for the evidence library list. */
export const evidenceListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    tag: evidenceTagSchema.optional(),
    kind: z.enum(EVIDENCE_KINDS).optional(),
    /** active = not expired; stale = expired; all = everything. */
    status: z.enum(['active', 'stale', 'all']).optional(),
  })
  .strict();
export type EvidenceListQuery = z.infer<typeof evidenceListQuerySchema>;

/** A short reference to a control a piece of evidence is linked to. */
export interface EvidenceControlRef {
  control_row_id: number;
  control_id: string; // e.g. "A.8.24"
  title: string;
}

export interface Evidence {
  id: number;
  client_id: number;
  kind: EvidenceKind;
  label: string;
  url: string | null;
  text: string | null;
  mime: string | null;
  size: number | null;
  tags: string[];
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  /** Derived: expires_at is set AND in the past. */
  expired: boolean;
  /** Number of controls this evidence is linked to. */
  linked_control_count: number;
  /** Populated on the single-item / control-scoped views; omitted in big lists. */
  linked_controls?: EvidenceControlRef[];
  /** True when this image evidence can be shown as a thumbnail/preview. */
  previewable: boolean;
}

/* ------------------------------------------------------------------ *
 * Dashboard aggregates
 * ------------------------------------------------------------------ */

export interface ThemeProgress {
  theme_id: ThemeId;
  theme: string;
  total: number;
  applicable: number;
  implemented: number;
  in_progress: number;
  not_started: number;
  not_applicable: number;
  overdue: number;
  /** implemented / applicable, 0..1 (1 when no applicable controls). */
  completion: number;
}

export interface DashboardSummary {
  client_id: number;
  total_controls: number;
  applicable: number;
  implemented: number;
  in_progress: number;
  not_started: number;
  not_applicable: number;
  overdue: number;
  /** Overall implemented / applicable, 0..1. */
  completion: number;
  by_theme: ThemeProgress[];
  recent_activity: AuditEntry[];
}

/* ------------------------------------------------------------------ *
 * Audit log (append-only, immutable)
 * ------------------------------------------------------------------ */

/**
 * An immutable audit-trail row. ISO 27001 (and most compliance frameworks)
 * require a defensible record of who changed what, when. Rows are append-only:
 * the database enforces this with triggers that reject UPDATE/DELETE.
 *
 * Field map vs. the canonical (timestamp, user_id, action, control_id, before,
 * after, ip) tuple:
 *   timestamp → at · user_id → actor · action → action · control_id → entity_id
 *   before/after → before/after · ip → ip
 *
 * `before`/`after` are JSON object strings (or null) describing the changed
 * fields — old values in `before`, new values in `after`.
 */
export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entity: string;
  /** For control entities this is the control_id (e.g. "A.8.24"); otherwise the row id. */
  entity_id: string | null;
  client_id: number | null;
  summary: string;
  /** JSON object string of changed fields' prior values, or null. */
  before: string | null;
  /** JSON object string of changed fields' new values, or null. */
  after: string | null;
  /** Originating request IP, or null when not request-scoped. */
  ip: string | null;
  /** Operator/session identifier responsible for the action. */
  actor: string | null;
}

/** Query params for paging/filtering the audit trail. */
export const auditListQuerySchema = z
  .object({
    action: z.string().trim().max(40).optional(),
    entity: z.string().trim().max(40).optional(),
    /** Filter to a single entity (e.g. a control_id like "A.8.24"). */
    entity_id: z.string().trim().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

/** A page of audit entries plus the unfiltered-by-page total (for pagination). */
export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ *
 * Generic API helpers
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface AuthState {
  unlocked: boolean;
  /** True when no DB file exists yet → show "create master password". */
  needsSetup: boolean;
}

/** Header name carrying the per-session CSRF token on state-changing requests. */
export const CSRF_HEADER = 'x-csrf-token';
