import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Link2, FileText, File, Download, Trash2, Plus, History, ArrowRight } from 'lucide-react';
import { controlUpdateSchema, STATUS_LABELS, STATUSES } from '@aegis/shared';
import type { ControlRow, ControlUpdateInput, Evidence, AuditEntry, AuditPage } from '@aegis/shared';
import { controlsApi, evidenceApi, auditApi, ApiError } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import { FormField } from '@/components/FormField';
import { Switch } from '@/components/ui/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

interface ControlDetailDrawerProps {
  control: ControlRow | null;
  clientId: number;
  onClose: () => void;
}

export function ControlDetailDrawer({ control, clientId, onClose }: ControlDetailDrawerProps) {
  const isOpen = control != null;

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-bg/50 backdrop-blur-sm animate-overlay-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={control ? `Control ${control.control_id}: ${control.title}` : undefined}
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-surface border-l border-border shadow-elev-3',
          'flex flex-col overflow-hidden',
          'transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {control && (
          <DrawerContent control={control} clientId={clientId} onClose={onClose} />
        )}
      </div>
    </>
  );
}

function DrawerContent({
  control,
  clientId,
  onClose,
}: {
  control: ControlRow;
  clientId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    control: formControl,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ControlUpdateInput>({
    resolver: zodResolver(controlUpdateSchema),
    defaultValues: {
      applicable: control.applicable,
      applicability_justification: control.applicability_justification ?? undefined,
      status: control.status,
      owner: control.owner ?? undefined,
      due_date: control.due_date ?? undefined,
      last_reviewed: control.last_reviewed ?? undefined,
      implementation_notes: control.implementation_notes ?? undefined,
    },
  });

  React.useEffect(() => {
    reset({
      applicable: control.applicable,
      applicability_justification: control.applicability_justification ?? undefined,
      status: control.status,
      owner: control.owner ?? undefined,
      due_date: control.due_date ?? undefined,
      last_reviewed: control.last_reviewed ?? undefined,
      implementation_notes: control.implementation_notes ?? undefined,
    });
  }, [control, reset]);

  const onSubmit = async (data: ControlUpdateInput) => {
    try {
      const updated = await controlsApi.update(clientId, control.id, data);
      queryClient.setQueryData(
        ['controls', clientId],
        (old: ControlRow[] | undefined) =>
          old?.map((c) => (c.id === updated.id ? updated : c)) ?? [updated],
      );
      await queryClient.invalidateQueries({ queryKey: ['dashboard', clientId] });
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success('Control updated.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Update failed.';
      toast.error(msg);
    }
  };

  // Close on Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-data text-xs font-medium text-text-muted">{control.control_id}</span>
            <StatusBadge status={control.status} overdue={control.overdue} size="sm" />
          </div>
          <h2 className="text-base font-semibold text-text mt-1 leading-snug">{control.title}</h2>
          <p className="text-xs text-text-muted mt-0.5">{control.theme}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close drawer">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <form id="control-edit-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-5">
            {/* Applicable toggle */}
            <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-md bg-surface-2">
              <div>
                <Label htmlFor="applicable-switch" className="font-medium">
                  Applicable
                </Label>
                <p className="text-xs text-text-muted mt-0.5">
                  Whether this control applies to this engagement.
                </p>
              </div>
              <Controller
                control={formControl}
                name="applicable"
                render={({ field }) => (
                  <Switch
                    id="applicable-switch"
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                    aria-label="Toggle applicable"
                  />
                )}
              />
            </div>

            {/* Applicability justification */}
            <FormField
              label="Applicability justification"
              htmlFor="appj"
              error={errors.applicability_justification?.message}
            >
              <Textarea
                id="appj"
                placeholder="Why this control is or isn't applicable…"
                rows={3}
                {...register('applicability_justification')}
                error={errors.applicability_justification?.message}
              />
            </FormField>

            {/* Status */}
            <FormField label="Implementation status" htmlFor="status-select" error={errors.status?.message}>
              <Controller
                control={formControl}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="status-select">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            {/* Owner */}
            <FormField label="Owner" htmlFor="owner" error={errors.owner?.message}>
              <Input
                id="owner"
                placeholder="e.g. John Smith"
                {...register('owner')}
                error={errors.owner?.message}
              />
            </FormField>

            {/* Dates row */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Due date" htmlFor="due-date" error={errors.due_date?.message}>
                <Input
                  id="due-date"
                  type="date"
                  className="font-data text-sm"
                  {...register('due_date')}
                  error={errors.due_date?.message}
                />
              </FormField>
              <FormField label="Last reviewed" htmlFor="last-reviewed" error={errors.last_reviewed?.message}>
                <Input
                  id="last-reviewed"
                  type="date"
                  className="font-data text-sm"
                  {...register('last_reviewed')}
                  error={errors.last_reviewed?.message}
                />
              </FormField>
            </div>

            {/* Implementation notes */}
            <FormField
              label="Implementation notes"
              htmlFor="impl-notes"
              error={errors.implementation_notes?.message}
            >
              <Textarea
                id="impl-notes"
                placeholder="How this control is implemented, gaps, plans…"
                rows={5}
                {...register('implementation_notes')}
                error={errors.implementation_notes?.message}
              />
            </FormField>
          </div>
        </form>

        {/* Evidence section */}
        <div className="mt-6 border-t border-border pt-5">
          <EvidenceSection clientId={clientId} control={control} />
        </div>

        {/* Change history (from the immutable audit trail) */}
        <div className="mt-6 border-t border-border pt-5">
          <ChangeHistory clientId={clientId} control={control} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border shrink-0 bg-surface">
        <Button variant="secondary" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          form="control-edit-form"
          type="submit"
          disabled={!isDirty}
          loading={isSubmitting}
        >
          Save changes
        </Button>
      </div>
    </>
  );
}

/* ================================================================== */
/* Evidence section                                                     */
/* ================================================================== */
type EvidenceMode = 'none' | 'add-link' | 'add-note' | 'add-file';

function EvidenceSection({ clientId, control }: { clientId: number; control: ControlRow }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = React.useState<EvidenceMode>('none');

  const { data: evidenceList, isLoading } = useQuery<Evidence[]>({
    queryKey: ['evidence', clientId, control.id],
    queryFn: () => evidenceApi.list(clientId, control.id),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['evidence', clientId, control.id] });

  const handleDeleteEvidence = async (id: number) => {
    try {
      await evidenceApi.remove(id);
      await invalidate();
      toast.success('Evidence removed.');
    } catch {
      toast.error('Failed to remove evidence.');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Evidence</h3>
        {mode === 'none' && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setMode('add-link')} className="text-xs">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Link
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMode('add-note')} className="text-xs">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Note
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMode('add-file')} className="text-xs">
              <File className="h-3.5 w-3.5" aria-hidden="true" /> File
            </Button>
          </div>
        )}
      </div>

      {/* Add forms */}
      {mode === 'add-link' && (
        <AddLinkForm
          clientId={clientId}
          controlId={control.id}
          onDone={() => { setMode('none'); void invalidate(); }}
          onCancel={() => setMode('none')}
        />
      )}
      {mode === 'add-note' && (
        <AddNoteForm
          clientId={clientId}
          controlId={control.id}
          onDone={() => { setMode('none'); void invalidate(); }}
          onCancel={() => setMode('none')}
        />
      )}
      {mode === 'add-file' && (
        <AddFileForm
          clientId={clientId}
          controlId={control.id}
          onDone={() => { setMode('none'); void invalidate(); }}
          onCancel={() => setMode('none')}
        />
      )}

      {/* Evidence list */}
      {isLoading ? (
        <Skeleton className="h-16 mt-2" />
      ) : evidenceList && evidenceList.length > 0 ? (
        <ul className="flex flex-col gap-2 mt-2">
          {evidenceList.map((ev) => (
            <EvidenceItem key={ev.id} evidence={ev} onDelete={() => void handleDeleteEvidence(ev.id)} />
          ))}
        </ul>
      ) : (
        mode === 'none' && (
          <p className="text-sm text-text-muted py-2">
            No evidence yet.{' '}
            <button
              onClick={() => setMode('add-link')}
              className="text-accent hover:underline"
            >
              Add a link
            </button>{' '}
            to get started.
          </p>
        )
      )}
    </div>
  );
}

