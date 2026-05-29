import type { ControlRow, AuditEntry } from '@aegis/shared';
import { STATUS_LABELS } from '@aegis/shared';

/** RFC-4180-ish CSV cell escaping. */
function cell(value: string | number | boolean | null): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const HEADERS = [
  'Control',
  'Theme',
  'Title',
  'Applicable',
  'Applicability justification',
  'Status',
  'Overdue',
  'Owner',
  'Due date',
  'Last reviewed',
  'Implementation notes',
];

/** Render a client's Statement of Applicability as CSV text. */
export function controlsToCsv(controls: ControlRow[]): string {
  const lines = [HEADERS.map(cell).join(',')];
  for (const c of controls) {
    lines.push(
      [
        c.control_id,
        c.theme,
        c.title,
        c.applicable ? 'Yes' : 'No',
        c.applicability_justification,
        STATUS_LABELS[c.status],
        c.overdue ? 'Yes' : 'No',
        c.owner,
        c.due_date,
        c.last_reviewed,
        c.implementation_notes,
      ]
        .map(cell)
        .join(','),
    );
  }
  // Excel-friendly CRLF line endings.
  return lines.join('\r\n');
}

const AUDIT_HEADERS = [
  'Timestamp (UTC)',
  'Actor',
  'IP',
  'Action',
  'Entity',
  'Entity ID',
  'Client ID',
  'Summary',
  'Before',
  'After',
];

/** Render the audit trail as CSV text (one row per entry, oldest → newest). */
export function auditToCsv(entries: AuditEntry[]): string {
  const lines = [AUDIT_HEADERS.map(cell).join(',')];
  for (const e of entries) {
    lines.push(
      [
        e.at,
        e.actor,
        e.ip,
        e.action,
        e.entity,
        e.entity_id,
        e.client_id,
        e.summary,
        e.before,
        e.after,
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}
