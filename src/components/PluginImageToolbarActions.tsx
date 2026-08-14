import { resolvePluginLocalizedTextV2 } from '@retake-tools/package-contracts';
import {
  useCallback,
  memo,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginCommandV1,
} from '../host-kit/plugin';
import { useI18n } from '../i18n';
import { TooltipIconButton, TooltipWrapper } from './Tooltip';
import { PluginActionIcon } from './PluginActionIcon';

const emptyActionList: readonly RegisteredPluginCommandV1[] =
  Object.freeze([]);
const primaryActionLimit = 5;

export function PluginImageToolbarActions({
  assetId,
  blockId,
  onFatalFailure,
  onInvoke,
  onOpenSettings,
  previewUrl,
  registry,
  title,
  variant = 'primary',
}: {
  assetId: string;
  blockId: string;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  onInvoke?: () => void;
  onOpenSettings?: () => void;
  previewUrl?: string;
  registry?: PluginContributionRegistryV1;
  title: string;
  variant?: 'menu' | 'primary';
}): ReactElement | null {
  const actionSnapshot = useSyncExternalStore(
    registry?.subscribe ?? emptySubscribe,
    registry?.getCommandSnapshot ?? emptyActionSnapshot,
    registry?.getCommandSnapshot ?? emptyActionSnapshot,
  );
  const actions = useMemo(() => {
    if (!registry) return emptyActionList;
    void actionSnapshot;
    return registry.commandsForSurface('image.context-toolbar');
  }, [actionSnapshot, registry]);
  const subscribeToActionEnvironments = useCallback((listener: () => void) => {
    const environments = new Set(actions.map((action) => action.host.environment));
    const unsubscribers = [...environments].map((environment) => environment.subscribe(listener));
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [actions]);
  const getActionEnvironmentSnapshot = useCallback(() => JSON.stringify(
    actions.map((action) => action.host.environment.getSnapshot()),
  ), [actions]);
  useSyncExternalStore(
    subscribeToActionEnvironments,
    getActionEnvironmentSnapshot,
    getActionEnvironmentSnapshot,
  );
  const block = useMemo(() => Object.freeze({
    assetId,
    blockId,
    ...(previewUrl === undefined ? {} : { previewUrl }),
    title,
    type: 'image' as const,
  }), [assetId, blockId, previewUrl, title]);

  const visibleActions = actions.flatMap((action) => {
    if (action.failure || action.contextKind !== 'image' || !registry) return [];
    const context = Object.freeze({
      block,
      host: action.host,
      kind: 'image' as const,
    });
    const availability = registry.availability(action, context);
    return availability.visible ? [{ action, availability }] : [];
  });
  const actionsForVariant = variant === 'primary'
    ? visibleActions.slice(0, primaryActionLimit)
    : [
        ...visibleActions.slice(primaryActionLimit),
        ...visibleActions.slice(0, primaryActionLimit).filter(({ availability }) => !availability.enabled),
      ];

  if (actionsForVariant.length === 0) return null;

  return (
    <>
      {actionsForVariant.map(({ action, availability }) => (
        variant === 'primary' ? (
          <PluginImageToolbarActionButton
            action={action}
            availability={availability}
            block={block}
            key={action.contributionId}
            onFatalFailure={onFatalFailure}
            onInvoke={onInvoke}
            registry={registry}
          />
        ) : (
          <PluginImageMenuActionButton
            action={action}
            availability={availability}
            block={block}
            key={action.contributionId}
            onFatalFailure={onFatalFailure}
            onInvoke={onInvoke}
            onOpenSettings={onOpenSettings}
            registry={registry}
          />
        )
      ))}
    </>
  );
}

const PluginImageToolbarActionButton = memo(
  function PluginImageToolbarActionButton({
    action,
    availability,
    block,
    onFatalFailure,
    onInvoke,
    registry,
  }: {
    action: RegisteredPluginCommandV1;
    availability: ReturnType<PluginContributionRegistryV1['availability']>;
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
    const context = Object.freeze({
      block,
      host: action.host,
      kind: 'image' as const,
    });
    if (action.failure || !availability.visible) return null;

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

    const label = resolvePluginLocalizedTextV2(action.label, environment.locale);
    const reason = availability.reason
      ? resolvePluginLocalizedTextV2(availability.reason, environment.locale)
      : undefined;
    const tooltip = reason ? `${label} · ${reason}` : label;
    const button = (
      <TooltipIconButton
        className="image-context-primary-action plugin-image-toolbar-action"
        disabled={pending || !availability.enabled}
        label={tooltip}
        onClick={() => {
          void invoke();
        }}
      >
        <PluginActionIcon icon={action.icon} />
        <span>{label}</span>
      </TooltipIconButton>
    );
    return pending || !availability.enabled
      ? <TooltipWrapper className="disabled-tool-wrapper" label={tooltip}>{button}</TooltipWrapper>
      : button;
  },
);

const PluginImageMenuActionButton = memo(
  function PluginImageMenuActionButton({
    action,
    availability,
    block,
    onFatalFailure,
    onInvoke,
    onOpenSettings,
    registry,
  }: {
    action: RegisteredPluginCommandV1;
    availability: ReturnType<PluginContributionRegistryV1['availability']>;
    block: {
      readonly assetId: string;
      readonly blockId: string;
      readonly previewUrl?: string;
      readonly title: string;
      readonly type: 'image';
    };
    onFatalFailure?: (pluginModuleId: string, message: string) => Promise<void> | void;
    onInvoke?: () => void;
    onOpenSettings?: () => void;
    registry?: PluginContributionRegistryV1;
  }): ReactElement | null {
    const [pending, setPending] = useState(false);
    const { t } = useI18n();
    const environment = useSyncExternalStore(
      action.host.environment.subscribe,
      action.host.environment.getSnapshot,
      action.host.environment.getSnapshot,
    );
    if (action.failure || !availability.visible) return null;
    const context = Object.freeze({ block, host: action.host, kind: 'image' as const });
    const label = resolvePluginLocalizedTextV2(action.label, environment.locale);
    const reason = availability.reason
      ? resolvePluginLocalizedTextV2(availability.reason, environment.locale)
      : t('context.unavailable');

    async function invoke(): Promise<void> {
      if (pending || !availability.enabled) return;
      setPending(true);
      try {
        onInvoke?.();
        await waitForPluginImageToolbarBlockBinding(action.host, block.blockId);
        if (registry) await registry.invoke(action, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await onFatalFailure?.(action.pluginModuleId, `Plugin command ${action.commandId} failed: ${message}`);
      } finally {
        setPending(false);
      }
    }

    return (
      <div className={`image-context-plugin-menu-item${availability.enabled ? '' : ' is-unavailable'}`}>
        <button
          type="button"
          className="image-context-menu-action"
          aria-disabled={pending || !availability.enabled}
          onClick={() => void invoke()}
        >
          <PluginActionIcon icon={action.icon} />
          <span>{label}</span>
        </button>
        {!availability.enabled ? (
          <div className="image-context-unavailable-detail">
            <small>{reason}</small>
            {onOpenSettings ? (
              <button type="button" onClick={onOpenSettings}>{t('context.openSettings')}</button>
            ) : null}
          </div>
        ) : null}
      </div>
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
