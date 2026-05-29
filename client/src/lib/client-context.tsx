import * as React from 'react';

interface ClientContextValue {
  selectedClientId: number | null;
  setSelectedClientId: (id: number | null) => void;
}

const ClientContext = React.createContext<ClientContextValue | null>(null);

const STORAGE_KEY = 'aegis-selected-client';

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [selectedClientId, setSelectedClientIdState] = React.useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : null;
  });

  const setSelectedClientId = React.useCallback((id: number | null) => {
    setSelectedClientIdState(id);
    if (id == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
    }
  }, []);

  return (
    <ClientContext.Provider value={{ selectedClientId, setSelectedClientId }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useSelectedClient(): ClientContextValue {
  const ctx = React.useContext(ClientContext);
  if (!ctx) throw new Error('useSelectedClient must be used inside ClientProvider');
  return ctx;
}
