import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { api, friendlyError } from './api';
import type { Dashboard, User } from './types';

/**
 * Loads data when the screen gains focus and exposes pull-to-refresh.
 * Pass a `useCallback`-wrapped loader; it re-runs when its identity changes.
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const run = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await load();
      if (ticket === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (ticket === latest.current) setError(friendlyError(e));
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      run();
    }, [run]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await run();
    setRefreshing(false);
  }, [run]);

  return { data, error, loading: data === undefined && !error, refreshing, refresh, reload: run };
}

/** Runs a mutation with busy and error state for a form. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

// ---- signed-in owner ------------------------------------------------------

interface Session {
  /** undefined while the stored session is being read. */
  user: User | null | undefined;
}
const SessionContext = createContext<Session>({ user: undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api.getUser().then((u) => live && setUser(u));
    const stop = api.onAuthChange((u) => live && setUser(u));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return <SessionContext.Provider value={{ user }}>{children}</SessionContext.Provider>;
}
export const useSession = () => useContext(SessionContext);

// ---- the owner's dashboard, shared by every manage screen -----------------

interface DashboardState {
  /** undefined while loading, null when the owner has no page yet. */
  dash: Dashboard | null | undefined;
  error: string | null;
  reload: () => Promise<void>;
}
const DashboardContext = createContext<DashboardState>({ dash: undefined, error: null, reload: async () => {} });

/** Mount with `key={userId}` so each account starts from a clean slate. */
export function DashboardProvider({ userId, children }: { userId: string | null | undefined; children: ReactNode }) {
  // Signed out (null) means there is nothing to load.
  const [dash, setDash] = useState<Dashboard | null | undefined>(userId === null ? null : undefined);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDash(await api.getDashboard());
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    api.getDashboard().then(
      (d) => live && setDash(d),
      (e) => live && setError(friendlyError(e)),
    );
    return () => {
      live = false;
    };
  }, [userId]);

  return <DashboardContext.Provider value={{ dash, error, reload }}>{children}</DashboardContext.Provider>;
}
export const useDashboard = () => useContext(DashboardContext);

/** For screens that only render once a dashboard exists. */
export function useReadyDashboard() {
  const { dash, reload } = useDashboard();
  if (!dash) throw new Error('Dashboard is not loaded');
  return { ...dash, reload };
}
