import type {
  PluginLocalizedTextV2,
} from '@retake-tools/package-contracts';
import {
  pluginLocalizedTextV2Schema,
} from '@retake-tools/package-contracts';
import type {
  ActivatedPluginContributionV2,
  PluginHostApiV2,
  PluginOperationActionContextV2,
  PluginOperationInspectorActionV2,
} from '@retake-tools/package-sdk';
import {
  parsePluginOperationInspectorActionV2,
} from '@retake-tools/plugin-runtime';
import type {
  ComponentType,
} from 'react';
import {
  replacePluginCapabilityDefinitions,
} from './pluginCapabilityDefinitions';
import {
  pluginCapabilityConflicts,
  localizeRegisteredPluginCapability,
  registeredPluginCapabilityFrom,
  samePluginCapabilities,
  type RegisteredPluginCapabilityV1,
} from './pluginCapabilityContributions';
export type {
  RegisteredPluginCapabilityV1,
} from './pluginCapabilityContributions';
import type {
  BlockType,
} from './types';

export type PluginRendererBlockTypeV1 = Exclude<BlockType, 'group'>;

export interface PluginContributionSessionV1 {
  activation: {
    contributions: ActivatedPluginContributionV2[];
  };
  host: PluginHostApiV2;
  record: {
    pluginModuleId: string;
  };
}

export interface PluginPanelComponentPropsV1 {
  host: PluginHostApiV2;
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
  host: PluginHostApiV2;
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
  host: PluginHostApiV2;
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
  host: PluginHostApiV2;
  pluginModuleId: string;
  supportedBlockTypes: readonly PluginRendererBlockTypeV1[];
}

export interface PluginImageToolbarActionContextV1 {
  readonly block: {
    readonly assetId: string;
    readonly blockId: string;
    readonly previewUrl?: string;
    readonly title: string;
    readonly type: 'image';
  };
  readonly host: PluginHostApiV2;
}

export interface PluginImageSelectionToolbarActionContextV1 {
  readonly blocks: readonly PluginImageToolbarActionContextV1['block'][];
  readonly host: PluginHostApiV2;
}

export const pluginToolbarActionIconsV1 = [
  'adjustments',
  'annotation',
  'crop',
  'outpaint',
  'resize',
  'selection-mask',
  'smart-edit',
] as const;

export type PluginToolbarActionIconV1 =
  (typeof pluginToolbarActionIconsV1)[number];

export interface PluginImageToolbarActionContributionValueV1 {
  apiVersion: 2;
  icon?: PluginToolbarActionIconV1;
  kind: 'action';
  label: PluginLocalizedTextV2;
  placement: 'image.toolbar';
  run(context: PluginImageToolbarActionContextV1): Promise<void> | void;
}

export interface PluginImageSelectionToolbarActionContributionValueV1 {
  apiVersion: 2;
  icon?: PluginToolbarActionIconV1;
  kind: 'action';
  label: PluginLocalizedTextV2;
  placement: 'selection.toolbar';
  selectionCount: {
    max: number;
    min: number;
  };
  run(
    context: PluginImageSelectionToolbarActionContextV1,
  ): Promise<void> | void;
}

interface RegisteredPluginActionBaseV1 {
  contributionId: string;
  failure: string | null;
  host: PluginHostApiV2;
  label: PluginLocalizedTextV2;
  pluginModuleId: string;
}

export interface RegisteredPluginImageToolbarActionV1
  extends RegisteredPluginActionBaseV1 {
  icon?: PluginToolbarActionIconV1;
  placement: 'image.toolbar';
  run(context: PluginImageToolbarActionContextV1): Promise<void> | void;
}

export interface RegisteredPluginImageSelectionToolbarActionV1
  extends RegisteredPluginActionBaseV1 {
  icon?: PluginToolbarActionIconV1;
  placement: 'selection.toolbar';
  selectionCount: {
    max: number;
    min: number;
  };
  run(
    context: PluginImageSelectionToolbarActionContextV1,
  ): Promise<void> | void;
}

export interface RegisteredPluginOperationInspectorActionV2
  extends RegisteredPluginActionBaseV1 {
  placement: 'operation.inspector';
  run(context: PluginOperationActionContextV2): Promise<void> | void;
  supportedCapabilityIds: readonly string[];
}

export type RegisteredPluginActionV1 =
  | RegisteredPluginImageSelectionToolbarActionV1
  | RegisteredPluginImageToolbarActionV1
  | RegisteredPluginOperationInspectorActionV2;

