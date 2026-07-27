import { Puzzle } from 'lucide-react';
import {
  memo,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginImageToolbarActionV1,
} from '../core/pluginContributionRegistry';
import { TooltipIconButton } from './Tooltip';

const emptyActionList: readonly RegisteredPluginImageToolbarActionV1[] =
  Object.freeze([]);

export function PluginImageToolbarActions({
  assetId,
  blockId,
  onFatalFailure,
  previewUrl,
  registry,
  title,
}: {
  assetId: string;
  blockId: string;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  previewUrl?: string;
  registry?: PluginContributionRegistryV1;
  title: string;
}): ReactElement | null {
  const actions = useSyncExternalStore(
    registry?.subscribe ?? emptySubscribe,
    registry?.getActionSnapshot ?? emptyActionSnapshot,
    registry?.getActionSnapshot ?? emptyActionSnapshot,
  );
  const block = useMemo(() => Object.freeze({
    assetId,
    blockId,
    ...(previewUrl === undefined ? {} : { previewUrl }),
    title,
    type: 'image' as const,
  }), [assetId, blockId, previewUrl, title]);

  if (actions.length === 0) return null;

  return (
    <>
      {actions.map((action) => (
        <PluginImageToolbarActionButton
          action={action}
          block={block}
          key={action.contributionId}
          onFatalFailure={onFatalFailure}
        />
      ))}
    </>
  );
}

const PluginImageToolbarActionButton = memo(
  function PluginImageToolbarActionButton({
    action,
    block,
    onFatalFailure,
  }: {
    action: RegisteredPluginImageToolbarActionV1;
    block: {
      readonly assetId: string;
      readonly blockId: string;
      readonly previewUrl?: string;
      readonly title: string;
      readonly type: 'image';
    };
    onFatalFailure?: (
      pluginModuleId: string,
      message: string,
    ) => Promise<void> | void;
  }): ReactElement | null {
    const [pending, setPending] = useState(false);
    if (action.failure) return null;

    async function invoke(): Promise<void> {
      if (pending) return;
      setPending(true);
      try {
        await action.run(Object.freeze({
          block,
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
        label={action.label}
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

function emptyActionSnapshot():
readonly RegisteredPluginImageToolbarActionV1[] {
  return emptyActionList;
}
