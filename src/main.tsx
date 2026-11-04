import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { del, get, set } from 'idb-keyval';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

import { supabase } from './data/supabase';
import { applyTheme, forgetSession, hadSession, initialTheme, useOnline, useSession } from './data/hooks';
import { Layout } from './components/Layout';
import { Login } from './components/Login';
import { Overview } from './pages/Overview';
import { Accounts } from './pages/Accounts';
import { Register } from './pages/Register';
import { Stats } from './pages/Stats';
import { Trend } from './pages/Trend';
import { CategoriesPayees } from './pages/CategoriesPayees';
import { More } from './pages/More';

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

/** Old /accounts/:id links now open the Transactions page filtered to that account. */
function AccountRedirect() {
  const { id } = useParams();
  return <Navigate to={`/transactions?account=${id}`} replace />;
}

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

  return (
    <Routes>
      <Route element={<Layout onSignOut={signOut} email={session?.user.email ?? ''} />}>
        <Route index element={<Overview />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:id" element={<AccountRedirect />} />
        <Route path="transactions" element={<Register />} />
        <Route path="stats" element={<Stats />} />
        <Route path="trend" element={<Trend />} />
        <Route path="categories" element={<CategoriesPayees />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
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
