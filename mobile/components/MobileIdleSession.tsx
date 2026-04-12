import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';

import { RNView } from '@/lib/rnJsx';

import { useAuth } from '@/context/AuthContext';
import { useWoAppSettings } from '@/context/WoAppSettingsContext';

const CHECK_MS = 45_000;

/**
 * Signs out after `idle_session_timeout_minutes` without user interaction
 * (touches) while the app is in the foreground.
 */
export function MobileIdleSession({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { idle_session_timeout_minutes } = useWoAppSettings();
  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);

  const bump = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') bump();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [bump]);

  useEffect(() => {
    const mins = idle_session_timeout_minutes;
    if (mins <= 0) return undefined;
    firedRef.current = false;
    lastActivityRef.current = Date.now();
    const ms = mins * 60_000;
    const id = setInterval(() => {
      if (firedRef.current) return;
      if (AppState.currentState !== 'active') return;
      if (Date.now() - lastActivityRef.current >= ms) {
        firedRef.current = true;
        void (async () => {
          await signOut();
          Alert.alert(
            'Signed out',
            'You were signed out after a period of inactivity.',
          );
        })();
      }
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [idle_session_timeout_minutes, signOut]);

  return (
    <RNView style={{ flex: 1 }} onTouchStart={bump} collapsable={false}>
      {children}
    </RNView>
  );
}