function EvidenceItem({ evidence, onDelete }: { evidence: Evidence; onDelete: () => void }) {
  const kindIcon = {
    link: <Link2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />,
    note: <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />,
    file: <File className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />,
  }[evidence.kind];

  return (
    <li className="flex items-start gap-2 p-3 rounded-md border border-border bg-surface-2 group">
      {kindIcon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">{evidence.label}</p>
        {evidence.url && (
          <a
            href={evidence.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent hover:underline truncate block"
          >
            {evidence.url}
          </a>
        )}
        {evidence.text && (
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{evidence.text}</p>
        )}
        {evidence.kind === 'file' && evidence.size && (
          <p className="text-xs text-text-muted mt-0.5">
            {(evidence.size / 1024).toFixed(1)} KB
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {evidence.kind === 'file' && (
          <a
            href={evidenceApi.downloadUrl(evidence.id)}
            download={evidence.label}
            className="p-1 rounded text-text-muted hover:text-text hover:bg-surface transition-colors"
            aria-label={`Download ${evidence.label}`}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        <button
          onClick={onDelete}
          className="p-1 rounded text-text-muted hover:text-destructive hover:bg-surface transition-colors"
          aria-label={`Delete ${evidence.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function AddLinkForm({
  clientId,
  controlId,
  onDone,
  onCancel,
}: {
  clientId: number;
  controlId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !url) return;
    setIsSubmitting(true);
    try {
      await evidenceApi.addLinkOrNote(clientId, controlId, { kind: 'link', label, url });
      toast.success('Link added.');
      onDone();
    } catch {
      toast.error('Failed to add link.');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 rounded-md border border-border bg-surface-2 mb-3">
      <p className="text-xs font-semibold text-text">Add link</p>
      <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input placeholder="https://..." type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="flex gap-2 mt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={!label || !url}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
        </Button>
      </div>
    </form>
  );
}

function AddNoteForm({
  clientId,
  controlId,
  onDone,
  onCancel,
}: {
  clientId: number;
  controlId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = React.useState('');
  const [text, setText] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !text) return;
    setIsSubmitting(true);
    try {
      await evidenceApi.addLinkOrNote(clientId, controlId, { kind: 'note', label, text });
      toast.success('Note added.');
      onDone();
    } catch {
      toast.error('Failed to add note.');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 rounded-md border border-border bg-surface-2 mb-3">
      <p className="text-xs font-semibold text-text">Add note</p>
      <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Textarea placeholder="Note content…" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2 mt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={!label || !text}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
        </Button>
      </div>
    </form>
  );
}

/* ================================================================== */
/* Change history (immutable audit trail, scoped to this control)       */
/* ================================================================== */
function ChangeHistory({ clientId, control }: { clientId: number; control: ControlRow }) {
  const { data, isLoading } = useQuery<AuditPage>({
    queryKey: ['audit', clientId, control.control_id],
    queryFn: () =>
      auditApi.list(clientId, { entity: 'control', entity_id: control.control_id, limit: 50 }),
  });

  const entries = data?.entries ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-text-muted" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-text">Change history</h3>
      </div>

      {isLoading ? (
        <Skeleton className="h-16" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-muted py-1">
          No changes recorded yet. Edits to this control will appear here.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <HistoryItem key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
}

function HistoryItem({ entry }: { entry: AuditEntry }) {
  const diff = parseControlDiff(entry.before, entry.after);
  return (
    <li className="border-l-2 border-border pl-3">
      <p className="text-xs text-text-muted font-data">
        {new Date(entry.at).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
        {entry.actor ? ` · ${entry.actor}` : ''}
      </p>
      <p className="text-sm text-text mt-0.5">{entry.summary}</p>
      {diff && diff.length > 0 && (
        <div className="flex flex-col gap-1 mt-1.5">
          {diff.map(({ field, before, after }) => (
            <div key={field} className="flex items-start gap-1.5 text-xs flex-wrap">
              <span className="text-text-muted capitalize min-w-[110px]">
                {field.replace(/_/g, ' ')}
              </span>
              <span className="font-data rounded px-1.5 py-0.5 bg-status-overdue-bg text-status-overdue break-all">
                {renderHistValue(before)}
              </span>
              <ArrowRight className="h-3 w-3 text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
              <span className="font-data rounded px-1.5 py-0.5 bg-status-implemented-bg text-status-implemented break-all">
                {renderHistValue(after)}
              </span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

interface ControlFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

function parseControlDiff(
  beforeStr: string | null,
  afterStr: string | null,
): ControlFieldDiff[] | null {
  const before = safeParseObj(beforeStr);
  const after = safeParseObj(afterStr);
  if (!before && !after) return null;
  const fields = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...fields].map((field) => ({
    field,
    before: before?.[field],
    after: after?.[field],
  }));
}

function safeParseObj(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function renderHistValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '∅';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function AddFileForm({
  clientId,
  controlId,
  onDone,
  onCancel,
}: {
  clientId: number;
  controlId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [label, setLabel] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setIsSubmitting(true);
    try {
      await evidenceApi.addFile(clientId, controlId, file, label || undefined);
      toast.success('File uploaded.');
      onDone();
    } catch {
      toast.error('Failed to upload file.');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 rounded-md border border-border bg-surface-2 mb-3">
      <p className="text-xs font-semibold text-text">Upload file</p>
      <Input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-sm text-text file:mr-2 file:rounded file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-xs file:font-medium file:text-text file:cursor-pointer hover:file:bg-surface-2"
        aria-label="Select file to upload"
      />
      <div className="flex gap-2 mt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={!file}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Upload
        </Button>
      </div>
    </form>
  );
}
