import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { STATUSES, STATUS_LABELS } from '@aegis/shared';
import type { ControlUpdateInput, Status } from '@aegis/shared';
import { controlsApi, ApiError } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { Label } from '@/components/ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  controlRowIds: number[];
  /** Called after a successful bulk update (to clear selection). */
  onApplied: () => void;
}

/**
 * Apply one change to many controls at once. Each field has an "include" toggle;
 * only included fields are sent, mirroring the partial-patch model the single
 * control editor uses. Mark a whole theme not-applicable with one justification.
 */
export function BulkEditDialog({
  open,
  onOpenChange,
  clientId,
  controlRowIds,
  onApplied,
}: BulkEditDialogProps) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = React.useState(false);

  // Which fields are included in this bulk edit, plus their values.
  const [incApplicable, setIncApplicable] = React.useState(false);
  const [applicable, setApplicable] = React.useState(false);
  const [incStatus, setIncStatus] = React.useState(false);
  const [status, setStatus] = React.useState<Status>('not_started');
  const [incOwner, setIncOwner] = React.useState(false);
  const [owner, setOwner] = React.useState('');
  const [incDue, setIncDue] = React.useState(false);
  const [due, setDue] = React.useState('');
  const [incJust, setIncJust] = React.useState(false);
  const [just, setJust] = React.useState('');

  // Reset the form whenever the dialog opens.
  React.useEffect(() => {
    if (open) {
      setIncApplicable(false);
      setApplicable(false);
      setIncStatus(false);
      setStatus('not_started');
      setIncOwner(false);
      setOwner('');
      setIncDue(false);
      setDue('');
      setIncJust(false);
      setJust('');
    }
  }, [open]);

  const count = controlRowIds.length;

  function buildPatch(): Partial<ControlUpdateInput> {
    const patch: Partial<ControlUpdateInput> = {};
    if (incApplicable) patch.applicable = applicable;
    if (incStatus) patch.status = status;
    if (incOwner) patch.owner = owner.trim() === '' ? null : owner.trim();
    if (incDue) patch.due_date = due === '' ? null : due;
    if (incJust) patch.applicability_justification = just.trim() === '' ? null : just.trim();
    return patch;
  }

  const patch = buildPatch();
  const nothingSelected = Object.keys(patch).length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nothingSelected) return;
    setSubmitting(true);
    try {
      const result = await controlsApi.bulkUpdate(clientId, {
        control_row_ids: controlRowIds,
        patch: patch as ControlUpdateInput,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['controls', clientId] }),
        queryClient.invalidateQueries({ queryKey: ['owners', clientId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', clientId] }),
        queryClient.invalidateQueries({ queryKey: ['audit'] }),
      ]);
      toast.success(`Updated ${result.updated} control${result.updated === 1 ? '' : 's'}.`);
      onApplied();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Bulk update failed.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk edit {count} control{count === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            Toggle the fields you want to change. Only the fields you enable are applied to the
            selected controls.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-3">
            {/* Applicable */}
            <FieldRow
              id="bulk-applicable"
              label="Applicability"
              enabled={incApplicable}
              onEnabledChange={setIncApplicable}
            >
              <div className="flex items-center gap-3 pt-1">
                <Switch
                  id="bulk-applicable-value"
                  checked={applicable}
                  onCheckedChange={setApplicable}
                  aria-label="Set applicable"
                />
                <span className="text-sm text-text">
                  {applicable ? 'Applicable' : 'Not applicable'}
                </span>
              </div>
            </FieldRow>

            {/* Status */}
            <FieldRow id="bulk-status" label="Status" enabled={incStatus} onEnabledChange={setIncStatus}>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger id="bulk-status-value" aria-label="Set status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>

            {/* Owner */}
            <FieldRow id="bulk-owner" label="Owner" enabled={incOwner} onEnabledChange={setIncOwner}>
              <Input
                id="bulk-owner-value"
                placeholder="e.g. Jane Smith (leave blank to clear)"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              />
            </FieldRow>

            {/* Due date */}
            <FieldRow id="bulk-due" label="Due date" enabled={incDue} onEnabledChange={setIncDue}>
              <Input
                id="bulk-due-value"
                type="date"
                className="font-data text-sm"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </FieldRow>

            {/* Applicability justification */}
            <FieldRow
              id="bulk-just"
              label="Applicability justification"
              enabled={incJust}
              onEnabledChange={setIncJust}
            >
              <Textarea
                id="bulk-just-value"
                rows={3}
                placeholder="e.g. Not applicable — fully outsourced to SaaS provider."
                value={just}
                onChange={(e) => setJust(e.target.value)}
              />
            </FieldRow>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={nothingSelected} loading={submitting}>
              Apply to {count} control{count === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A bulk-edit field: an include toggle and, when enabled, its input. */
function FieldRow({
  id,
  label,
  enabled,
  onEnabledChange,
  children,
}: {
  id: string;
  label: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2.5">
        <input
          id={`${id}-include`}
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="h-4 w-4 accent-accent cursor-pointer"
        />
        <Label htmlFor={`${id}-include`} className="cursor-pointer font-medium">
          {label}
        </Label>
      </div>
      {enabled && <div className="mt-2.5">{children}</div>}
    </div>
  );
}
