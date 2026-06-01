import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronRight, Filter, Layers, X } from 'lucide-react';
import type { ControlRow } from '@aegis/shared';
import { STATUSES, STATUS_LABELS, THEME_IDS, THEMES } from '@aegis/shared';
import type { ThemeId } from '@aegis/shared';
import { controlsApi } from '@/lib/api';
import { useSelectedClient } from '@/lib/client-context';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { ControlDetailDrawer } from './ControlDetailDrawer';
import { BulkEditDialog } from './BulkEditDialog';
import { TemplatesDialog } from './TemplatesDialog';
import { groupByTheme } from './controlsUtils';
import { cn } from '@/lib/utils';

/** A tri-state checkbox (supports the indeterminate visual via a ref). */
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  'aria-label': ariaLabel,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  'aria-label': string;
  className?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && !!indeterminate;
  }, [checked, indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className={cn('h-4 w-4 accent-accent cursor-pointer', className)}
    />
  );
}

export function ControlsPage() {
  const { selectedClientId } = useSelectedClient();
  const [selectedControl, setSelectedControl] = React.useState<ControlRow | null>(null);

  // Bulk selection of control rows + the dialogs the toolbar opens.
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [templatesOpen, setTemplatesOpen] = React.useState(false);

  // Filters
  const [search, setSearch] = React.useState('');
  const [themeFilter, setThemeFilter] = React.useState<ThemeId | 'all'>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [ownerFilter, setOwnerFilter] = React.useState<string>('all');
  const [applicableFilter, setApplicableFilter] = React.useState<string>('all');
  const [overdueFilter, setOverdueFilter] = React.useState(false);

  // Build server query params
  const queryParams: Record<string, string> = {};
  if (themeFilter !== 'all') queryParams['theme'] = themeFilter;
  if (statusFilter !== 'all') queryParams['status'] = statusFilter;
  if (ownerFilter !== 'all') queryParams['owner'] = ownerFilter;
  if (applicableFilter !== 'all') queryParams['applicable'] = applicableFilter;
  if (overdueFilter) queryParams['overdue'] = 'true';
  if (search.trim()) queryParams['search'] = search.trim();

  const {
    data: controls = [],
    isLoading,
    error,
    refetch,
  } = useQuery<ControlRow[]>({
    queryKey: ['controls', selectedClientId, queryParams],
    queryFn: () => controlsApi.list(selectedClientId!, queryParams),
    enabled: selectedClientId != null,
  });

  const { data: owners = [] } = useQuery<string[]>({
    queryKey: ['owners', selectedClientId],
    queryFn: () => controlsApi.owners(selectedClientId!),
    enabled: selectedClientId != null,
  });

  // Keep the selection coherent with what's actually visible: drop ids that the
  // current filters (or a client switch) no longer show.
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(controls.map((c) => c.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [controls]);

  const toggleControl = React.useCallback((id: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleMany = React.useCallback((ids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = React.useCallback(() => setSelected(new Set()), []);

  if (!selectedClientId) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-text-muted">Select a client engagement to view controls.</p>
      </div>
    );
  }

  const groups = groupByTheme(controls);

  return (
    <div className="animate-fade-in">
      {/* Page heading */}
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-text">Controls</h2>
        <p className="text-sm text-text-muted mt-1">ISO/IEC 27001:2022 Annex A — Statement of Applicability</p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap gap-2 mb-5 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" aria-hidden="true" />
          <Input
            placeholder="Search controls…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            aria-label="Search controls"
          />
        </div>

        {/* Theme filter */}
        <Select value={themeFilter} onValueChange={(v) => setThemeFilter(v as ThemeId | 'all')}>
          <SelectTrigger className="w-44" aria-label="Filter by theme">
            <Filter className="h-3.5 w-3.5 text-text-muted mr-1" aria-hidden="true" />
            <SelectValue placeholder="All themes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All themes</SelectItem>
            {THEMES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.id} — {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Owner filter */}
        {owners.length > 0 && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-40" aria-label="Filter by owner">
              <SelectValue placeholder="All owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Applicable filter */}
        <Select value={applicableFilter} onValueChange={setApplicableFilter}>
          <SelectTrigger className="w-36" aria-label="Filter by applicable">
            <SelectValue placeholder="Applicable" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Applicable</SelectItem>
            <SelectItem value="false">Not applicable</SelectItem>
          </SelectContent>
        </Select>

        {/* Overdue toggle */}
        <Button
          variant={overdueFilter ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setOverdueFilter(!overdueFilter)}
          aria-pressed={overdueFilter}
        >
          Overdue only
        </Button>

        {/* Templates */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setTemplatesOpen(true)}
          className="ml-auto"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" /> Templates
        </Button>
      </div>

      {/* Bulk action bar (appears when controls are selected) */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mb-4 flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2.5 shadow-elev-1 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="font-data text-sm font-medium text-text">{selected.size}</span>
            <span className="text-sm text-text-muted">
              control{selected.size === 1 ? '' : 's'} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setBulkOpen(true)}>
              Bulk edit
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection} aria-label="Clear selection">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table content */}
      {isLoading ? (
        <ControlsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <p className="text-text-muted">Failed to load controls.</p>
          <Button variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : controls.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-text font-medium">No controls match the current filters.</p>
          <p className="text-sm text-text-muted">Try removing some filters.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('');
              setThemeFilter('all');
              setStatusFilter('all');
              setOwnerFilter('all');
              setApplicableFilter('all');
              setOverdueFilter(false);
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <ThemeGroup
              key={group.theme_id}
              themeId={group.theme_id}
              themeName={group.theme}
              controls={group.controls}
              onSelectControl={setSelectedControl}
              selectedControlId={selectedControl?.id}
              selectedIds={selected}
              onToggleControl={toggleControl}
              onToggleMany={toggleMany}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <ControlDetailDrawer
        control={selectedControl}
        clientId={selectedClientId}
        onClose={() => setSelectedControl(null)}
      />

      {/* Bulk edit dialog */}
      <BulkEditDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        clientId={selectedClientId}
        controlRowIds={[...selected]}
        onApplied={clearSelection}
      />

      {/* Templates dialog */}
      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        clientId={selectedClientId}
      />
    </div>
  );
}

interface ThemeGroupProps {
  themeId: ThemeId;
  themeName: string;
  controls: ControlRow[];
  onSelectControl: (c: ControlRow) => void;
  selectedControlId?: number;
  selectedIds: Set<number>;
  onToggleControl: (id: number, on: boolean) => void;
  onToggleMany: (ids: number[], on: boolean) => void;
}

function ThemeGroup({
  themeId,
  themeName,
  controls,
  onSelectControl,
  selectedControlId,
  selectedIds,
  onToggleControl,
  onToggleMany,
}: ThemeGroupProps) {
  const ids = controls.map((c) => c.id);
  const selectedInGroup = ids.filter((id) => selectedIds.has(id)).length;
  const allSelected = ids.length > 0 && selectedInGroup === ids.length;
  const someSelected = selectedInGroup > 0 && !allSelected;

  return (
    <section aria-labelledby={`theme-${themeId}`}>
      {/* Theme header */}
      <div className="flex items-baseline gap-3 mb-2">
        <h3 id={`theme-${themeId}`} className="text-sm font-semibold text-text">
          <span className="font-data text-text-muted">{themeId}</span> {themeName}
        </h3>
        <span className="font-data text-xs text-text-muted">{controls.length} controls</span>
        {selectedInGroup > 0 && (
          <span className="font-data text-xs text-accent">{selectedInGroup} selected</span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm border-collapse" role="table">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left">
              <th scope="col" className="py-2.5 pl-4 pr-1 w-9">
                <TriCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(on) => onToggleMany(ids, on)}
                  aria-label={`Select all controls in ${themeId} ${themeName}`}
                />
              </th>
              <th
                scope="col"
                className="py-2.5 px-4 font-medium text-xs text-text-muted w-24 font-data"
              >
                Control ID
              </th>
              <th scope="col" className="py-2.5 px-4 font-medium text-xs text-text-muted">
                Title
              </th>
              <th scope="col" className="py-2.5 px-4 font-medium text-xs text-text-muted w-36">
                Owner
              </th>
              <th
                scope="col"
                className="py-2.5 px-4 font-medium text-xs text-text-muted w-28 font-data"
              >
                Due date
              </th>
              <th scope="col" className="py-2.5 px-4 font-medium text-xs text-text-muted w-36">
                Status
              </th>
              <th scope="col" className="w-8" aria-label="Open detail" />
            </tr>
          </thead>
          <tbody>
            {controls.map((control, idx) => (
              <ControlRow
                key={control.id}
                control={control}
                isSelected={control.id === selectedControlId}
                isChecked={selectedIds.has(control.id)}
                onToggle={(on) => onToggleControl(control.id, on)}
                isLast={idx === controls.length - 1}
                onClick={() => onSelectControl(control)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ControlRow({
  control,
  isSelected,
  isChecked,
  onToggle,
  isLast,
  onClick,
}: {
  control: ControlRow;
  isSelected: boolean;
  isChecked: boolean;
  onToggle: (on: boolean) => void;
  isLast: boolean;
  onClick: () => void;
}) {
  return (
    <tr
      className={cn(
        'group cursor-pointer transition-colors duration-100',
        'hover:bg-surface-2 focus-within:bg-surface-2',
        (isSelected || isChecked) && 'bg-surface-2',
        !isLast && 'border-b border-border',
        !control.applicable && 'opacity-60',
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="row"
      aria-selected={isSelected}
    >
      {/* Selection checkbox — stops propagation so it doesn't open the drawer. */}
      <td
        className="py-3 pl-4 pr-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Select ${control.control_id}`}
          className="h-4 w-4 accent-accent cursor-pointer"
        />
      </td>
      <td className="py-3 px-4 font-data text-xs text-text-muted whitespace-nowrap">
        {control.control_id}
      </td>
      <td className="py-3 px-4 text-text leading-snug">
        <span className="line-clamp-2">{control.title}</span>
        {control.evidence_count > 0 && (
          <span className="font-data text-xs text-text-muted ml-1">
            ({control.evidence_count} evidence)
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-text-muted text-xs truncate max-w-[140px]">
        {control.owner ?? '—'}
      </td>
      <td className="py-3 px-4 font-data text-xs text-text-muted whitespace-nowrap">
        {control.due_date ?? '—'}
      </td>
      <td className="py-3 px-4">
        <StatusBadge status={control.status} overdue={control.overdue} size="sm" />
      </td>
      <td className="py-3 px-2">
        <ChevronRight
          className="h-4 w-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
        />
      </td>
    </tr>
  );
}

function ControlsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {THEME_IDS.map((id) => (
        <div key={id}>
          <Skeleton className="h-5 w-48 mb-2" />
          <div className="rounded-lg border border-border overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={cn('flex gap-4 py-3 px-4', i < 3 && 'border-b border-border')}>
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
