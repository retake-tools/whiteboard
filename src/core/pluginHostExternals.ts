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
  PluginSettingsMetadata,
  RetakeCapabilityContributionV2,
} from '@retake/plugin-api';

export const retakePluginHostExternalsGlobal = 'retakePluginHostExternalsV2';

export interface RetakePluginApiV2 {
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
  defineSettings<const Settings extends PluginSettingsMetadata>(
    settings: Settings,
  ): Settings;
  pluginApiVersion: 2;
  version: 2;
}

export interface RetakePluginHostExternalsV2 {
  '@retake/plugin-api': RetakePluginApiV2;
  react: typeof React;
  'react-dom': typeof ReactDom;
  'react-dom/client': typeof ReactDomClient;
  'react/jsx-dev-runtime': typeof ReactJsxDevRuntime;
  'react/jsx-runtime': typeof ReactJsxRuntime;
}

declare global {
  var retakePluginHostExternalsV2:
    | Readonly<RetakePluginHostExternalsV2>
    | undefined;
}

export function installPluginHostExternals(): void {
  if (globalThis.retakePluginHostExternalsV2) return;
  const pluginApi: RetakePluginApiV2 = Object.freeze({
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
    defineSettings: <const Settings extends PluginSettingsMetadata>(
      settings: Settings,
    ) => settings,
    pluginApiVersion: 2,
    version: 2,
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
  }) satisfies Readonly<RetakePluginHostExternalsV2>;
  Object.defineProperty(globalThis, retakePluginHostExternalsGlobal, {
    configurable: false,
    enumerable: false,
    value: externals,
    writable: false,
  });
}
