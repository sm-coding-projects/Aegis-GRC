import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Link2,
  FileText,
  File as FileIcon,
  Image as ImageIcon,
  X,
  Plus,
  Download,
  ExternalLink,
  Pencil,
  Trash2,
  Clock,
  AlertTriangle,
  Tag as TagIcon,
} from 'lucide-react';
import { SUGGESTED_EVIDENCE_TAGS } from '@aegis/shared';
import type { Evidence, ControlRow } from '@aegis/shared';
import { evidenceApi, controlsApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FormField } from '@/components/FormField';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { cn } from '@/lib/utils';

/* ================================================================== */
/* Small presentational helpers                                         */
/* ================================================================== */

export function EvidenceKindIcon({ evidence, className }: { evidence: Evidence; className?: string }) {
  const cls = cn('h-4 w-4 text-text-muted shrink-0', className);
  if (evidence.kind === 'link') return <Link2 className={cls} aria-hidden="true" />;
  if (evidence.kind === 'note') return <FileText className={cls} aria-hidden="true" />;
  if (evidence.previewable) return <ImageIcon className={cls} aria-hidden="true" />;
  return <FileIcon className={cls} aria-hidden="true" />;
}

export function TagChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-border px-2 py-0.5 text-xs text-text-muted">
      <TagIcon className="h-3 w-3" aria-hidden="true" />
      {children}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Expiry status pill: expired (red), expiring soon (amber), or valid (muted). */
export function ExpiryBadge({ evidence, className }: { evidence: Evidence; className?: string }) {
  if (!evidence.expires_at) return null;
  const days = daysUntil(evidence.expires_at);
  if (evidence.expired) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-status-overdue-bg text-status-overdue',
          className,
        )}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Expired {formatDate(evidence.expires_at)}
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-status-progress-bg text-status-progress',
          className,
        )}
      >
        <Clock className="h-3 w-3" aria-hidden="true" />
        Expires in {days}d
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-text-muted', className)}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      Valid until {formatDate(evidence.expires_at)}
    </span>
  );
}

