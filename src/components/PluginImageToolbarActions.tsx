import { resolvePluginLocalizedTextV2 } from '@retake-tools/package-contracts';
import {
  memo,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginCommandV1,
} from '../core/pluginContributionRegistry';
import { TooltipIconButton } from './Tooltip';
import { PluginActionIcon } from './PluginActionIcon';

const emptyActionList: readonly RegisteredPluginCommandV1[] =
  Object.freeze([]);

export function PluginImageToolbarActions({
  assetId,
  blockId,
  onFatalFailure,
  onInvoke,
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
  onInvoke?: () => void;
  previewUrl?: string;
  registry?: PluginContributionRegistryV1;
  title: string;
}): ReactElement | null {
  const actionSnapshot = useSyncExternalStore(
    registry?.subscribe ?? emptySubscribe,
    registry?.getCommandSnapshot ?? emptyActionSnapshot,
    registry?.getCommandSnapshot ?? emptyActionSnapshot,
  );
  const actions = actionSnapshot.filter(
    (
      action,
    ): action is RegisteredPluginCommandV1 => (
      action.contextKind === 'image'
      && action.bindings.some(
        (binding) => binding.surfaceId === 'image.context-toolbar',
      )
    ),
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
          onInvoke={onInvoke}
          registry={registry}
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
    onInvoke,
    registry,
  }: {
    action: RegisteredPluginCommandV1;
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
    onInvoke?: () => void;
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
      block,
      host: action.host,
      kind: 'image' as const,
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
        onInvoke?.();
        await waitForPluginImageToolbarBlockBinding(
          action.host,
          block.blockId,
        );
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

export async function waitForPluginImageToolbarBlockBinding(
  host: RegisteredPluginCommandV1['host'],
  blockId: string,
  timeoutMs = 750,
): Promise<void> {
  if (host.getReadSnapshot().boundBlockIds.includes(blockId)) return;
  await new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    const unsubscribe = host.subscribeReadSnapshot(() => {
      if (!host.getReadSnapshot().boundBlockIds.includes(blockId)) {
        return;
      }
      globalThis.clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
    timeout = globalThis.setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeoutMs);
  });
}

function emptySubscribe(): () => void {
  return () => undefined;
}

function emptyActionSnapshot():
readonly RegisteredPluginCommandV1[] {
  return emptyActionList;
}
