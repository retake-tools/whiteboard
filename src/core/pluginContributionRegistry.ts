import type {
  ActivatedPluginContributionV1,
  PluginHostApiV1,
} from '@retake-tools/package-sdk';
import type {
  ComponentType,
} from 'react';
import type {
  BlockType,
} from './types';

export type PluginRendererBlockTypeV1 = Exclude<BlockType, 'group'>;

export interface PluginContributionSessionV1 {
  activation: {
    contributions: ActivatedPluginContributionV1[];
  };
  host: PluginHostApiV1;
  record: {
    pluginModuleId: string;
  };
}

export interface PluginPanelComponentPropsV1 {
  host: PluginHostApiV1;
}

export interface PluginPanelContributionValueV1 {
  apiVersion: 1;
  component: ComponentType<PluginPanelComponentPropsV1>;
  kind: 'panel';
  placement: 'workspace.overlay';
}

export interface RegisteredPluginPanelV1 {
  component: ComponentType<PluginPanelComponentPropsV1>;
  contributionId: string;
  failure: string | null;
  host: PluginHostApiV1;
  pluginModuleId: string;
}

export interface PluginRendererBlockViewV1 {
  readonly assetId?: string;
  readonly blockId: string;
  readonly body?: string;
  readonly previewUrl?: string;
  readonly title: string;
  readonly type: PluginRendererBlockTypeV1;
}

export interface PluginBlockRendererComponentPropsV1 {
  block: PluginRendererBlockViewV1;
  host: PluginHostApiV1;
  selected: boolean;
}

export interface PluginBlockRendererContributionValueV1 {
  apiVersion: 1;
  component: ComponentType<PluginBlockRendererComponentPropsV1>;
  kind: 'renderer';
  placement: 'block.body';
  supportedBlockTypes: readonly PluginRendererBlockTypeV1[];
}

export interface RegisteredPluginBlockRendererV1 {
  component: ComponentType<PluginBlockRendererComponentPropsV1>;
  contributionId: string;
  failure: string | null;
  host: PluginHostApiV1;
  pluginModuleId: string;
  supportedBlockTypes: readonly PluginRendererBlockTypeV1[];
}

export interface PluginContributionRegistryV1 {
  getSnapshot(): readonly RegisteredPluginPanelV1[];
  getRendererSnapshot(): readonly RegisteredPluginBlockRendererV1[];
  failModule(pluginModuleId: string, message: string): void;
  removeModule(pluginModuleId: string): void;
  replace(sessions: readonly PluginContributionSessionV1[]): Array<{
    error: string;
    pluginModuleId: string;
  }>;
  subscribe(listener: () => void): () => void;
}

