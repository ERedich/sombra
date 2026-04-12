import '../global.css';

import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import {
  RNActivityIndicator,
  RNView,
} from '@/lib/rnJsx';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemePreferenceProvider, useThemePreference } from '@/context/ThemePreferenceContext';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

/** Matches web Lara dark theme tokens (surface-ground / surface-card / primary). */
const navigationDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#fbbf24',
    background: '#111827',
    card: '#1f2937',
    text: 'rgba(255, 255, 255, 0.87)',
    border: 'rgba(255, 255, 255, 0.1)',
    notification: '#fbbf24',
  },
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Only bundle icon fonts at root; custom text fonts can block Android splash → login.
  const [loaded, error] = useFonts({
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // Avoid infinite native splash if font loading stalls on a device.
  useEffect(() => {
    const t = setTimeout(() => {
      SplashScreen.hideAsync();
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  if (!loaded) {
    return (
      <RNView style={styles.boot}>
        <RNActivityIndicator size="large" color="#2563eb" />
      </RNView>
    );
  }

  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const atLogin = segments[0] === 'login';
    if (!user && !atLogin) {
      router.replace('/login');
    } else if (user && atLogin) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments, router]);

  return (
    <ThemePreferenceProvider>
      <RootLayoutNavInner loading={loading} />
    </ThemePreferenceProvider>
  );
}

function RootLayoutNavInner({ loading }: { loading: boolean }) {
  const { preference, resolvedScheme } = useThemePreference();

  return (
    <GluestackUIProvider mode={preference}>
      <ThemeProvider
        value={
          resolvedScheme === 'dark' ? navigationDarkTheme : DefaultTheme
        }>
        <RNView style={styles.flex}>
          <StatusBar
            style={resolvedScheme === 'dark' ? 'light' : 'dark'}
          />
          <Stack>
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
          </Stack>
          {loading ? (
            <RNView
              style={[
                styles.authLoading,
                resolvedScheme === 'dark'
                  ? styles.authLoadingDark
                  : styles.authLoadingLight,
              ]}
              pointerEvents="auto">
              <RNActivityIndicator size="large" color="#2563eb" />
            </RNView>
          ) : null}
        </RNView>
      </ThemeProvider>
    </GluestackUIProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  authLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authLoadingLight: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  authLoadingDark: {
    backgroundColor: 'rgba(17, 24, 39, 0.92)',
  },
});
