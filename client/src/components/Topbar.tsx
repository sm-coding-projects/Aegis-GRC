import * as React from 'react';
import { LogOut, Sun, Moon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { authApi, clientsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useSelectedClient } from '@/lib/client-context';
import { persistTheme, getInitialTheme } from '@/lib/theme';
import type { Theme } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/Tooltip';

export function Topbar() {
  const { onLocked } = useAuth();
  const { selectedClientId } = useSelectedClient();
  const [theme, setTheme] = React.useState<Theme>(getInitialTheme);
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
    staleTime: 60_000,
  });

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  const handleToggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    persistTheme(next);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await authApi.logout();
    } catch {
      // If logout fails server-side, still lock the client
    } finally {
      onLocked();
      setIsLoggingOut(false);
    }
  };

  return (
    <TooltipProvider delayDuration={400}>
      <header className="flex items-center justify-between h-14 px-6 border-b border-border bg-surface shrink-0">
        {/* Current client name */}
        <div>
          {selectedClient ? (
            <div>
              <h1 className="text-sm font-semibold text-text leading-none">{selectedClient.name}</h1>
              {selectedClient.description && (
                <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">
                  {selectedClient.description}
                </p>
              )}
            </div>
          ) : (
            <span className="text-sm text-text-muted">No engagement selected</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Theme toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleTheme}
                aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              >
                {theme === 'light' ? (
                  <Moon className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Sun className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            </TooltipContent>
          </Tooltip>

          {/* Lock / logout */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                loading={isLoggingOut}
                aria-label="Lock and log out"
                className={cn(!isLoggingOut && 'text-text-muted hover:text-destructive')}
              >
                {!isLoggingOut && <LogOut className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Lock and log out</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
