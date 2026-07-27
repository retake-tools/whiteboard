import { Puzzle } from 'lucide-react';
import { resolvePluginLocalizedTextV2 } from '@retake-tools/package-contracts';
import {
  memo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type {
  PluginContributionRegistryV1,
  PluginImageToolbarActionContextV1,
  RegisteredPluginActionV1,
  RegisteredPluginImageSelectionToolbarActionV1,
} from '../core/pluginContributionRegistry';
import { TooltipIconButton } from './Tooltip';

const emptyActions: readonly RegisteredPluginActionV1[] = Object.freeze([]);

export function PluginSelectionToolbarActions({
  blocks,
  onFatalFailure,
  registry,
}: {
  blocks: readonly PluginImageToolbarActionContextV1['block'][];
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  registry?: PluginContributionRegistryV1;
}): ReactElement | null {
  const snapshot = useSyncExternalStore(
    registry?.subscribe ?? emptySubscribe,
    registry?.getActionSnapshot ?? emptySnapshot,
    registry?.getActionSnapshot ?? emptySnapshot,
  );
  const actions = snapshot.filter(
    (
      action,
    ): action is RegisteredPluginImageSelectionToolbarActionV1 => (
      action.placement === 'selection.toolbar'
      && blocks.length >= action.selectionCount.min
      && blocks.length <= action.selectionCount.max
    ),
  );
  if (actions.length === 0 || blocks.length < 2) return null;

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
  }: {
    action: RegisteredPluginImageSelectionToolbarActionV1;
    blocks: readonly PluginImageToolbarActionContextV1['block'][];
    onFatalFailure?: (
      pluginModuleId: string,
      message: string,
    ) => Promise<void> | void;
  }): ReactElement | null {
    const [pending, setPending] = useState(false);
    const environment = useSyncExternalStore(
      action.host.environment.subscribe,
      action.host.environment.getSnapshot,
      action.host.environment.getSnapshot,
    );
    if (action.failure) return null;

    async function invoke(): Promise<void> {
      if (pending) return;
      setPending(true);
      try {
        await action.run(Object.freeze({
          blocks: Object.freeze([...blocks]),
          host: action.host,
        }));
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : String(error);
        await onFatalFailure?.(
          action.pluginModuleId,
          `Plugin action ${action.contributionId} failed: ${message}`,
        );
      } finally {
        setPending(false);
      }
    }

    return (
      <TooltipIconButton
        className="icon-button plugin-image-toolbar-action"
        disabled={pending}
        label={resolvePluginLocalizedTextV2(
          action.label,
          environment.locale,
        )}
        onClick={() => {
          void invoke();
        }}
      >
        <Puzzle aria-hidden="true" size={16} />
      </TooltipIconButton>
    );
  },
);

function emptySubscribe(): () => void {
  return () => undefined;
}

function emptySnapshot(): readonly RegisteredPluginActionV1[] {
  return emptyActions;
}
