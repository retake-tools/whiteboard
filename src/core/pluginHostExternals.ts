import * as React from 'react';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime';
import * as ReactJsxRuntime from 'react/jsx-runtime';

export const retakePluginHostExternalsGlobal = 'retakePluginHostExternalsV1';

export interface RetakePluginApiV1 {
  definePluginContribution<T>(contribution: T): T;
  version: 1;
}

export interface RetakePluginHostExternalsV1 {
  '@retake/plugin-api': RetakePluginApiV1;
  react: typeof React;
  'react-dom': typeof ReactDom;
  'react-dom/client': typeof ReactDomClient;
  'react/jsx-dev-runtime': typeof ReactJsxDevRuntime;
  'react/jsx-runtime': typeof ReactJsxRuntime;
}

declare global {
  var retakePluginHostExternalsV1:
    | Readonly<RetakePluginHostExternalsV1>
    | undefined;
}

export function installPluginHostExternals(): void {
  if (globalThis.retakePluginHostExternalsV1) return;
  const pluginApi: RetakePluginApiV1 = Object.freeze({
    definePluginContribution: <T>(contribution: T) => contribution,
    version: 1,
  });
  const jsxDevRuntime = Object.freeze({
    ...ReactJsxDevRuntime,
    Fragment: ReactJsxDevRuntime.Fragment ?? ReactJsxRuntime.Fragment,
    jsxDEV: ReactJsxDevRuntime.jsxDEV
      ?? ((
        type: React.ElementType,
        props: Record<string, unknown>,
        key?: React.Key,
      ) => ReactJsxRuntime.jsx(type, props, key)),
  }) as typeof ReactJsxDevRuntime;
  const externals = Object.freeze({
    '@retake/plugin-api': pluginApi,
    react: React,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    'react/jsx-dev-runtime': jsxDevRuntime,
    'react/jsx-runtime': ReactJsxRuntime,
  }) satisfies Readonly<RetakePluginHostExternalsV1>;
  Object.defineProperty(globalThis, retakePluginHostExternalsGlobal, {
    configurable: false,
    enumerable: false,
    value: externals,
    writable: false,
  });
}