export interface PluginContributionRegistryV1 {
  getActionSnapshot(): readonly RegisteredPluginActionV1[];
  getCapabilitySnapshot(): readonly RegisteredPluginCapabilityV1[];
  getSnapshot(): readonly RegisteredPluginPanelV1[];
  getRendererSnapshot(): readonly RegisteredPluginBlockRendererV1[];
  ownsCapability(pluginModuleId: string, capabilityId: string): boolean;
  failModule(pluginModuleId: string, message: string): void;
  removeModule(pluginModuleId: string): void;
  replace(sessions: readonly PluginContributionSessionV1[]): Array<{
    error: string;
    pluginModuleId: string;
  }>;
  setLocale(locale: string): void;
  subscribe(listener: () => void): () => void;
}

export function createPluginContributionRegistry():
PluginContributionRegistryV1 {
  let locale = 'en';
  let actions: readonly RegisteredPluginActionV1[] =
    Object.freeze([]);
  let capabilities: readonly RegisteredPluginCapabilityV1[] =
    Object.freeze([]);
  let panels: readonly RegisteredPluginPanelV1[] = Object.freeze([]);
  let renderers: readonly RegisteredPluginBlockRendererV1[] = Object.freeze(
    [],
  );
  const listeners = new Set<() => void>();
  const update = (
    nextActions: RegisteredPluginActionV1[],
    nextCapabilities: RegisteredPluginCapabilityV1[],
    nextPanels: RegisteredPluginPanelV1[],
    nextRenderers: RegisteredPluginBlockRendererV1[],
  ) => {
    if (
      sameActions(actions, nextActions)
      && samePluginCapabilities(capabilities, nextCapabilities)
      && samePanels(panels, nextPanels)
      && sameRenderers(renderers, nextRenderers)
    ) return;
    actions = Object.freeze(nextActions);
    capabilities = Object.freeze(nextCapabilities);
    panels = Object.freeze(nextPanels);
    renderers = Object.freeze(nextRenderers);
    replacePluginCapabilityDefinitions(
      capabilities.map((capability) => capability.definition),
    );
    for (const listener of listeners) listener();
  };
  return {
    failModule(pluginModuleId, message) {
      update(
        actions.map((action) => (
          action.pluginModuleId === pluginModuleId
            ? { ...action, failure: message }
            : action
        )),
        capabilities.map((capability) => (
          capability.pluginModuleId === pluginModuleId
            ? { ...capability, failure: message }
            : capability
        )).filter((capability) => capability.failure === null),
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
    getActionSnapshot: () => actions,
    getCapabilitySnapshot: () => capabilities,
    getSnapshot: () => panels,
    getRendererSnapshot: () => renderers,
    ownsCapability: (pluginModuleId, capabilityId) => (
      capabilities.some((capability) => (
        capability.failure === null
        && capability.pluginModuleId === pluginModuleId
        && capability.definition.capabilityId === capabilityId
      ))
    ),
    removeModule(pluginModuleId) {
      update(
        actions.filter((action) => (
          action.pluginModuleId !== pluginModuleId
        )),
        capabilities.filter(
          (capability) => capability.pluginModuleId !== pluginModuleId,
        ),
        panels.filter((panel) => panel.pluginModuleId !== pluginModuleId),
        renderers.filter(
          (renderer) => renderer.pluginModuleId !== pluginModuleId,
        ),
      );
    },
    replace(sessions) {
      const failures: Array<{ error: string; pluginModuleId: string }> = [];
      const nextActions: RegisteredPluginActionV1[] = [];
      const nextCapabilities: RegisteredPluginCapabilityV1[] = [];
      const nextPanels: RegisteredPluginPanelV1[] = [];
      const nextRenderers: RegisteredPluginBlockRendererV1[] = [];
      for (const session of sessions) {
        try {
          for (const activated of session.activation.contributions) {
            if (activated.contribution.kind === 'capability') {
              nextCapabilities.push(registeredPluginCapabilityFrom(
                activated,
                session.record.pluginModuleId,
                locale,
              ));
            }
            if (activated.contribution.kind === 'action') {
              const isOperationAction = (
                typeof activated.value === 'object'
                && activated.value !== null
                && (
                  activated.value as { placement?: unknown }
                ).placement === 'operation.inspector'
              );
              const value = isOperationAction
                ? parsePluginOperationInspectorActionV2(activated.value)
                : parsePluginActionContribution(activated.value);
              const base = {
                contributionId: activated.contribution.contributionId,
                failure: null,
                host: session.host,
                label: value.label,
                pluginModuleId: session.record.pluginModuleId,
              };
              nextActions.push(value.placement === 'image.toolbar'
                ? {
                    ...base,
                    ...(value.icon ? { icon: value.icon } : {}),
                    placement: value.placement,
                    run: value.run,
                  }
                : value.placement === 'selection.toolbar'
                  ? {
                    ...base,
                    ...(value.icon ? { icon: value.icon } : {}),
                    placement: value.placement,
                    run: value.run,
                    selectionCount: Object.freeze({
                      ...value.selectionCount,
                    }),
                  }
                  : {
                      ...base,
                      placement: value.placement,
                      run: value.run,
                      supportedCapabilityIds: Object.freeze([
                        ...value.supportedCapabilityIds,
                      ]),
                    });
            }
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
      for (const conflict of pluginCapabilityConflicts(nextCapabilities)) {
        failedModules.add(conflict.pluginModuleId);
        failures.push(conflict);
      }
      failures.sort((left, right) => compareText(
        left.pluginModuleId,
        right.pluginModuleId,
      ));
      update(
        nextActions
          .filter((action) => !failedModules.has(action.pluginModuleId))
          .sort((left, right) => compareText(
            left.contributionId,
            right.contributionId,
          )),
        nextCapabilities
          .filter((capability) => (
            !failedModules.has(capability.pluginModuleId)
          ))
          .sort((left, right) => compareText(
            left.definition.capabilityId,
            right.definition.capabilityId,
          )),
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
    setLocale(nextLocale) {
      if (nextLocale === locale) return;
      locale = nextLocale;
      update(
        [...actions],
        capabilities.map((capability) => (
          localizeRegisteredPluginCapability(capability, locale)
        )),
        [...panels],
        [...renderers],
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function parsePluginActionContribution(
  value: unknown,
):
  | PluginImageSelectionToolbarActionContributionValueV1
  | PluginImageToolbarActionContributionValueV1 {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { apiVersion?: unknown }).apiVersion !== 2
    || (value as { kind?: unknown }).kind !== 'action'
    || (
      (value as { placement?: unknown }).placement !== 'image.toolbar'
      && (value as { placement?: unknown }).placement !== 'selection.toolbar'
    )
    || !isActionLabel((value as { label?: unknown }).label)
    || (
      (value as { icon?: unknown }).icon !== undefined
      && !pluginToolbarActionIconsV1.includes(
        (value as { icon: PluginToolbarActionIconV1 }).icon,
      )
    )
    || typeof (value as { run?: unknown }).run !== 'function'
    || (
      (value as { placement?: unknown }).placement === 'selection.toolbar'
      && !isSelectionCount(
        (value as { selectionCount?: unknown }).selectionCount,
      )
    )
  ) {
    throw new Error(
      'Plugin action contribution must use a Retake Toolbar Action V2 contract.',
    );
  }
  return value as
    | PluginImageSelectionToolbarActionContributionValueV1
    | PluginImageToolbarActionContributionValueV1;
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

function isActionLabel(value: unknown): value is PluginLocalizedTextV2 {
  const parsed = pluginLocalizedTextV2Schema.safeParse(value);
  if (!parsed.success) return false;
  const values = typeof parsed.data === 'string'
    ? [parsed.data]
    : [
        parsed.data.default,
        ...Object.values(parsed.data.locales ?? {}),
      ];
  return values.every((entry) => (
    entry.trim() === entry
    && entry.length > 0
    && entry.length <= 80
  ));
}

function sameActions(
  left: readonly RegisteredPluginActionV1[],
  right: readonly RegisteredPluginActionV1[],
): boolean {
  return left.length === right.length
    && left.every((action, index) => (
      action.contributionId === right[index]?.contributionId
      && action.failure === right[index]?.failure
      && action.host === right[index]?.host
      && JSON.stringify(action.label) === JSON.stringify(right[index]?.label)
      && action.placement === right[index]?.placement
      && (
        action.placement !== 'selection.toolbar'
        || (
          right[index]?.placement === 'selection.toolbar'
          && action.selectionCount.min
            === right[index].selectionCount.min
          && action.selectionCount.max
            === right[index].selectionCount.max
        )
      )
      && (
        action.placement !== 'operation.inspector'
        || (
          right[index]?.placement === 'operation.inspector'
          && sameTextArray(
            action.supportedCapabilityIds,
            right[index].supportedCapabilityIds,
          )
        )
      )
      && action.pluginModuleId === right[index]?.pluginModuleId
      && action.run === right[index]?.run
    ));
}

function isSelectionCount(value: unknown): value is {
  max: number;
  min: number;
} {
  if (
    typeof value !== 'object'
    || value === null
    || !Number.isInteger((value as { min?: unknown }).min)
    || !Number.isInteger((value as { max?: unknown }).max)
  ) return false;
  const { max, min } = value as { max: number; min: number };
  return min >= 2 && max >= min && max <= 32;
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
