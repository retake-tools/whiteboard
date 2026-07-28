import {
  retakeWebPluginExternalModuleSpecifiers,
} from '@retake-tools/package-sdk';

export const retakePluginExternalModuleBasePath =
  '/plugin-runtime/externals/v3';

export const retakePluginExternalModulePaths = Object.freeze({
  '@retake/plugin-api': `${retakePluginExternalModuleBasePath}/plugin-api.js`,
  react: `${retakePluginExternalModuleBasePath}/react.js`,
  'react-dom': `${retakePluginExternalModuleBasePath}/react-dom.js`,
  'react-dom/client': `${retakePluginExternalModuleBasePath}/react-dom-client.js`,
  'react/jsx-dev-runtime':
    `${retakePluginExternalModuleBasePath}/react-jsx-dev-runtime.js`,
  'react/jsx-runtime':
    `${retakePluginExternalModuleBasePath}/react-jsx-runtime.js`,
});

const externalByPath = new Map<string, string>(
  Object.entries(retakePluginExternalModulePaths).map(
    ([specifier, modulePath]) => [modulePath, specifier],
  ),
);

export function pluginHostExternalModuleSource(
  modulePath: string,
): string | undefined {
  const specifier = externalByPath.get(modulePath);
  if (!specifier) return undefined;
  if (!retakeWebPluginExternalModuleSpecifiers.includes(
    specifier as typeof retakeWebPluginExternalModuleSpecifiers[number],
  )) {
    throw new Error(`Unsupported Retake Plugin external: ${specifier}`);
  }
  if (specifier === '@retake/plugin-api') {
    return moduleSource(specifier, [
      'export const createPluginTranslator = runtime.createPluginTranslator;',
      'export const defineCapability = runtime.defineCapability;',
      'export const defineCommand = runtime.defineCommand;',
      'export const defineMessages = runtime.defineMessages;',
      'export const definePanel = runtime.definePanel;',
      'export const definePlugin = runtime.definePlugin;',
      'export const definePluginContribution = runtime.definePluginContribution;',
      'export const defineRenderer = runtime.defineRenderer;',
      'export const defineSettings = runtime.defineSettings;',
      'export const pluginApiVersion = runtime.pluginApiVersion;',
      'export const pluginThemeVariable = runtime.pluginThemeVariable;',
      'export const version = runtime.version;',
    ]);
  }
  if (specifier === 'react') {
    return moduleSource(specifier, [
      ...[
        'Activity',
        'Children',
        'Component',
        'Fragment',
        'Profiler',
        'PureComponent',
        'StrictMode',
        'Suspense',
        'act',
        'cache',
        'cacheSignal',
        'captureOwnerStack',
        'cloneElement',
        'createContext',
        'createElement',
        'createRef',
        'forwardRef',
        'isValidElement',
        'lazy',
        'memo',
        'startTransition',
        'unstable_useCacheRefresh',
        'use',
        'useActionState',
        'useCallback',
        'useContext',
        'useDebugValue',
        'useDeferredValue',
        'useEffect',
        'useEffectEvent',
        'useId',
        'useImperativeHandle',
        'useInsertionEffect',
        'useLayoutEffect',
        'useMemo',
        'useOptimistic',
        'useReducer',
        'useRef',
        'useState',
        'useSyncExternalStore',
        'useTransition',
        'version',
      ].map((name) => `export const ${name} = runtime.${name};`),
      'export default runtime.default ?? runtime;',
    ]);
  }
  if (specifier === 'react-dom') {
    return moduleSource(specifier, [
      ...[
        'createPortal',
        'flushSync',
        'preconnect',
        'prefetchDNS',
        'preinit',
        'preinitModule',
        'preload',
        'preloadModule',
        'requestFormReset',
        'unstable_batchedUpdates',
        'useFormState',
        'useFormStatus',
        'version',
      ].map((name) => `export const ${name} = runtime.${name};`),
      'export default runtime.default ?? runtime;',
    ]);
  }
  if (specifier === 'react-dom/client') {
    return moduleSource(specifier, [
      'export const createRoot = runtime.createRoot;',
      'export const hydrateRoot = runtime.hydrateRoot;',
      'export const version = runtime.version;',
      'export default runtime.default ?? runtime;',
    ]);
  }
  if (specifier === 'react/jsx-runtime') {
    return moduleSource(specifier, [
      'export const Fragment = runtime.Fragment;',
      'export const jsx = runtime.jsx;',
      'export const jsxs = runtime.jsxs;',
      'export default runtime.default ?? runtime;',
    ]);
  }
  return moduleSource(specifier, [
    'export const Fragment = runtime.Fragment;',
    'export const jsxDEV = runtime.jsxDEV;',
    'export default runtime.default ?? runtime;',
  ]);
}

function moduleSource(specifier: string, exports: string[]): string {
  return [
    'const host = globalThis.retakePluginHostExternalsV3;',
    `if (!host) throw new Error(${JSON.stringify(
      'Retake Plugin Host externals are not installed.',
    )});`,
    `const runtime = host[${JSON.stringify(specifier)}];`,
    `if (!runtime) throw new Error(${JSON.stringify(
      `Retake Plugin Host external is unavailable: ${specifier}`,
    )});`,
    ...exports,
    '',
  ].join('\n');
}
