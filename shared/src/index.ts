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
 * Evidence
 * ------------------------------------------------------------------ */

export const evidenceLinkSchema = z
  .object({
    kind: z.literal('link'),
    label: trimmedNonEmpty(200),
    url: z.string().trim().url('Must be a valid URL').max(2000),
  })
  .strict();

export const evidenceNoteSchema = z
  .object({
    kind: z.literal('note'),
    label: trimmedNonEmpty(200),
    text: trimmedNonEmpty(8000),
  })
  .strict();

/** Link/note evidence created via JSON. File evidence goes through multipart. */
export const evidenceCreateSchema = z.discriminatedUnion('kind', [
  evidenceLinkSchema,
  evidenceNoteSchema,
]);
export type EvidenceCreateInput = z.infer<typeof evidenceCreateSchema>;

export interface Evidence {
  id: number;
  control_row_id: number;
  kind: EvidenceKind;
  label: string;
  url: string | null;
  text: string | null;
  mime: string | null;
  size: number | null;
  created_at: string;
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
 * Audit log (append-only)
 * ------------------------------------------------------------------ */

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  client_id: number | null;
  summary: string;
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
