/**
 * Web-only replacement for `expo-router/_ctx.web.js`.
 * Metro validates `require.context` before env inlining runs on that file in SSR graphs;
 * this file lives next to `app/` so the first argument is a static `./app`.
 *
 * Keep the route regex in sync with `node_modules/expo-router/_ctx.web.js` when upgrading expo-router.
 */
export const ctx = require.context(
  './app',
  true,
  /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+middleware)|(?:\+(html|native-intent))))\.[tj]sx?$).*(?:\.android|\.ios|\.native)?\.[tj]sx?$/,
  'sync',
);
