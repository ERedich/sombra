const path = require('path');

const projectRoot = __dirname;
// Fallback for babel-preset-expo's Expo Router transform on `expo-router/_ctx.*.js` (web + monorepos).
process.env.EXPO_PROJECT_ROOT = projectRoot;

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/** Metro validates `require.context` before Babel inlines `EXPO_ROUTER_APP_ROOT` for web SSR. */
const webCtxShim = path.resolve(projectRoot, 'expo-router-ctx-web.js');
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform, ...rest) => {
  // Any resolution that targets expo-router's web context (paths or bare id).
  if (typeof moduleName === 'string') {
    const normalized = moduleName.split(path.sep).join('/');
    if (
      normalized.includes('expo-router') &&
      normalized.includes('_ctx.web')
    ) {
      return { filePath: webCtxShim, type: 'sourceFile' };
    }
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform, ...rest);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: './global.css',
  configPath: './tailwind.config.js',
});
