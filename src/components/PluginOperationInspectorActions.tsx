import { Puzzle } from 'lucide-react';
import { resolvePluginLocalizedTextV2 } from '@retake-tools/package-contracts';
import type {
  PluginAssetV2,
  PluginJsonValueV2,
  PluginOperationInspectorViewV2,
} from '@retake-tools/package-sdk';
import {
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginCommandV1,
} from '../host-kit/plugin';
import type {
  AssetRecord,
  BlockRecord,
  ExecutionRecord,
} from '../core/types';

const emptyActions: readonly RegisteredPluginCommandV1[] = Object.freeze([]);

export function PluginOperationInspectorActions({
  disabled = false,
  execution,
  inputAssets,
  onBeforeInvoke,
  onFatalFailure,
  operationBlock,
  registry,
  sourceBlock,
}: {
  disabled?: boolean;
  execution: ExecutionRecord;
  inputAssets: readonly AssetRecord[];
  onBeforeInvoke?: (
    operationBlockId: string,
  ) => Promise<void> | void;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  operationBlock?: BlockRecord;
  registry?: PluginContributionRegistryV1;
  sourceBlock?: BlockRecord;
}): ReactElement | null {
  const snapshot = useSyncExternalStore(
    registry?.subscribe ?? emptySubscribe,
    registry?.getCommandSnapshot ?? emptySnapshot,
    registry?.getCommandSnapshot ?? emptySnapshot,
  );
  const actions = snapshot.filter(
    (
      action,
    ): action is RegisteredPluginCommandV1 => (
      action.contextKind === 'operation'
      && action.ownedCapabilityId === execution.capabilityId
      && action.bindings.some(
        (binding) => binding.surfaceId === 'operation.inspector',
      )
    ),
  );
  if (actions.length === 0 || !operationBlock) return null;

  const operation = projectPluginOperationInspectorView({
    execution,
    inputAssets,
    operationBlock,
    sourceBlock,
  });
  return (
    <div
      className="execution-plugin-actions"
      data-retake-plugin-ui="operation-inspector"
    >
      {actions.map((action) => (
        <PluginOperationActionButton
          action={action}
          disabled={disabled}
          key={action.contributionId}
          onBeforeInvoke={onBeforeInvoke}
          onFatalFailure={onFatalFailure}
          operation={operation}
          registry={registry}
        />
      ))}
    </div>
  );
}

function PluginOperationActionButton({
  action,
  disabled,
  onBeforeInvoke,
  onFatalFailure,
  operation,
  registry,
}: {
  action: RegisteredPluginCommandV1;
  disabled: boolean;
  onBeforeInvoke?: (
    operationBlockId: string,
  ) => Promise<void> | void;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  operation: PluginOperationInspectorViewV2;
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
    host: action.host,
    kind: 'operation' as const,
    operation,
  });
  const availability = registry?.availability(action, context) ?? {
    enabled: false,
    visible: false,
  };
  if (!availability.visible) return null;

  const invoke = async (): Promise<void> => {
    if (disabled || pending || !availability.enabled) return;
    setPending(true);
    try {
      await onBeforeInvoke?.(operation.operationBlockId);
      if (!registry) return;
      await registry.invoke(action, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await onFatalFailure?.(
        action.pluginModuleId,
        `Plugin operation command ${action.commandId} failed: ${message}`,
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      className="execution-restore-configuration"
      disabled={disabled || pending || !availability.enabled}
      type="button"
      onClick={() => void invoke()}
    >
      <Puzzle aria-hidden="true" size={14} />
      <span>
        {resolvePluginLocalizedTextV2(action.label, environment.locale)}
      </span>
    </button>
  );
}

export function projectPluginOperationInspectorView(input: {
  execution: ExecutionRecord;
  inputAssets: readonly AssetRecord[];
  operationBlock: BlockRecord;
  sourceBlock?: BlockRecord;
}): PluginOperationInspectorViewV2 {
  const sourceAsset = input.inputAssets.find(
    (asset) => asset.assetId === input.sourceBlock?.data.assetId,
  );
  return Object.freeze({
    capabilityId: input.execution.capabilityId,
    executionId: input.execution.executionId,
    inputAssets: Object.freeze(input.inputAssets.map(toPluginAsset)),
    operationBlockId: input.operationBlock.blockId,
    parameters: pluginParameters(input.execution),
    source: input.sourceBlock?.type === 'image' && sourceAsset
      ? Object.freeze({
          assetId: sourceAsset.assetId,
          blockId: input.sourceBlock.blockId,
          title: input.sourceBlock.data.title,
          type: 'image' as const,
        })
      : null,
    status: input.execution.status,
  });
}

function pluginParameters(
  execution: ExecutionRecord,
): Readonly<Record<string, PluginJsonValueV2>> {
  const parameters = execution.params?.pluginParameters;
  return pluginJsonRecord(
    parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? parameters
      : execution.params ?? {},
  );
}

function pluginJsonRecord(
  value: object,
): Readonly<Record<string, PluginJsonValueV2>> {
  const output: Record<string, PluginJsonValueV2> = {};
  for (const [key, entry] of Object.entries(value)) {
    const projected = pluginJsonValue(entry, new WeakSet());
    if (projected !== undefined) output[key] = projected;
  }
  return Object.freeze(output);
}

function pluginJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): PluginJsonValueV2 | undefined {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) {
    return undefined;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const entries = value.map((entry) => pluginJsonValue(entry, ancestors));
    ancestors.delete(value);
    return entries.every(
      (entry): entry is PluginJsonValueV2 => entry !== undefined,
    ) ? Object.freeze(entries) : undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    ancestors.delete(value);
    return undefined;
  }
  const record: Record<string, PluginJsonValueV2> = {};
  for (const [key, entry] of Object.entries(value)) {
    const projected = pluginJsonValue(entry, ancestors);
    if (projected === undefined) {
      ancestors.delete(value);
      return undefined;
    }
    record[key] = projected;
  }
  ancestors.delete(value);
  return Object.freeze(record);
}

function toPluginAsset(asset: AssetRecord): PluginAssetV2 {
  return Object.freeze({
    assetId: asset.assetId,
    createdAt: asset.createdAt,
    ...(asset.duration === undefined ? {} : { duration: asset.duration }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
    kind: asset.kind,
    mimeType: asset.mimeType,
    previewUrl: asset.previewUrl,
    ...(asset.width === undefined ? {} : { width: asset.width }),
  });
}

function emptySubscribe(): () => void {
  return () => undefined;
}

function emptySnapshot(): readonly RegisteredPluginCommandV1[] {
  return emptyActions;
}
