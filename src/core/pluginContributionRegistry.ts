import type {
  ActivatedPluginContributionV1,
  PluginHostApiV1,
} from '@retake-tools/package-sdk';
import type {
  ComponentType,
} from 'react';
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

export interface PluginContributionRegistryV1 {
  getSnapshot(): readonly RegisteredPluginPanelV1[];
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
  const listeners = new Set<() => void>();
  const update = (next: RegisteredPluginPanelV1[]) => {
    if (samePanels(panels, next)) return;
    panels = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  return {
    failModule(pluginModuleId, message) {
      update(panels.map((panel) => (
        panel.pluginModuleId === pluginModuleId
          ? { ...panel, failure: message }
          : panel
      )));
    },
    getSnapshot: () => panels,
    removeModule(pluginModuleId) {
      update(panels.filter(
        (panel) => panel.pluginModuleId !== pluginModuleId,
      ));
    },
    replace(sessions) {
      const failures: Array<{ error: string; pluginModuleId: string }> = [];
      const next: RegisteredPluginPanelV1[] = [];
      for (const session of sessions) {
        try {
          for (const activated of session.activation.contributions) {
            if (activated.contribution.kind !== 'panel') continue;
            const value = parsePanelContribution(activated.value);
            next.push({
              component: value.component,
              contributionId: activated.contribution.contributionId,
              failure: null,
              host: session.host,
              pluginModuleId: session.record.pluginModuleId,
            });
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
      update(next
        .filter((panel) => !failedModules.has(panel.pluginModuleId))
        .sort((left, right) => compareText(
          left.contributionId,
          right.contributionId,
        )));
      return failures;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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
  PluginPanelComponentPropsV1
> {
  return typeof value === 'function'
    || (typeof value === 'object' && value !== null);
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
