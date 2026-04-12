import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Appearance,
  Platform,
  useColorScheme as useRNColorScheme,
} from 'react-native';

const STORAGE_KEY = 'theme-preference';

export type ThemePreference = 'light' | 'dark' | 'system';

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  resolvedScheme: 'light' | 'dark';
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(
  null,
);

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

export function ThemePreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>('system');
  const systemScheme = useRNColorScheme();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled || raw == null) return;
        const parsed = JSON.parse(raw) as unknown;
        if (isThemePreference(parsed)) {
          setPreferenceState(parsed);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const resolvedScheme: 'light' | 'dark' =
    preference === 'system' ? (systemScheme ?? 'light') : preference;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (preference === 'system') {
      Appearance.setColorScheme(null);
    } else {
      Appearance.setColorScheme(preference);
    }
  }, [preference]);

  const value = useMemo(
    () => ({
      preference,
      setPreference,
      resolvedScheme,
    }),
    [preference, setPreference, resolvedScheme],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceContextValue {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error(
      'useThemePreference must be used within ThemePreferenceProvider',
    );
  }
  return ctx;
}

/** Resolved light/dark for screens; falls back to RN when outside provider. */
export function useResolvedColorScheme(): NonNullable<
  ReturnType<typeof useRNColorScheme>
> {
  const ctx = useContext(ThemePreferenceContext);
  const rnScheme = useRNColorScheme();
  if (ctx) return ctx.resolvedScheme;
  return rnScheme ?? 'light';
}
