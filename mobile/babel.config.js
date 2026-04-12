module.exports = function (api) {
  api.cache(true);
  return {
    // Turn off preset auto-injection of Reanimated/Worklets plugins. In npm workspaces,
    // `hasModule('react-native-worklets')` inside the preset can be false, so it falls back
    // to `react-native-reanimated/plugin`, which breaks Reanimated 4 + Worklets at runtime.
    //
    // `nativewind/babel` is react-native-css-interop: it returns `{ plugins: [...] }` and must
    // be a preset, not a `plugins[]` entry (otherwise Babel errors: ".plugins is not a valid Plugin property").
    // That preset already includes `react-native-worklets/plugin`.
    presets: [
      ['babel-preset-expo', { reanimated: false }],
      require.resolve('nativewind/babel'),
    ],
  };
};
