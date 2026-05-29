import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Download, Key, Sun, Moon, FileDown } from 'lucide-react';
import { changePasswordSchema } from '@aegis/shared';
import type { ChangePasswordInput } from '@aegis/shared';
import { authApi, exportApi, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useSelectedClient } from '@/lib/client-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/FormField';
import { getInitialTheme, persistTheme } from '@/lib/theme';
import type { Theme } from '@/lib/theme';

export function SettingsPage() {
  const { onLocked } = useAuth();
  const { selectedClientId } = useSelectedClient();

  return (
    <div className="animate-fade-in max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text">Settings</h2>
        <p className="text-sm text-text-muted mt-1">Security, appearance, and data management.</p>
      </div>

      <div className="flex flex-col gap-6">
        <ChangePasswordCard onLocked={onLocked} />
        <ThemeCard />
        <DataCard clientId={selectedClientId} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Change password                                                       */
/* ------------------------------------------------------------------ */
function ChangePasswordCard({ onLocked }: { onLocked: () => void }) {
  const [showPw, setShowPw] = React.useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = async (data: ChangePasswordInput) => {
    try {
      const result = await authApi.changePassword(data.currentPassword, data.newPassword);
      reset();
      if (result.relock) {
        toast.success('Password changed. Please unlock again with your new password.');
        onLocked();
      } else {
        toast.success('Password changed successfully.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('currentPassword', { message: 'Incorrect current password.' });
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Failed to change password.');
      }
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface shadow-elev-1 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Key className="h-4 w-4 text-text-muted" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-text">Master password</h3>
      </div>
      <p className="text-sm text-text-muted mb-4">
        Changing the master password re-encrypts the entire database. You will need to unlock again
        with the new password.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <FormField
          label="Current password"
          htmlFor="cur-pw"
          error={errors.currentPassword?.message}
          required
        >
          <Input
            id="cur-pw"
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
        </FormField>

        <FormField
          label="New password"
          htmlFor="new-pw"
          error={errors.newPassword?.message}
          hint="Minimum 8 characters"
          required
        >
          <Input
            id="new-pw"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
        </FormField>

        <div className="flex items-center gap-2">
          <input
            id="show-pw-toggle"
            type="checkbox"
            checked={showPw}
            onChange={(e) => setShowPw(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          <label htmlFor="show-pw-toggle" className="text-xs text-text-muted cursor-pointer">
            Show passwords
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="md" loading={isSubmitting}>
            Change password
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Theme preference                                                      */
/* ------------------------------------------------------------------ */
function ThemeCard() {
  const [theme, setTheme] = React.useState<Theme>(getInitialTheme);

  const handleTheme = (t: Theme) => {
    setTheme(t);
    persistTheme(t);
  };

  return (
    <section className="rounded-lg border border-border bg-surface shadow-elev-1 p-6">
      <div className="flex items-center gap-2 mb-4">
        {theme === 'light' ? (
          <Sun className="h-4 w-4 text-text-muted" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4 text-text-muted" aria-hidden="true" />
        )}
        <h3 className="text-sm font-semibold text-text">Appearance</h3>
      </div>

      <div className="flex gap-3" role="group" aria-label="Choose theme">
        <ThemeOption
          id="theme-light"
          label="Light"
          selected={theme === 'light'}
          onClick={() => handleTheme('light')}
        />
        <ThemeOption
          id="theme-dark"
          label="Dark"
          selected={theme === 'dark'}
          onClick={() => handleTheme('dark')}
        />
      </div>
    </section>
  );
}

function ThemeOption({
  id,
  label,
  selected,
  onClick,
}: {
  id: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      aria-pressed={selected}
      className={`flex-1 rounded-md border py-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-border bg-surface-2 text-text hover:bg-surface-2'
      }`}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Data management                                                       */
/* ------------------------------------------------------------------ */
function DataCard({ clientId }: { clientId: number | null }) {
  return (
    <section className="rounded-lg border border-border bg-surface shadow-elev-1 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Download className="h-4 w-4 text-text-muted" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-text">Data &amp; exports</h3>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-md bg-surface-2">
          <div>
            <p className="text-sm font-medium text-text">Download backup</p>
            <p className="text-xs text-text-muted mt-0.5">
              Encrypted <span className="font-data">aegis.db</span> — can be restored on any instance.
            </p>
          </div>
          <a
            href={exportApi.backupUrl()}
            download="aegis.db"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 h-8 text-xs font-medium text-text hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Download encrypted backup"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download
          </a>
        </div>

        {clientId && (
          <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-md bg-surface-2">
            <div>
              <p className="text-sm font-medium text-text">Export SoA (CSV)</p>
              <p className="text-xs text-text-muted mt-0.5">
                Statement of Applicability for the current engagement.
              </p>
            </div>
            <a
              href={exportApi.csvUrl(clientId)}
              download={`soa-${clientId}.csv`}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 h-8 text-xs font-medium text-text hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Download SoA CSV export"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
