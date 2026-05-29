import * as React from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { FolderOpen, Plus, Search, Link2 as LinkIcon, AlertTriangle } from 'lucide-react';
import type { Evidence, EvidenceListQuery } from '@aegis/shared';
import { evidenceApi } from '@/lib/api';
import { useSelectedClient } from '@/lib/client-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { cn } from '@/lib/utils';
import {
  EvidenceThumbnail,
  ExpiryBadge,
  TagChip,
  EvidenceFormDialog,
  EvidencePreviewDialog,
} from './components';

const KIND_OPTIONS = ['all', 'link', 'note', 'file'] as const;

export function EvidenceLibraryPage() {
  const { selectedClientId } = useSelectedClient();

  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [tag, setTag] = React.useState('all');
  const [kind, setKind] = React.useState('all');
  const [status, setStatus] = React.useState('all');

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Evidence | null>(null);
  const [preview, setPreview] = React.useState<Evidence | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query: EvidenceListQuery = {
    ...(debounced ? { search: debounced } : {}),
    ...(tag !== 'all' ? { tag } : {}),
    ...(kind !== 'all' ? { kind: kind as EvidenceListQuery['kind'] } : {}),
    ...(status !== 'all' ? { status: status as EvidenceListQuery['status'] } : {}),
  };

  const {
    data: items,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<Evidence[]>({
    queryKey: ['evidence-library', selectedClientId, query],
    queryFn: () => evidenceApi.library(selectedClientId!, query),
    enabled: selectedClientId != null,
    placeholderData: keepPreviousData,
  });

  const { data: tags = [] } = useQuery<string[]>({
    queryKey: ['evidence-tags', selectedClientId],
    queryFn: () => evidenceApi.tags(selectedClientId!),
    enabled: selectedClientId != null,
  });

  const filtersActive = debounced !== '' || tag !== 'all' || kind !== 'all' || status !== 'all';
  const staleCount = (items ?? []).filter((e) => e.expired).length;

  if (selectedClientId == null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-text-muted">Select an engagement from the sidebar.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Heading */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-start gap-2.5">
          <div className="h-9 w-9 rounded-md bg-surface-2 flex items-center justify-center shrink-0 mt-0.5">
            <FolderOpen className="h-5 w-5 text-text-muted" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text">Evidence library</h2>
            <p className="text-sm text-text-muted mt-1">
              Reusable evidence for this engagement — tag it, link it to many controls, and keep it fresh.
            </p>
          </div>
        </div>
        <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add evidence
        </Button>
      </div>

      {/* Stale banner */}
      {staleCount > 0 && status !== 'stale' && (
        <button
          onClick={() => setStatus('stale')}
          className="w-full mb-4 flex items-center gap-2 rounded-md border border-status-overdue/30 bg-status-overdue-bg px-4 py-2.5 text-left text-sm text-status-overdue hover:brightness-105 transition"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {staleCount} piece{staleCount > 1 ? 's' : ''} of evidence{' '}
          {staleCount > 1 ? 'have' : 'has'} expired. Review and refresh.
        </button>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search label, note, URL, or tag…"
            className="pl-9"
            aria-label="Search evidence"
          />
        </div>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Filter by tag">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-9 w-[130px] text-xs" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((k) => (
              <SelectItem key={k} value={k} className="capitalize">
                {k === 'all' ? 'All types' : k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-[130px] text-xs" aria-label="Filter by freshness">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Body */}
      {isLoading ? (
        <EvidenceGridSkeleton />
      ) : error || !items ? (
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3">
          <p className="text-text-muted">Failed to load the evidence library.</p>
          <Button variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface shadow-elev-1 p-10 text-center">
          <FolderOpen className="h-8 w-8 mx-auto text-text-muted mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-text">
            {filtersActive ? 'No evidence matches these filters.' : 'No evidence yet.'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {filtersActive
              ? 'Try clearing the search or filters.'
              : 'Add test results, screenshots, policy excerpts, or vendor attestations to reuse across controls.'}
          </p>
          {!filtersActive && (
            <Button variant="primary" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add your first evidence
            </Button>
          )}
        </div>
      ) : (
        <div
          className={cn(
            'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3',
            isFetching && 'opacity-70',
          )}
        >
          {items.map((ev) => (
            <EvidenceCard key={ev.id} evidence={ev} onOpen={() => setPreview(ev)} />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <EvidenceFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        clientId={selectedClientId}
      />
      <EvidenceFormDialog
        open={editing != null}
        onOpenChange={(o) => !o && setEditing(null)}
        clientId={selectedClientId}
        editing={editing}
      />
      <EvidencePreviewDialog
        evidence={preview}
        clientId={selectedClientId}
        onOpenChange={(o) => !o && setPreview(null)}
        onEdit={(ev) => {
          setPreview(null);
          setEditing(ev);
        }}
      />
    </div>
  );
}

function EvidenceCard({ evidence, onOpen }: { evidence: Evidence; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        'text-left rounded-lg border bg-surface shadow-elev-1 p-3 flex gap-3 transition-colors',
        'hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        evidence.expired ? 'border-status-overdue/40' : 'border-border',
      )}
    >
      <EvidenceThumbnail evidence={evidence} size={48} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <p className="text-sm font-medium text-text truncate">{evidence.label}</p>
        <div className="flex flex-wrap gap-1">
          {evidence.tags.slice(0, 3).map((t) => (
            <TagChip key={t}>{t}</TagChip>
          ))}
          {evidence.tags.length > 3 && (
            <span className="text-xs text-text-muted">+{evidence.tags.length - 3}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-auto pt-1">
          <span className="inline-flex items-center gap-1 text-xs text-text-muted font-data">
            <LinkIcon className="h-3 w-3" aria-hidden="true" />
            {evidence.linked_control_count}
          </span>
          <ExpiryBadge evidence={evidence} />
        </div>
      </div>
    </button>
  );
}

function EvidenceGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}
