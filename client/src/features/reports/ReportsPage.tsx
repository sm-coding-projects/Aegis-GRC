import * as React from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  ScrollText,
  FileDown,
  FileJson,
  ChevronRight,
  Globe,
  Building2,
  ArrowRight,
} from 'lucide-react';
import type { AuditEntry, AuditPage } from '@aegis/shared';
import { auditApi } from '@/lib/api';
import { useSelectedClient } from '@/lib/client-context';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

const ACTION_OPTIONS = ['all', 'create', 'update', 'delete', 'link', 'unlink', 'export', 'backup'] as const;
const ENTITY_OPTIONS = ['all', 'control', 'client', 'evidence', 'audit', 'database'] as const;

/* Subtle, semantic-ish color per action (token-driven, AA-legible). */
const ACTION_CLASS: Record<string, string> = {
  create: 'bg-status-implemented-bg text-status-implemented',
  update: 'bg-status-progress-bg text-status-progress',
  delete: 'bg-status-overdue-bg text-status-overdue',
  link: 'bg-surface-2 text-text',
  unlink: 'bg-surface-2 text-text-muted',
  export: 'bg-surface-2 text-text-muted',
  backup: 'bg-surface-2 text-text-muted',
};

function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium font-data capitalize',
        ACTION_CLASS[action] ?? 'bg-surface-2 text-text-muted',
      )}
    >
      {action}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReportsPage() {
  const { selectedClientId } = useSelectedClient();
  const [scope, setScope] = React.useState<'client' | 'all'>('client');
  const [action, setAction] = React.useState<string>('all');
  const [entity, setEntity] = React.useState<string>('all');
  const [offset, setOffset] = React.useState(0);

  // Reset paging whenever the filters or scope change.
  React.useEffect(() => {
    setOffset(0);
  }, [scope, action, entity, selectedClientId]);

  const effectiveClientId = scope === 'client' ? selectedClientId : null;
  const filtersActive = action !== 'all' || entity !== 'all';

  const query = {
    limit: PAGE_SIZE,
    offset,
    ...(action !== 'all' ? { action } : {}),
    ...(entity !== 'all' ? { entity } : {}),
  };

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<AuditPage>({
    queryKey: ['audit', effectiveClientId, action, entity, offset],
    queryFn: () => auditApi.list(effectiveClientId, query),
    placeholderData: keepPreviousData,
    enabled: scope === 'all' || selectedClientId != null,
  });

  const csvUrl = auditApi.csvUrl(effectiveClientId);
  const jsonUrl = auditApi.jsonUrl(effectiveClientId);

  return (
    <div className="animate-fade-in">
      {/* Heading */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-start gap-2.5">
          <div className="h-9 w-9 rounded-md bg-surface-2 flex items-center justify-center shrink-0 mt-0.5">
            <ScrollText className="h-5 w-5 text-text-muted" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text">Audit trail</h2>
            <p className="text-sm text-text-muted mt-1">
              Immutable, append-only record of every change — who, what, when, and from where.
            </p>
          </div>
        </div>

        {/* Export */}
        <div className="flex items-center gap-2">
          <a
            href={csvUrl}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 h-9 text-xs font-medium text-text hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Export audit trail as CSV"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
            CSV
          </a>
          <a
            href={jsonUrl}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 h-9 text-xs font-medium text-text hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Export audit trail as JSON"
          >
            <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
            JSON
          </a>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Scope toggle */}
        <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" aria-label="Audit scope">
          <button
            onClick={() => setScope('client')}
            aria-pressed={scope === 'client'}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              scope === 'client' ? 'bg-accent text-accent-fg' : 'bg-surface text-text hover:bg-surface-2',
            )}
          >
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            This engagement
          </button>
          <button
            onClick={() => setScope('all')}
            aria-pressed={scope === 'all'}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium border-l border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              scope === 'all' ? 'bg-accent text-accent-fg' : 'bg-surface text-text hover:bg-surface-2',
            )}
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            All engagements
          </button>
        </div>

        {/* Action filter */}
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((a) => (
              <SelectItem key={a} value={a} className="capitalize">
                {a === 'all' ? 'All actions' : a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Entity filter */}
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Filter by entity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTITY_OPTIONS.map((e) => (
              <SelectItem key={e} value={e} className="capitalize">
                {e === 'all' ? 'All entities' : e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Body */}
      {scope === 'client' && selectedClientId == null ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-text-muted">Select an engagement from the sidebar, or switch to all engagements.</p>
        </div>
      ) : isLoading ? (
        <AuditSkeleton />
      ) : error || !data ? (
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3">
          <p className="text-text-muted">Failed to load the audit trail.</p>
          <Button variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : data.entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface shadow-elev-1 p-10 text-center">
          <p className="text-sm font-medium text-text">No audit entries{filtersActive ? ' match these filters' : ' yet'}.</p>
          <p className="text-xs text-text-muted mt-1">
            {filtersActive
              ? 'Try clearing the action or entity filter.'
              : 'Changes you make to controls, evidence, and engagements will be recorded here.'}
          </p>
        </div>
      ) : (
        <AuditTable
          page={data}
          isFetching={isFetching}
          onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          onNext={() => setOffset((o) => o + PAGE_SIZE)}
        />
      )}
    </div>
  );
}

function AuditTable({
  page,
  isFetching,
  onPrev,
  onNext,
}: {
  page: AuditPage;
  isFetching: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const from = page.total === 0 ? 0 : page.offset + 1;
  const to = Math.min(page.offset + page.limit, page.total);

  return (
    <div className={cn('rounded-lg border border-border bg-surface shadow-elev-1 overflow-hidden', isFetching && 'opacity-70')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="text-left text-text-muted">
              <th className="w-8" aria-label="Expand" />
              <th className="font-medium px-3 py-2.5 whitespace-nowrap">Timestamp</th>
              <th className="font-medium px-3 py-2.5">Action</th>
              <th className="font-medium px-3 py-2.5">Detail</th>
              <th className="font-medium px-3 py-2.5 whitespace-nowrap">Actor</th>
              <th className="font-medium px-3 py-2.5 whitespace-nowrap">IP</th>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-border bg-surface">
        <p className="text-xs text-text-muted font-data tabular-nums">
          {from}–{to} of {page.total}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onPrev} disabled={page.offset === 0}>
            Previous
          </Button>
          <Button variant="secondary" size="sm" onClick={onNext} disabled={to >= page.total}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = React.useState(false);
  const diff = parseDiff(entry.before, entry.after);
  const expandable = diff != null;

  return (
    <>
      <tr
        className={cn(
          'border-t border-border align-top',
          expandable && 'cursor-pointer hover:bg-surface-2 transition-colors',
        )}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
      >
        <td className="pl-3 py-2.5">
          {expandable && (
            <ChevronRight
              className={cn('h-4 w-4 text-text-muted transition-transform duration-150', open && 'rotate-90')}
              aria-hidden="true"
            />
          )}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap font-data text-xs text-text-muted tabular-nums">
          {formatTimestamp(entry.at)}
        </td>
        <td className="px-3 py-2.5">
          <ActionBadge action={entry.action} />
        </td>
        <td className="px-3 py-2.5 text-text">{entry.summary}</td>
        <td className="px-3 py-2.5 whitespace-nowrap font-data text-xs text-text-muted">{entry.actor ?? '—'}</td>
        <td className="px-3 py-2.5 whitespace-nowrap font-data text-xs text-text-muted">{entry.ip ?? '—'}</td>
      </tr>
      {open && expandable && (
        <tr className="border-t border-border bg-surface-2">
          <td />
          <td colSpan={5} className="px-3 py-3">
            <DiffView diff={diff!} />
          </td>
        </tr>
      )}
    </>
  );
}

interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

/** Merge before/after JSON into a field-by-field diff, or null if nothing to show. */
function parseDiff(beforeStr: string | null, afterStr: string | null): FieldDiff[] | null {
  const before = safeParse(beforeStr);
  const after = safeParse(afterStr);
  if (!before && !after) return null;
  const fields = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  if (fields.size === 0) return null;
  return [...fields].map((field) => ({
    field,
    before: before?.[field],
    after: after?.[field],
  }));
}

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function DiffView({ diff }: { diff: FieldDiff[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {diff.map(({ field, before, after }) => {
        const hasBefore = before !== undefined;
        const hasAfter = after !== undefined;
        return (
          <div key={field} className="flex items-start gap-2 text-xs">
            <span className="font-medium text-text-muted min-w-[140px] capitalize">
              {field.replace(/_/g, ' ')}
            </span>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {hasBefore && <DiffValue value={before} tone="before" />}
              {hasBefore && hasAfter && (
                <ArrowRight className="h-3 w-3 text-text-muted shrink-0" aria-hidden="true" />
              )}
              {hasAfter && <DiffValue value={after} tone="after" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiffValue({ value, tone }: { value: unknown; tone: 'before' | 'after' }) {
  const display = renderValue(value);
  return (
    <span
      className={cn(
        'font-data rounded px-1.5 py-0.5 break-all',
        tone === 'before'
          ? 'bg-status-overdue-bg text-status-overdue'
          : 'bg-status-implemented-bg text-status-implemented',
      )}
    >
      {display}
    </span>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === '') return '∅';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function AuditSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface shadow-elev-1 p-4">
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    </div>
  );
}
