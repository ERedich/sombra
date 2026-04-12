import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { AuthUser } from '@sombra/shared';

import { loginRequest, meRequest, postAuthLogout } from '@/lib/api';
import { clearSession, getStoredUser, getToken, setSession } from '@/lib/sessionStorage';

type AuthState = {
  user: AuthUser | null
  loading: boolean
  signIn: (
    login_name: string,
    password: string,
  ) => Promise<{ parallel_session_warning: boolean }>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    const u = await meRequest();
    setUser(u);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getStoredUser();
        const token = await getToken();
        if (!stored || !token) {
          if (!cancelled) {
            setUser(null);
            setLoading(false);
          }
          return;
        }
        if (!cancelled) setUser(stored);
        await refreshUser();
      } catch {
        await clearSession();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  const signIn = useCallback(async (login_name: string, password: string) => {
    const { token, user: next, parallel_session_warning } =
      await loginRequest(login_name, password);
    await setSession(token, next);
    setUser(next);
    return { parallel_session_warning };
  }, []);

  const signOut = useCallback(async () => {
    await postAuthLogout();
    await clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn,
      signOut,
      refreshUser,
    }),
    [user, loading, signIn, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
