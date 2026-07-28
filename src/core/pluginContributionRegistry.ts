import type {
  PluginLocalizedTextV2,
} from '@retake-tools/package-contracts';
import type {
  ActivatedPluginContributionV2,
  CommandShortcutResolutionV1,
  PluginCommandAvailabilityV1,
  PluginCommandContextV1,
  PluginCommandIconV1,
  PluginCommandSurfaceBindingV1,
  PluginCommandSurfaceIdV1,
  PluginCommandV1,
  PluginHostApiV2,
} from '@retake-tools/package-sdk';
import {
  parsePluginCommandV1,
  pluginCommandAvailabilityV1,
  resolveCommandShortcutCandidatesV1,
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

interface RegisteredPluginCommandBaseV1 {
  availability?: PluginCommandV1['availability'];
  bindings: readonly PluginCommandSurfaceBindingV1[];
  commandId: string;
  contextKind: PluginCommandV1['contextKind'];
  contributionId: string;
  defaultBindings: readonly PluginCommandSurfaceBindingV1[];
  failure: string | null;
  host: PluginHostApiV2;
  icon?: PluginCommandIconV1;
  label: PluginLocalizedTextV2;
  ownedCapabilityId?: string;
  pluginModuleId: string;
  recommendedShortcuts: readonly string[];
}

export type RegisteredPluginCommandV1 =
  RegisteredPluginCommandBaseV1
  & Pick<PluginCommandV1, 'run'>;

export interface PluginCommandExperienceOverrideV1 {
  readonly commandId: string;
  readonly hidden?: boolean;
  readonly order?: number;
}

export const hostCommandShortcutCandidatesV1 = Object.freeze([
  Object.freeze({
    commandId: 'retake.command.redo',
    shortcut: 'Mod+Shift+Z',
    source: 'host' as const,
  }),
  Object.freeze({
    commandId: 'retake.command.undo',
    shortcut: 'Mod+Z',
    source: 'host' as const,
  }),
  Object.freeze({
    commandId: 'retake.command.redo',
    shortcut: 'Mod+Y',
    source: 'host' as const,
  }),
]);

export interface PluginContributionRegistryV1 {
  availability(
    command: RegisteredPluginCommandV1,
    context: PluginCommandContextV1,
  ): PluginCommandAvailabilityV1;
  commandsForSurface(
    surfaceId: PluginCommandSurfaceIdV1,
  ): readonly RegisteredPluginCommandV1[];
  getCommandSnapshot(): readonly RegisteredPluginCommandV1[];
  getCapabilitySnapshot(): readonly RegisteredPluginCapabilityV1[];
  getSnapshot(): readonly RegisteredPluginPanelV1[];
  getRendererSnapshot(): readonly RegisteredPluginBlockRendererV1[];
  getShortcutResolution(): CommandShortcutResolutionV1;
  invoke(
    command: RegisteredPluginCommandV1,
    context: PluginCommandContextV1,
  ): Promise<void>;
  ownsCapability(pluginModuleId: string, capabilityId: string): boolean;
  failModule(pluginModuleId: string, message: string): void;
  removeModule(pluginModuleId: string): void;
  replace(sessions: readonly PluginContributionSessionV1[]): Array<{
    error: string;
    pluginModuleId: string;
  }>;
  setCommandExperience(
    overrides: readonly PluginCommandExperienceOverrideV1[],
  ): void;
  setLocale(locale: string): void;
  subscribe(listener: () => void): () => void;
}

export function createPluginContributionRegistry():
PluginContributionRegistryV1 {
  let locale = 'en';
  let commands: readonly RegisteredPluginCommandV1[] =
    Object.freeze([]);
  let commandExperience: readonly PluginCommandExperienceOverrideV1[] =
    Object.freeze([]);
  let capabilities: readonly RegisteredPluginCapabilityV1[] =
    Object.freeze([]);
  let panels: readonly RegisteredPluginPanelV1[] = Object.freeze([]);
  let renderers: readonly RegisteredPluginBlockRendererV1[] = Object.freeze(
    [],
  );
  const listeners = new Set<() => void>();
  const update = (
    nextCommands: RegisteredPluginCommandV1[],
    nextCapabilities: RegisteredPluginCapabilityV1[],
    nextPanels: RegisteredPluginPanelV1[],
    nextRenderers: RegisteredPluginBlockRendererV1[],
  ) => {
    if (
      sameCommands(commands, nextCommands)
      && samePluginCapabilities(capabilities, nextCapabilities)
      && samePanels(panels, nextPanels)
      && sameRenderers(renderers, nextRenderers)
    ) return;
    commands = Object.freeze(nextCommands);
    capabilities = Object.freeze(nextCapabilities);
    panels = Object.freeze(nextPanels);
    renderers = Object.freeze(nextRenderers);
    replacePluginCapabilityDefinitions(
      capabilities.map((capability) => capability.definition),
    );
    for (const listener of listeners) listener();
  };
  return {
    availability: (command, context) => (
      pluginCommandAvailabilityV1(commandDefinition(command), context)
    ),
    commandsForSurface: (surfaceId) => commands
      .filter((command) => command.bindings.some(
        (binding) => binding.surfaceId === surfaceId,
      ))
      .sort((left, right) => (
        commandSurfaceOrder(left, surfaceId)
          - commandSurfaceOrder(right, surfaceId)
        || compareText(left.commandId, right.commandId)
      )),
    failModule(pluginModuleId, message) {
      update(
        commands.map((command) => (
          command.pluginModuleId === pluginModuleId
            ? { ...command, failure: message }
            : command
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
    getCommandSnapshot: () => commands,
    getCapabilitySnapshot: () => capabilities,
    getSnapshot: () => panels,
    getRendererSnapshot: () => renderers,
    getShortcutResolution: () => resolveCommandShortcutCandidatesV1([
      ...hostCommandShortcutCandidatesV1,
      ...commands.flatMap((command) => (
        command.failure === null
          ? command.recommendedShortcuts.map((shortcut) => ({
              commandId: command.commandId,
              shortcut,
              source: 'plugin' as const,
            }))
          : []
      )),
    ]),
    async invoke(command, context) {
      if (command.failure) {
        throw new Error(`Plugin command is unavailable: ${command.commandId}`);
      }
      const availability = pluginCommandAvailabilityV1(
        commandDefinition(command),
        context,
      );
      if (!availability.visible || !availability.enabled) {
        throw new Error(`Plugin command is unavailable: ${command.commandId}`);
      }
      await command.run(context as never);
    },
    ownsCapability: (pluginModuleId, capabilityId) => (
      capabilities.some((capability) => (
        capability.failure === null
        && capability.pluginModuleId === pluginModuleId
        && capability.definition.capabilityId === capabilityId
      ))
    ),
    removeModule(pluginModuleId) {
      update(
        commands.filter((command) => (
          command.pluginModuleId !== pluginModuleId
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
      const nextCommands: RegisteredPluginCommandV1[] = [];
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
            if (activated.contribution.kind === 'command') {
              const value = parsePluginCommandV1(activated.value);
              const defaultBindings = Object.freeze(
                value.defaultBindings.map((binding) => Object.freeze({
                  ...binding,
                })),
              );
              nextCommands.push({
                ...(value.availability
                  ? { availability: value.availability }
                  : {}),
                bindings: resolveCommandExperienceBindings(
                  value.commandId,
                  defaultBindings,
                  commandExperience,
                ),
                commandId: value.commandId,
                contextKind: value.contextKind,
                contributionId: activated.contribution.contributionId,
                defaultBindings,
                failure: null,
                host: session.host,
                ...(value.icon ? { icon: value.icon } : {}),
                label: value.label,
                ...(value.ownedCapabilityId
                  ? { ownedCapabilityId: value.ownedCapabilityId }
                  : {}),
                pluginModuleId: session.record.pluginModuleId,
                recommendedShortcuts: Object.freeze([
                  ...(value.recommendedShortcuts ?? []),
                ]),
                run: value.run,
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
      for (const conflict of pluginCommandConflicts(nextCommands)) {
        failedModules.add(conflict.pluginModuleId);
        failures.push(conflict);
      }
      failures.sort((left, right) => compareText(
        left.pluginModuleId,
        right.pluginModuleId,
      ));
      update(
        nextCommands
          .filter((command) => !failedModules.has(command.pluginModuleId))
          .sort((left, right) => compareText(
            left.commandId,
            right.commandId,
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
    setCommandExperience(overrides) {
      commandExperience = Object.freeze(overrides.map((override) => (
        Object.freeze({ ...override })
      )));
      update(
        commands.map((command) => ({
          ...command,
          bindings: resolveCommandExperienceBindings(
            command.commandId,
            command.defaultBindings,
            commandExperience,
          ),
        })),
        [...capabilities],
        [...panels],
        [...renderers],
      );
    },
    setLocale(nextLocale) {
      if (nextLocale === locale) return;
      locale = nextLocale;
      update(
        [...commands],
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

function commandDefinition(
  command: RegisteredPluginCommandV1,
): PluginCommandV1 {
  return {
    ...(command.availability
      ? { availability: command.availability }
      : {}),
    apiVersion: 1,
    commandId: command.commandId,
    contextKind: command.contextKind,
    defaultBindings: command.defaultBindings,
    ...(command.icon ? { icon: command.icon } : {}),
    kind: 'command',
    label: command.label,
    ...(command.ownedCapabilityId
      ? { ownedCapabilityId: command.ownedCapabilityId }
      : {}),
    recommendedShortcuts: command.recommendedShortcuts,
    run: command.run,
  } as PluginCommandV1;
}

function pluginCommandConflicts(
  commands: readonly RegisteredPluginCommandV1[],
): Array<{ error: string; pluginModuleId: string }> {
  const owners = new Map<string, Set<string>>();
  for (const command of commands) {
    const modules = owners.get(command.commandId) ?? new Set<string>();
    modules.add(command.pluginModuleId);
    owners.set(command.commandId, modules);
  }
  return [...owners]
    .filter(([, modules]) => modules.size > 1)
    .flatMap(([commandId, modules]) => [...modules].map((pluginModuleId) => ({
      error: `Plugin command contribution conflicts: ${commandId}`,
      pluginModuleId,
    })));
}

function resolveCommandExperienceBindings(
  commandId: string,
  bindings: readonly PluginCommandSurfaceBindingV1[],
  overrides: readonly PluginCommandExperienceOverrideV1[],
): readonly PluginCommandSurfaceBindingV1[] {
  const override = overrides.find((entry) => entry.commandId === commandId);
  if (override?.hidden) return Object.freeze([]);
  return Object.freeze(bindings.map((binding) => Object.freeze({
    ...binding,
    ...(override?.order === undefined ? {} : { order: override.order }),
  })));
}

function commandSurfaceOrder(
  command: RegisteredPluginCommandV1,
  surfaceId: PluginCommandSurfaceIdV1,
): number {
  return command.bindings.find(
    (binding) => binding.surfaceId === surfaceId,
  )?.order ?? 0;
}

function sameCommands(
  left: readonly RegisteredPluginCommandV1[],
  right: readonly RegisteredPluginCommandV1[],
): boolean {
  return left.length === right.length
    && left.every((command, index) => (
      command.availability === right[index]?.availability
      && JSON.stringify(command.bindings)
        === JSON.stringify(right[index]?.bindings)
      && command.commandId === right[index]?.commandId
      && command.contextKind === right[index]?.contextKind
      && command.contributionId === right[index]?.contributionId
      && JSON.stringify(command.defaultBindings)
        === JSON.stringify(right[index]?.defaultBindings)
      && command.failure === right[index]?.failure
      && command.host === right[index]?.host
      && command.icon === right[index]?.icon
      && JSON.stringify(command.label) === JSON.stringify(right[index]?.label)
      && command.ownedCapabilityId === right[index]?.ownedCapabilityId
      && command.pluginModuleId === right[index]?.pluginModuleId
      && sameTextArray(
        command.recommendedShortcuts,
        right[index]?.recommendedShortcuts ?? [],
      )
      && command.run === right[index]?.run
    ));
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
