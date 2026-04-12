import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getAppParameters } from '@/lib/cmmsApi';
import type { WoAppSettings } from '@/lib/cmmsTypes';

const WoAppSettingsContext = createContext<WoAppSettings | null>(null);

export function WoAppSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [value, setValue] = useState<WoAppSettings>({
    start_requires_assignment: true,
    user_auto_assign_on_start: true,
    idle_session_timeout_minutes: 0,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getAppParameters();
        if (cancelled) return;
        const idleRaw = data.general?.idle_session_timeout_minutes;
        const idle =
          typeof idleRaw === 'number' && Number.isInteger(idleRaw) && idleRaw > 0
            ? idleRaw
            : 0;
        setValue({
          start_requires_assignment:
            data.wo?.start_requires_assignment !== false,
          user_auto_assign_on_start:
            data.wo?.user_auto_assign_on_start !== false,
          idle_session_timeout_minutes: idle,
        });
      } catch {
        if (!cancelled) {
          setValue({
            start_requires_assignment: true,
            user_auto_assign_on_start: true,
            idle_session_timeout_minutes: 0,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const memo = useMemo(() => value, [value]);
  return (
    <WoAppSettingsContext.Provider value={memo}>
      {children}
    </WoAppSettingsContext.Provider>
  );
}

export function useWoAppSettings(): WoAppSettings {
  const ctx = useContext(WoAppSettingsContext);
  if (!ctx) {
    throw new Error('useWoAppSettings must be used within WoAppSettingsProvider');
  }
  return ctx;
}
