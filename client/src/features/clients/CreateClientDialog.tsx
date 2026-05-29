import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clientCreateSchema } from '@aegis/shared';
import type { ClientCreateInput } from '@aegis/shared';
import { clientsApi, ApiError } from '@/lib/api';
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

interface CreateClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (clientId: number) => void;
}

export function CreateClientDialog({ open, onOpenChange, onCreated }: CreateClientDialogProps) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClientCreateInput>({
    resolver: zodResolver(clientCreateSchema),
    defaultValues: { name: '', description: null },
  });

  const onSubmit = async (data: ClientCreateInput) => {
    try {
      const client = await clientsApi.create(data);
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(`"${client.name}" created. Controls seeded from ISO 27001:2022.`);
      reset();
      onOpenChange(false);
      onCreated?.(client.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to create client.';
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New client engagement</DialogTitle>
          <DialogDescription>
            Creates an engagement with all 93 Annex A controls pre-seeded.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <FormField label="Client name" htmlFor="client-name" error={errors.name?.message} required>
            <Input
              id="client-name"
              placeholder="Acme Corp"
              autoFocus
              {...register('name')}
              error={errors.name?.message}
            />
          </FormField>

          <FormField
            label="Description"
            htmlFor="client-desc"
            error={errors.description?.message}
          >
            <Textarea
              id="client-desc"
              placeholder="Optional — scope, notes, context"
              rows={3}
              {...register('description')}
              error={errors.description?.message}
            />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="md" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="primary" size="md" type="submit" loading={isSubmitting}>
              Create engagement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