export function createPluginContributionRegistry():
PluginContributionRegistryV1 {
  let panels: readonly RegisteredPluginPanelV1[] = Object.freeze([]);
  let renderers: readonly RegisteredPluginBlockRendererV1[] = Object.freeze(
    [],
  );
  const listeners = new Set<() => void>();
  const update = (
    nextPanels: RegisteredPluginPanelV1[],
    nextRenderers: RegisteredPluginBlockRendererV1[],
  ) => {
    if (
      samePanels(panels, nextPanels)
      && sameRenderers(renderers, nextRenderers)
    ) return;
    panels = Object.freeze(nextPanels);
    renderers = Object.freeze(nextRenderers);
    for (const listener of listeners) listener();
  };
  return {
    failModule(pluginModuleId, message) {
      update(
        panels.map((panel) => (
          panel.pluginModuleId === pluginModuleId
            ? { ...panel, failure: message }
            : panel
        )),
        renderers.map((renderer) => (
          renderer.pluginModuleId === pluginModuleId
            ? { ...renderer, failure: message }
            : renderer
        )),
      );
    },
    getSnapshot: () => panels,
    getRendererSnapshot: () => renderers,
    removeModule(pluginModuleId) {
      update(
        panels.filter((panel) => panel.pluginModuleId !== pluginModuleId),
        renderers.filter(
          (renderer) => renderer.pluginModuleId !== pluginModuleId,
        ),
      );
    },
    replace(sessions) {
      const failures: Array<{ error: string; pluginModuleId: string }> = [];
      const nextPanels: RegisteredPluginPanelV1[] = [];
      const nextRenderers: RegisteredPluginBlockRendererV1[] = [];
      for (const session of sessions) {
        try {
          for (const activated of session.activation.contributions) {
            if (activated.contribution.kind === 'panel') {
              const value = parsePanelContribution(activated.value);
              nextPanels.push({
                component: value.component,
                contributionId: activated.contribution.contributionId,
                failure: null,
                host: session.host,
                pluginModuleId: session.record.pluginModuleId,
              });
            }
            if (activated.contribution.kind === 'renderer') {
              const value = parseRendererContribution(activated.value);
              nextRenderers.push({
                component: value.component,
                contributionId: activated.contribution.contributionId,
                failure: null,
                host: session.host,
                pluginModuleId: session.record.pluginModuleId,
                supportedBlockTypes: Object.freeze([
                  ...value.supportedBlockTypes,
                ]),
              });
            }
          }
        } catch (error) {
          failures.push({
            error: error instanceof Error ? error.message : String(error),
            pluginModuleId: session.record.pluginModuleId,
          });
        }
      }
      failures.sort((left, right) => compareText(
        left.pluginModuleId,
        right.pluginModuleId,
      ));
      const failedModules = new Set(
        failures.map((failure) => failure.pluginModuleId),
      );
      update(
        nextPanels
          .filter((panel) => !failedModules.has(panel.pluginModuleId))
          .sort((left, right) => compareText(
            left.contributionId,
            right.contributionId,
          )),
        nextRenderers
          .filter((renderer) => !failedModules.has(renderer.pluginModuleId))
          .sort((left, right) => compareText(
            left.contributionId,
            right.contributionId,
          )),
      );
      return failures;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function parseRendererContribution(
  value: unknown,
): PluginBlockRendererContributionValueV1 {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { apiVersion?: unknown }).apiVersion !== 1
    || (value as { kind?: unknown }).kind !== 'renderer'
    || (value as { placement?: unknown }).placement !== 'block.body'
    || !isComponentType((value as { component?: unknown }).component)
    || !isBlockTypeArray(
      (value as { supportedBlockTypes?: unknown }).supportedBlockTypes,
    )
  ) {
    throw new Error(
      'Plugin renderer contribution must use the Retake Block Renderer V1 contract.',
    );
  }
  return value as PluginBlockRendererContributionValueV1;
}

function parsePanelContribution(
  value: unknown,
): PluginPanelContributionValueV1 {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { apiVersion?: unknown }).apiVersion !== 1
    || (value as { kind?: unknown }).kind !== 'panel'
    || (value as { placement?: unknown }).placement !== 'workspace.overlay'
    || !isComponentType((value as { component?: unknown }).component)
  ) {
    throw new Error(
      'Plugin panel contribution must use the Retake Panel V1 contract.',
    );
  }
  return value as PluginPanelContributionValueV1;
}

function isComponentType(value: unknown): value is ComponentType<
  PluginPanelComponentPropsV1 | PluginBlockRendererComponentPropsV1
> {
  return typeof value === 'function'
    || (typeof value === 'object' && value !== null);
}

function isBlockTypeArray(
  value: unknown,
): value is PluginRendererBlockTypeV1[] {
  const blockTypes: readonly PluginRendererBlockTypeV1[] = [
    'document',
    'image',
    'operation',
    'text',
    'video',
  ];
  return Array.isArray(value)
    && value.length > 0
    && new Set(value).size === value.length
    && value.every((entry) => blockTypes.includes(entry));
}

function samePanels(
  left: readonly RegisteredPluginPanelV1[],
  right: readonly RegisteredPluginPanelV1[],
): boolean {
  return left.length === right.length
    && left.every((panel, index) => (
      panel.component === right[index]?.component
      && panel.contributionId === right[index]?.contributionId
      && panel.failure === right[index]?.failure
      && panel.host === right[index]?.host
      && panel.pluginModuleId === right[index]?.pluginModuleId
    ));
}

function sameRenderers(
  left: readonly RegisteredPluginBlockRendererV1[],
  right: readonly RegisteredPluginBlockRendererV1[],
): boolean {
  return left.length === right.length
    && left.every((renderer, index) => (
      renderer.component === right[index]?.component
      && renderer.contributionId === right[index]?.contributionId
      && renderer.failure === right[index]?.failure
      && renderer.host === right[index]?.host
      && renderer.pluginModuleId === right[index]?.pluginModuleId
      && sameTextArray(
        renderer.supportedBlockTypes,
        right[index]?.supportedBlockTypes ?? [],
      )
    ));
}

function sameTextArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
