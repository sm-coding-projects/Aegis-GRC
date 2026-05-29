import * as React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShieldCheck,
  FolderOpen,
  ScrollText,
  Settings,
  Shield,
  ChevronDown,
  Plus,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { clientsApi } from '@/lib/api';
import { useSelectedClient } from '@/lib/client-context';
import { CreateClientDialog } from '@/features/clients/CreateClientDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/controls', label: 'Controls', icon: ShieldCheck },
  { to: '/evidence', label: 'Evidence', icon: FolderOpen },
  { to: '/reports', label: 'Reports', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const [createOpen, setCreateOpen] = React.useState(false);
  const { selectedClientId, setSelectedClientId } = useSelectedClient();

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  // Auto-select first client if none selected
  React.useEffect(() => {
    if (selectedClientId == null && clients.length > 0) {
      setSelectedClientId(clients[0]!.id);
    }
  }, [clients, selectedClientId, setSelectedClientId]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-surface border-r border-border">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-border">
        <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center shrink-0">
          <Shield className="h-4 w-4 text-accent-fg" aria-hidden="true" />
        </div>
        <span className="font-semibold text-sm tracking-tight text-text">Aegis GRC</span>
      </div>

      {/* Client switcher */}
      <div className="px-3 py-3 border-b border-border">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5 px-1">
          Engagement
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-text',
                'hover:bg-surface-2 transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label="Switch client engagement"
            >
              <Users className="h-4 w-4 text-text-muted shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left truncate">
                {selectedClient?.name ?? 'No client selected'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-text-muted shrink-0" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {clients.length > 0 ? (
              <>
                <DropdownMenuLabel>Engagements</DropdownMenuLabel>
                {clients.map((client) => (
                  <DropdownMenuItem
                    key={client.id}
                    onSelect={() => setSelectedClientId(client.id)}
                    className={cn(
                      selectedClientId === client.id && 'bg-surface-2 font-medium',
                    )}
                  >
                    <span className="truncate">{client.name}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            ) : (
              <DropdownMenuLabel className="text-text-muted">No engagements yet</DropdownMenuLabel>
            )}
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New engagement
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3" aria-label="Main navigation">
        <ul className="flex flex-col gap-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-surface-2 text-text font-medium'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <CreateClientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedClientId(id)}
      />
    </aside>
  );
}