/** Image thumbnail for image evidence; a kind glyph otherwise. */
export function EvidenceThumbnail({ evidence, size = 40 }: { evidence: Evidence; size?: number }) {
  if (evidence.previewable) {
    return (
      <img
        src={evidenceApi.downloadUrl(evidence.id)}
        alt={evidence.label}
        width={size}
        height={size}
        loading="lazy"
        className="rounded object-cover bg-surface-2 border border-border shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded bg-surface-2 border border-border flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <EvidenceKindIcon evidence={evidence} className="h-5 w-5" />
    </div>
  );
}

/* ================================================================== */
/* Tag input (chips + suggestions)                                      */
/* ================================================================== */

export function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = React.useState('');

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  };
  const remove = (t: string) => onChange(value.filter((v) => v !== t));

  const suggestions = SUGGESTED_EVIDENCE_TAGS.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-border pl-2 pr-1 py-0.5 text-xs text-text"
            >
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                className="rounded-full p-0.5 hover:bg-surface text-text-muted hover:text-text"
                aria-label={`Remove tag ${t}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && draft === '' && value.length) {
            remove(value[value.length - 1]!);
          }
        }}
        placeholder="Add a tag and press Enter…"
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-text-muted hover:text-text hover:border-accent transition-colors"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Create / edit dialog                                                 */
/* ================================================================== */

type EvidenceKindChoice = 'link' | 'note' | 'file';

interface EvidenceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  /** When set, the dialog edits this item (label/tags/expiry). Otherwise it creates. */
  editing?: Evidence | null;
  /** When creating from a control, link the new item to it. */
  linkToControlRowId?: number;
  onSaved?: (ev: Evidence) => void;
}

export function EvidenceFormDialog({
  open,
  onOpenChange,
  clientId,
  editing,
  linkToControlRowId,
  onSaved,
}: EvidenceFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open && (
          <EvidenceForm
            clientId={clientId}
            editing={editing ?? null}
            linkToControlRowId={linkToControlRowId}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function useEvidenceInvalidate(clientId: number) {
  const queryClient = useQueryClient();
  return React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['evidence-library', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['evidence-tags', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['evidence-item', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['evidence', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['controls', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['audit'] }),
    ]);
  }, [queryClient, clientId]);
}

function EvidenceForm({
  clientId,
  editing,
  linkToControlRowId,
  onClose,
  onSaved,
}: {
  clientId: number;
  editing: Evidence | null;
  linkToControlRowId?: number;
  onClose: () => void;
  onSaved?: (ev: Evidence) => void;
}) {
  const invalidate = useEvidenceInvalidate(clientId);
  const isEdit = editing != null;

  const [kind, setKind] = React.useState<EvidenceKindChoice>(editing?.kind ?? 'link');
  const [label, setLabel] = React.useState(editing?.label ?? '');
  const [url, setUrl] = React.useState(editing?.url ?? '');
  const [text, setText] = React.useState(editing?.text ?? '');
  const [tags, setTags] = React.useState<string[]>(editing?.tags ?? []);
  const [expiresAt, setExpiresAt] = React.useState(editing?.expires_at ?? '');
  const [file, setFile] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let saved: Evidence;
      if (isEdit) {
        saved = await evidenceApi.update(clientId, editing!.id, {
          label: label.trim(),
          tags,
          expires_at: expiresAt || null,
        });
        toast.success('Evidence updated.');
      } else if (kind === 'file') {
        if (!file) {
          toast.error('Choose a file to upload.');
          setSubmitting(false);
          return;
        }
        saved = await evidenceApi.uploadFile(clientId, file, {
          label: label.trim() || file.name,
          tags,
          expires_at: expiresAt || null,
          control_row_ids: linkToControlRowId ? [linkToControlRowId] : undefined,
        });
        toast.success('File uploaded to the library.');
      } else {
        const common = {
          label: label.trim(),
          tags,
          expires_at: expiresAt || null,
          ...(linkToControlRowId ? { control_row_ids: [linkToControlRowId] } : {}),
        };
        saved = await evidenceApi.create(
          clientId,
          kind === 'link'
            ? { kind: 'link', url: url.trim(), ...common }
            : { kind: 'note', text: text.trim(), ...common },
        );
        toast.success('Evidence added to the library.');
      }
      await invalidate();
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save evidence.';
      toast.error(msg);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit evidence' : 'Add evidence'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Rename, retag, or refresh the expiry date.'
            : 'Add to the engagement’s evidence library. You can link it to controls afterwards.'}
        </DialogDescription>
      </DialogHeader>

      {/* Kind switch (create only) */}
      {!isEdit && (
        <div className="flex gap-1.5" role="group" aria-label="Evidence type">
          {(['link', 'note', 'file'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn(
                'flex-1 capitalize rounded-md border py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                kind === k
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border bg-surface-2 text-text hover:bg-surface',
              )}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      <FormField label="Label" htmlFor="ev-label" required>
        <Input
          id="ev-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind === 'file' ? 'Defaults to the file name' : 'e.g. SOC 2 Type II report'}
          autoFocus
        />
      </FormField>

      {!isEdit && kind === 'link' && (
        <FormField label="URL" htmlFor="ev-url" required>
          <Input
            id="ev-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </FormField>
      )}
      {!isEdit && kind === 'note' && (
        <FormField label="Note" htmlFor="ev-text" required>
          <Textarea
            id="ev-text"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a policy excerpt, observation, or reviewer note…"
          />
        </FormField>
      )}
      {!isEdit && kind === 'file' && (
        <FormField label="File" htmlFor="ev-file" required>
          <input
            id="ev-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-text file:mr-2 file:rounded file:border file:border-border file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:font-medium file:text-text file:cursor-pointer hover:file:bg-surface"
          />
        </FormField>
      )}

      <FormField label="Tags" htmlFor="ev-tags">
        <TagInput value={tags} onChange={setTags} />
      </FormField>

      <FormField label="Expiry date" htmlFor="ev-expiry" hint="Evidence past this date is flagged stale. Leave blank for none.">
        <Input
          id="ev-expiry"
          type="date"
          className="font-data text-sm"
          value={expiresAt ?? ''}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </FormField>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" size="md" type="button">
            Cancel
          </Button>
        </DialogClose>
        <Button variant="primary" size="md" type="submit" loading={submitting}>
          {isEdit ? 'Save changes' : 'Add evidence'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ================================================================== */
/* Control link manager (add / remove control links for one item)       */
/* ================================================================== */

export function ControlLinkManager({ clientId, evidence }: { clientId: number; evidence: Evidence }) {
  const invalidate = useEvidenceInvalidate(clientId);
  const [busy, setBusy] = React.useState(false);
  const [picker, setPicker] = React.useState('');

  const { data: controls = [] } = useQuery<ControlRow[]>({
    queryKey: ['controls', clientId],
    queryFn: () => controlsApi.list(clientId),
    enabled: clientId != null,
  });

  const linkedIds = new Set((evidence.linked_controls ?? []).map((c) => c.control_row_id));
  const available = controls.filter((c) => !linkedIds.has(c.id));

  const doLink = async (rowId: number) => {
    setBusy(true);
    try {
      await evidenceApi.link(clientId, evidence.id, rowId);
      await invalidate();
      setPicker('');
      toast.success('Linked to control.');
    } catch {
      toast.error('Failed to link.');
    } finally {
      setBusy(false);
    }
  };
  const doUnlink = async (rowId: number) => {
    setBusy(true);
    try {
      await evidenceApi.unlink(clientId, evidence.id, rowId);
      await invalidate();
      toast.success('Unlinked from control.');
    } catch {
      toast.error('Failed to unlink.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
        Linked controls ({evidence.linked_controls?.length ?? 0})
      </p>
      {evidence.linked_controls && evidence.linked_controls.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {evidence.linked_controls.map((c) => (
            <li
              key={c.control_row_id}
              className="flex items-center gap-2 text-sm bg-surface-2 rounded px-2 py-1.5"
            >
              <span className="font-data text-xs text-text-muted">{c.control_id}</span>
              <span className="flex-1 truncate text-text">{c.title}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void doUnlink(c.control_row_id)}
                className="rounded p-1 text-text-muted hover:text-destructive hover:bg-surface disabled:opacity-50"
                aria-label={`Unlink from ${c.control_id}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">Not linked to any control yet.</p>
      )}

      {available.length > 0 && (
        <Select
          value={picker}
          onValueChange={(v) => {
            const rowId = Number(v);
            if (rowId) void doLink(rowId);
          }}
        >
          <SelectTrigger className="h-9 text-xs" aria-label="Link to a control" disabled={busy}>
            <SelectValue placeholder="Link to a control…" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {available.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                <span className="font-data text-text-muted mr-2">{c.control_id}</span>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/* ================================================================== */
/* Preview dialog                                                       */
/* ================================================================== */

export function EvidencePreviewDialog({
  evidence,
  clientId,
  onOpenChange,
  onEdit,
}: {
  evidence: Evidence | null;
  clientId: number;
  onOpenChange: (open: boolean) => void;
  onEdit: (ev: Evidence) => void;
}) {
  const invalidate = useEvidenceInvalidate(clientId);
  const [deleting, setDeleting] = React.useState(false);
  const open = evidence != null;

  // Keep a live copy so link/unlink updates reflect without closing. The seed
  // renders instantly but is treated as stale so the dialog always refetches the
  // authoritative server state on open (and after link/unlink invalidation).
  const { data: live } = useQuery<Evidence>({
    queryKey: ['evidence-item', clientId, evidence?.id],
    queryFn: () => evidenceApi.get(clientId, evidence!.id),
    enabled: open,
    initialData: evidence ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 0,
  });
  const ev = live ?? evidence;

  const doDelete = async () => {
    if (!ev) return;
    if (!window.confirm(`Delete "${ev.label}" from the library? This removes it from all linked controls.`)) return;
    setDeleting(true);
    try {
      await evidenceApi.remove(clientId, ev.id);
      await invalidate();
      toast.success('Evidence deleted.');
      onOpenChange(false);
    } catch {
      toast.error('Failed to delete.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {ev && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <EvidenceKindIcon evidence={ev} />
                <span className="truncate">{ev.label}</span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span className="capitalize">{ev.kind}</span>
                <ExpiryBadge evidence={ev} />
              </DialogDescription>
            </DialogHeader>

            {/* Body grid: preview + metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-md border border-border bg-surface-2 p-3 flex items-center justify-center min-h-[160px]">
                {ev.previewable ? (
                  <img
                    src={evidenceApi.downloadUrl(ev.id)}
                    alt={ev.label}
                    className="max-h-64 max-w-full rounded object-contain"
                  />
                ) : ev.kind === 'link' ? (
                  <a
                    href={ev.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent hover:underline break-all text-center"
                  >
                    {ev.url}
                  </a>
                ) : ev.kind === 'note' ? (
                  <p className="text-sm text-text whitespace-pre-wrap max-h-64 overflow-y-auto w-full">
                    {ev.text}
                  </p>
                ) : (
                  <div className="text-center text-text-muted">
                    <FileIcon className="h-10 w-10 mx-auto mb-2" aria-hidden="true" />
                    <p className="text-xs">{ev.mime}</p>
                    {ev.size != null && <p className="text-xs">{(ev.size / 1024).toFixed(1)} KB</p>}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {ev.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {ev.tags.map((t) => (
                      <TagChip key={t}>{t}</TagChip>
                    ))}
                  </div>
                )}
                <ControlLinkManager clientId={clientId} evidence={ev} />
              </div>
            </div>

            {/* Actions */}
            <DialogFooter className="sm:justify-between">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void doDelete()}
                loading={deleting}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </Button>
              <div className="flex gap-2">
                {ev.kind === 'file' && (
                  <>
                    <a
                      href={evidenceApi.viewUrl(ev.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 h-8 text-xs font-medium text-text hover:bg-surface-2 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Open
                    </a>
                    <a
                      href={evidenceApi.downloadUrl(ev.id)}
                      download={ev.label}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 h-8 text-xs font-medium text-text hover:bg-surface-2 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download
                    </a>
                  </>
                )}
                <Button variant="secondary" size="sm" onClick={() => onEdit(ev)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
