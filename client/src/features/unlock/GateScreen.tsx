import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Shield, Upload, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { authApi, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/FormField';
import { masterPasswordSchema } from '@aegis/shared';

/* ---------- unlock schema ---------- */
const unlockFormSchema = z.object({
  password: z.string().min(1, 'Password is required').max(256),
});

/* ---------- create schema (confirm-password) ---------- */
const createFormSchema = z
  .object({
    password: masterPasswordSchema,
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type Mode = 'unlock' | 'create' | 'restore';

export function GateScreen() {
  const { needsSetup, onUnlocked, refresh } = useAuth();
  const [mode, setMode] = React.useState<Mode>(needsSetup ? 'create' : 'unlock');
  const [showPw, setShowPw] = React.useState(false);

  // Sync mode when needsSetup changes (e.g. after restore)
  React.useEffect(() => {
    setMode(needsSetup ? 'create' : 'unlock');
  }, [needsSetup]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4">
      {/* ---- Wordmark ---- */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center">
            <Shield className="h-5 w-5 text-accent-fg" aria-hidden="true" />
          </div>
          <span className="text-2xl font-semibold tracking-tight text-text">Aegis GRC</span>
        </div>
        <p className="text-sm text-text-muted text-center">
          ISO/IEC 27001:2022 Annex A control tracker
        </p>
      </div>

      {/* ---- Card ---- */}
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface shadow-elev-2 p-6 animate-fade-in">
        {mode === 'create' && <CreateForm onUnlocked={onUnlocked} showPw={showPw} setShowPw={setShowPw} />}
        {mode === 'unlock' && (
          <UnlockForm
            onUnlocked={onUnlocked}
            showPw={showPw}
            setShowPw={setShowPw}
            onRestoreClick={() => setMode('restore')}
          />
        )}
        {mode === 'restore' && (
          <RestoreForm
            onRestored={async () => {
              await refresh();
              setMode('unlock');
            }}
            onBack={() => setMode('unlock')}
          />
        )}
      </div>

      <p className="mt-6 text-xs text-text-muted">
        Self-hosted · Encrypted at rest · Single container
      </p>
    </div>
  );
}

/* ================================================================== */
/* Unlock form                                                          */
/* ================================================================== */
interface UnlockFormProps {
  onUnlocked: (token: string) => void;
  showPw: boolean;
  setShowPw: (v: boolean) => void;
  onRestoreClick: () => void;
}

function UnlockForm({ onUnlocked, showPw, setShowPw, onRestoreClick }: UnlockFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(unlockFormSchema), defaultValues: { password: '' } });

  const onSubmit = async ({ password }: { password: string }) => {
    try {
      const res = await authApi.unlock(password);
      onUnlocked(res.csrfToken);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError('password', { message: 'Too many attempts, try again later.' });
        } else {
          setError('password', { message: 'Incorrect password.' });
        }
      } else {
        setError('password', { message: 'Could not reach the server. Try again.' });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="flex items-center gap-2 mb-5">
        <Lock className="h-4 w-4 text-accent" aria-hidden="true" />
        <h1 className="text-base font-semibold text-text">Unlock Aegis</h1>
      </div>

      <FormField label="Master password" htmlFor="password" error={errors.password?.message} required>
        <div className="relative">
          <Input
            id="password"
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            error={errors.password?.message}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text p-1 rounded transition-colors"
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </FormField>

      <Button
        type="submit"
        variant="primary"
        size="md"
        className="w-full mt-4"
        loading={isSubmitting}
      >
        Unlock
      </Button>

      <div className="mt-4 border-t border-border pt-4">
        <button
          type="button"
          onClick={onRestoreClick}
          className="w-full text-sm text-text-muted hover:text-text transition-colors text-center"
        >
          Restore from backup instead
        </button>
      </div>
    </form>
  );
}

/* ================================================================== */
/* Create master password form                                          */
/* ================================================================== */
interface CreateFormProps {
  onUnlocked: (token: string) => void;
  showPw: boolean;
  setShowPw: (v: boolean) => void;
}

function CreateForm({ onUnlocked, showPw, setShowPw }: CreateFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createFormSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async ({ password }: { password: string; confirm: string }) => {
    try {
      const res = await authApi.create(password);
      onUnlocked(res.csrfToken);
      toast.success('Master password set. Welcome to Aegis GRC.');
    } catch (err) {
      if (err instanceof ApiError) {
        setError('password', { message: err.message });
      } else {
        setError('password', { message: 'Could not reach the server. Try again.' });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="mb-5">
        <h1 className="text-base font-semibold text-text">Create master password</h1>
        <p className="text-sm text-text-muted mt-1">
          This password encrypts all your data. There is no recovery path — keep it safe.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <FormField
          label="Master password"
          htmlFor="pw-create"
          error={errors.password?.message}
          hint="Minimum 8 characters"
          required
        >
          <div className="relative">
            <Input
              id="pw-create"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              error={errors.password?.message}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text p-1 rounded transition-colors"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </FormField>

        <FormField
          label="Confirm password"
          htmlFor="pw-confirm"
          error={errors.confirm?.message}
          required
        >
          <Input
            id="pw-confirm"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
        </FormField>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="md"
        className="w-full mt-4"
        loading={isSubmitting}
      >
        Create and unlock
      </Button>
    </form>
  );
}

/* ================================================================== */
/* Restore from backup form                                             */
/* ================================================================== */
interface RestoreFormProps {
  onRestored: () => Promise<void>;
  onBack: () => void;
}

function RestoreForm({ onRestored, onBack }: RestoreFormProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    try {
      await authApi.restore(file);
      toast.success('Backup restored. Enter your master password to unlock.');
      await onRestored();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Upload failed. Try again.';
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-base font-semibold text-text">Restore from backup</h1>
        <p className="text-sm text-text-muted mt-1">
          Upload an existing <code className="font-data text-xs">aegis.db</code> file. You'll then
          unlock it with your original password.
        </p>
      </div>

      <label
        htmlFor="restore-file"
        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-accent hover:bg-surface-2 transition-colors"
      >
        <Upload className="h-8 w-8 text-text-muted" aria-hidden="true" />
        <span className="text-sm font-medium text-text">
          {file ? file.name : 'Click to select aegis.db'}
        </span>
        <span className="text-xs text-text-muted">SQLite encrypted database file</span>
        <input
          id="restore-file"
          type="file"
          accept=".db"
          className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="flex gap-2 mt-4">
        <Button variant="secondary" size="md" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={handleUpload}
          disabled={!file}
          loading={isUploading}
          className="flex-1"
        >
          Restore
        </Button>
      </div>
    </div>
  );
}
