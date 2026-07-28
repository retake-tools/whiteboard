import { resolvePluginLocalizedTextV2 } from '@retake-tools/package-contracts';
import {
  memo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginCommandV1,
} from '../core/pluginContributionRegistry';
import type {
  PluginImageBlockV1,
} from '@retake-tools/package-sdk';
import { TooltipIconButton } from './Tooltip';
import { PluginActionIcon } from './PluginActionIcon';

const emptyActions: readonly RegisteredPluginCommandV1[] = Object.freeze([]);

export function PluginSelectionToolbarActions({
  blocks,
  onFatalFailure,
  registry,
}: {
  blocks: readonly PluginImageBlockV1[];
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  registry?: PluginContributionRegistryV1;
}): ReactElement | null {
  const snapshot = useSyncExternalStore(
    registry?.subscribe ?? emptySubscribe,
    registry?.getCommandSnapshot ?? emptySnapshot,
    registry?.getCommandSnapshot ?? emptySnapshot,
  );
  const context = Object.freeze({
    blocks: Object.freeze([...blocks]),
    kind: 'selection' as const,
  });
  const actions = snapshot.filter(
    (
      action,
    ): action is RegisteredPluginCommandV1 => (
      action.contextKind === 'selection'
      && action.bindings.some(
        (binding) => binding.surfaceId === 'selection.context-toolbar',
      )
      && registry?.availability(
        action,
        Object.freeze({ ...context, host: action.host }),
      ).visible === true
    ),
  );
  if (actions.length === 0 || blocks.length === 0) return null;

  return (
    <div
      aria-label="Plugin selection actions"
      className="context-toolbar plugin-selection-toolbar"
    >
      {actions.map((action) => (
        <SelectionActionButton
          action={action}
          blocks={blocks}
          key={action.contributionId}
          onFatalFailure={onFatalFailure}
          registry={registry}
        />
      ))}
    </div>
  );
}

const SelectionActionButton = memo(
  function SelectionActionButton({
    action,
    blocks,
    onFatalFailure,
    registry,
  }: {
    action: RegisteredPluginCommandV1;
    blocks: readonly PluginImageBlockV1[];
    onFatalFailure?: (
      pluginModuleId: string,
      message: string,
    ) => Promise<void> | void;
    registry?: PluginContributionRegistryV1;
  }): ReactElement | null {
    const [pending, setPending] = useState(false);
    const environment = useSyncExternalStore(
      action.host.environment.subscribe,
      action.host.environment.getSnapshot,
      action.host.environment.getSnapshot,
    );
    if (action.failure) return null;
    const context = Object.freeze({
      blocks,
      host: action.host,
      kind: 'selection' as const,
    });
    const availability = registry?.availability(action, context) ?? {
      enabled: false,
      visible: false,
    };
    if (!availability.visible) return null;

    async function invoke(): Promise<void> {
      if (pending) return;
      setPending(true);
      try {
        if (!registry) return;
        await registry.invoke(action, context);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : String(error);
        await onFatalFailure?.(
          action.pluginModuleId,
          `Plugin command ${action.commandId} failed: ${message}`,
        );
      } finally {
        setPending(false);
      }
    }

    return (
      <TooltipIconButton
        className="icon-button plugin-image-toolbar-action"
        disabled={pending || !availability.enabled}
        label={resolvePluginLocalizedTextV2(
          action.label,
          environment.locale,
        )}
        onClick={() => {
          void invoke();
        }}
      >
        <PluginActionIcon icon={action.icon} />
      </TooltipIconButton>
    );
  },
);

function emptySubscribe(): () => void {
  return () => undefined;
}

function emptySnapshot(): readonly RegisteredPluginCommandV1[] {
  return emptyActions;
}
