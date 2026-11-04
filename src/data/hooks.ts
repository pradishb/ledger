import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

const HAD_SESSION = 'ledger.hadSession';

/** Whether this device has signed in before; lets the cached data open offline. */
export const hadSession = () => {
  try { return localStorage.getItem(HAD_SESSION) === '1'; } catch { return false; }
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const remember = (s: Session | null) => {
      setSession(s);
      try { if (s) localStorage.setItem(HAD_SESSION, '1'); } catch { /* storage unavailable */ }
    };
    supabase.auth.getSession().then(({ data }) => {
      remember(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => remember(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, loading };
}

export const forgetSession = () => {
  try { localStorage.removeItem(HAD_SESSION); } catch { /* storage unavailable */ }
};

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    cb => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}
export const MOBILE = '(max-width: 760px)';
export const useIsMobile = () => useMediaQuery(MOBILE);

export type Theme = 'light' | 'dark';
const THEME_KEY = 'ledger.theme';

export function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#151918' : '#ffffff');
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable */ }
}
