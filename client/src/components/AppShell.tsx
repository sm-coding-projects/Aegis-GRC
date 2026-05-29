import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ClientProvider } from '@/lib/client-context';

export function AppShell() {
  return (
    <ClientProvider>
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-[1280px] mx-auto px-6 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </ClientProvider>
  );
}
