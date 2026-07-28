import * as React from 'react';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import type {
  PluginCommand,
  PluginDefinition,
  PluginMessages,
  PluginPanel,
  PluginRenderer,
  PluginSettings,
  RetakeCapabilityContributionV2,
} from '@retake/plugin-api';
import {
  createPluginTranslator,
  pluginThemeVariable,
} from '@retake/plugin-api';

export const retakePluginHostExternalsGlobal = 'retakePluginHostExternalsV3';

export interface RetakePluginApiV3 {
  createPluginTranslator: typeof createPluginTranslator;
  defineCapability<
    const Capability extends RetakeCapabilityContributionV2,
  >(capability: Capability): Capability;
  defineCommand<const Command extends PluginCommand>(
    command: Command,
  ): Command;
  defineMessages<const Messages extends PluginMessages>(
    messages: Messages,
  ): Messages;
  definePanel<const Panel extends PluginPanel>(panel: Panel): Panel;
  definePlugin<const Plugin extends PluginDefinition>(
    plugin: Plugin,
  ): Plugin;
  definePluginContribution<T>(contribution: T): T;
  defineRenderer<const Renderer extends PluginRenderer>(
    renderer: Renderer,
  ): Renderer;
  defineSettings<const Settings extends PluginSettings>(
    settings: Settings,
  ): Settings;
  pluginApiVersion: 3;
  pluginThemeVariable: typeof pluginThemeVariable;
  version: 3;
}

export interface RetakePluginHostExternalsV3 {
  '@retake/plugin-api': RetakePluginApiV3;
  react: typeof React;
  'react-dom': typeof ReactDom;
  'react-dom/client': typeof ReactDomClient;
  'react/jsx-dev-runtime': typeof ReactJsxDevRuntime;
  'react/jsx-runtime': typeof ReactJsxRuntime;
}

declare global {
  var retakePluginHostExternalsV3:
    | Readonly<RetakePluginHostExternalsV3>
    | undefined;
}

export function installPluginHostExternals(): void {
  if (globalThis.retakePluginHostExternalsV3) return;
  const pluginApi: RetakePluginApiV3 = Object.freeze({
    createPluginTranslator,
    defineCapability: <const Capability extends RetakeCapabilityContributionV2>(
      capability: Capability,
    ) => capability,
    defineCommand: <const Command extends PluginCommand>(command: Command) =>
      command,
    defineMessages: <const Messages extends PluginMessages>(
      messages: Messages,
    ) => messages,
    definePanel: <const Panel extends PluginPanel>(panel: Panel) => panel,
    definePlugin: <const Plugin extends PluginDefinition>(plugin: Plugin) =>
      plugin,
    definePluginContribution: <T>(contribution: T) => contribution,
    defineRenderer: <const Renderer extends PluginRenderer>(
      renderer: Renderer,
    ) => renderer,
    defineSettings: <const Settings extends PluginSettings>(
      settings: Settings,
    ) => settings,
    pluginApiVersion: 3,
    pluginThemeVariable,
    version: 3,
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
  }) satisfies Readonly<RetakePluginHostExternalsV3>;
  Object.defineProperty(globalThis, retakePluginHostExternalsGlobal, {
    configurable: false,
    enumerable: false,
    value: externals,
    writable: false,
  });
}
