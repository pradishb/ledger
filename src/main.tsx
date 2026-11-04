import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { del, get, set } from 'idb-keyval';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';

import { supabase } from './data/supabase';
import { applyTheme, forgetSession, hadSession, initialTheme, useOnline, useSession } from './data/hooks';
import { Login } from './components/Login';
import { AppRoutes } from './routes';

const MONTH = 1000 * 60 * 60 * 24 * 30;
const CACHE_KEY = 'ledger.cache';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { gcTime: MONTH, staleTime: 30_000, networkMode: 'offlineFirst', retry: 1 },
  },
});

// The last loaded data is kept in IndexedDB so the app opens (read-only) offline.
const persister = createAsyncStoragePersister({
  key: CACHE_KEY,
  storage: { getItem: k => get<string>(k), setItem: (k, v) => set(k, v), removeItem: k => del(k) },
});

applyTheme(initialTheme());

function App() {
  const { session, loading } = useSession();
  const online = useOnline();

  const signOut = useCallback(async () => {
    forgetSession();
    queryClient.clear();
    await del(CACHE_KEY);
    await supabase.auth.signOut();
  }, []);

  if (loading) return null;
  // Offline, an expired token can't be refreshed; still show the cached data.
  if (!session && !(!online && hadSession())) return <Login />;

  return <AppRoutes onSignOut={signOut} email={session?.user.email ?? ''} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: MONTH, buster: 'v2' }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);
