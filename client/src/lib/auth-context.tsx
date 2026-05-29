import * as React from 'react';
import { authApi, setCsrfToken } from './api';

interface AuthContextValue {
  unlocked: boolean;
  needsSetup: boolean;
  isLoading: boolean;
  /** Called after successful create/unlock; sets CSRF token and flips unlocked. */
  onUnlocked: (csrfToken: string) => void;
  /** Lock the app (logout or re-locked server-side). */
  onLocked: () => void;
  /** Force a re-check of auth state (e.g. after restore). */
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = React.useState(false);
  const [needsSetup, setNeedsSetup] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchStatus = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const status = await authApi.status();
      setUnlocked(status.unlocked);
      setNeedsSetup(status.needsSetup);
      if (status.csrfToken) {
        setCsrfToken(status.csrfToken);
      }
    } catch {
      // Network error — assume locked, not setup
      setUnlocked(false);
      setNeedsSetup(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const onUnlocked = React.useCallback((token: string) => {
    setCsrfToken(token);
    setUnlocked(true);
    setNeedsSetup(false);
  }, []);

  const onLocked = React.useCallback(() => {
    setCsrfToken(null);
    setUnlocked(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ unlocked, needsSetup, isLoading, onUnlocked, onLocked, refresh: fetchStatus }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
