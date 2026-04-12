import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';

/**
 * Custom entry so Metro resolves routes from ./app without relying on
 * expo-router's _ctx.*.js (those expect EXPO_ROUTER_APP_ROOT from Babel, which
 * often fails in workspace / hoisted node_modules setups).
 *
 * @see https://docs.expo.dev/router/reference/troubleshooting/#expo_router_app_root-not-defined
 */
export function App() {
  const ctx = require.context('./app');
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ExpoRoot context={ctx} />
    </GestureHandlerRootView>
  );
}

registerRootComponent(App);
