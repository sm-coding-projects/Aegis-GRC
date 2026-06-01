import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Layers, Trash2, Check, Plus } from 'lucide-react';
import type { ControlTemplate } from '@aegis/shared';
import { templatesApi, clientsApi, ApiError } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import { Skeleton } from '@/components/ui/Skeleton';

interface TemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
}

/**
 * Manage reusable applicability templates: save the current engagement's
 * applicability decisions as a named baseline, and apply a saved baseline to the
 * current engagement (overwriting applicable + justification for matching
 * controls). Applying is auditable and reversible via each control's history.
 */
export function TemplatesDialog({ open, onOpenChange, clientId }: TemplatesDialogProps) {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<ControlTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
    enabled: open,
  });

  const { data: client } = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => clientsApi.get(clientId),
    enabled: open,
  });

  // Create form
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  // Per-row busy + confirm state
  const [confirmApplyId, setConfirmApplyId] = React.useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<number | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setConfirmApplyId(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  const refreshTemplates = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === '') return;
    setCreating(true);
    try {
      await templatesApi.create({
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        from_client_id: clientId,
      });
      await refreshTemplates();
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      setName('');
      setDescription('');
      toast.success('Template saved.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save template.';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleApply = async (template: ControlTemplate) => {
    setBusyId(template.id);
    try {
      const result = await templatesApi.apply(clientId, template.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['controls', clientId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', clientId] }),
        queryClient.invalidateQueries({ queryKey: ['audit'] }),
      ]);
      toast.success(
        `Applied "${template.name}" — ${result.applied} control${result.applied === 1 ? '' : 's'} updated.`,
      );
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to apply template.';
      toast.error(msg);
    } finally {
      setBusyId(null);
      setConfirmApplyId(null);
    }
  };

  const handleDelete = async (template: ControlTemplate) => {
    setBusyId(template.id);
    try {
      await templatesApi.remove(template.id);
      await refreshTemplates();
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success('Template deleted.');
    } catch {
      toast.error('Failed to delete template.');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-text-muted" aria-hidden="true" />
            Control templates
          </DialogTitle>
          <DialogDescription>
            Save the current engagement&rsquo;s applicability decisions as a reusable baseline, then
            apply it to other engagements. Templates capture which controls apply and why — not
            owners, status, or dates.
          </DialogDescription>
        </DialogHeader>

        {/* Save current engagement as a new template */}
        <form
          onSubmit={handleCreate}
          noValidate
          className="rounded-md border border-border bg-surface-2 p-4 flex flex-col gap-3"
        >
          <div>
            <Label htmlFor="tpl-name" className="font-medium">
              Save current engagement as template
            </Label>
            <p className="text-xs text-text-muted mt-0.5">
              Snapshots applicability for all 93 controls{client ? ` from “${client.name}”` : ''}.
            </p>
          </div>
          <Input
            id="tpl-name"
            placeholder="Template name (e.g. SaaS vendor baseline)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
          <Textarea
            id="tpl-desc"
            rows={2}
            placeholder="Optional description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={name.trim() === ''}
              loading={creating}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Save template
            </Button>
          </div>
        </form>

        {/* Existing templates */}
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-text mb-2">
            Saved templates {templates.length > 0 && <span className="text-text-muted font-normal">({templates.length})</span>}
          </h3>

          {isLoading ? (
            <Skeleton className="h-20" />
          ) : templates.length === 0 ? (
            <p className="text-sm text-text-muted py-3">
              No templates yet. Save one above to reuse its applicability decisions on future
              engagements.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 max-h-72 overflow-y-auto">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-md border border-border bg-surface"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">{t.name}</p>
                    {t.description && (
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{t.description}</p>
                    )}
                    <p className="font-data text-xs text-text-muted mt-1">{t.item_count} controls</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {confirmApplyId === t.id ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busyId === t.id}
                          onClick={() => void handleApply(t)}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Confirm
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmApplyId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : confirmDeleteId === t.id ? (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          loading={busyId === t.id}
                          onClick={() => void handleDelete(t)}
                        >
                          Delete
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setConfirmDeleteId(null);
                            setConfirmApplyId(t.id);
                          }}
                          title="Apply this template to the current engagement"
                        >
                          Apply
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setConfirmApplyId(null);
                            setConfirmDeleteId(t.id);
                          }}
                          aria-label={`Delete template ${t.name}`}
                          title="Delete template"
                        >
                          <Trash2 className="h-4 w-4 text-text-muted" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
