import type {
  PluginConnectedExecutionRunInputV2,
  PluginConnectedExecutionViewV2,
  PluginExecutionConnectionViewV2,
} from '@retake-tools/package-sdk';
import { loadBoardSnapshot } from '../core/boardStore';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import {
  currentExecutionProviderSettings,
  resolveExecutionConnectionPreference,
} from '../core/executionProviderPreferences';
import { startCodexAppServerImage } from '../core/codexAppServerImageClient';
import type { AssetRecord, BoardSnapshot } from '../core/types';
import type { CanvasHostScopeV1 } from '../host-kit';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

interface ConnectedPluginExecutionOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  runProductCommand: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  runHostCommand: <Result>(
    operation: (commands: import('../host-kit').CanvasHostCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  setSelectedBlock: (
    snapshot: BoardSnapshot,
    blockId: string,
  ) => void;
  snapshotRef: { current: BoardSnapshot };
}

export async function runConnectedPluginExecution(
  input: PluginConnectedExecutionRunInputV2,
  signal: AbortSignal,
  options: ConnectedPluginExecutionOptions,
  importedAssets: readonly import('../core/types').AssetRecord[] = [],
): Promise<PluginConnectedExecutionViewV2> {
  throwIfAborted(signal);
  const expectedScope = scopeFor(options.snapshotRef.current);
  const queued = await options.runProductCommand(
    (commands) => commands.connectedPluginExecution.queue({
      expectedScope,
      importedAssets,
      request: input,
    }),
    { history: true },
  );
  if (isCurrentScope(options.snapshotRef.current, queued.scope)) {
    options.setSelectedBlock(options.snapshotRef.current, queued.operationBlockId);
  }
  try {
    throwIfAborted(signal);
  } catch (error) {
    await options.runHostCommand(
      (commands) => commands.cancelExecution({ executionId: queued.executionId }),
    );
    throw error;
  }

  if (queued.route === 'mcp_agent') {
    return {
      capabilityId: input.capabilityId,
      connectionId: queued.connectionId,
      executionId: queued.executionId,
      outputBlockIds: queued.outputBlockIds,
      status: 'queued',
    };
  }

  const started = await startCodexAppServerImage({
    ...queued.scope,
    executionId: queued.executionId,
    connectionId: queued.connectionId,
  });
  adoptIfCurrent(started.snapshot, options);
  if (isCurrentScope(options.snapshotRef.current, queued.scope)) {
    options.setSelectedBlock(
      options.snapshotRef.current,
      started.execution.outputBlockIds[0] ?? queued.operationBlockId,
    );
  }
  void pollConnectedExecution(
    queued.executionId,
    queued.scope,
    options,
  ).catch(() => undefined);
  return {
    capabilityId: input.capabilityId,
    connectionId: queued.connectionId,
    executionId: queued.executionId,
    outputBlockIds: [...started.execution.outputBlockIds],
    status: 'running',
  };
}

export function listConnectedPluginExecutionConnections(input: {
  capabilityId: string;
  projectId: string;
}): readonly PluginExecutionConnectionViewV2[] {
  const definition = capabilityDefinitionFor(input.capabilityId);
  if (!definition.supportedAdapterClasses.includes('agent_runtime.media')) {
    return [];
  }
  const settings = currentExecutionProviderSettings();
  if (!settings) return [];
  const preferred = resolveExecutionConnectionPreference({
    capabilityId: input.capabilityId,
    initialConnectionId: 'codex-app-server',
    projectId: input.projectId,
    settings,
    useCase: 'image',
  }).connectionId;
  const compatibleConnections = settings.connections.filter((connection) => (
      connection.enabled
      && connection.status === 'ready'
      && connection.enabledUseCases.includes('image')
      && connection.supportedCapabilityIds.includes(input.capabilityId)
    ));
  const selectedConnectionId = compatibleConnections.some(
    (connection) => connection.connectionId === preferred,
  )
    ? preferred
    : compatibleConnections[0]?.connectionId;
  return compatibleConnections
    .map((connection) => Object.freeze({
      connectionId: connection.connectionId,
      displayName: connection.displayName,
      ...(connection.modelId ? { modelLabel: connection.modelId } : {}),
      providerLabel: connection.providerLabel,
      selectedByDefault: connection.connectionId === selectedConnectionId,
    }));
}

async function pollConnectedExecution(
  executionId: string,
  scope: CanvasHostScopeV1,
  options: ConnectedPluginExecutionOptions,
): Promise<void> {
  while (true) {
    await delay(1_500);
    const latest = await loadBoardSnapshot(scope);
    const execution = latest.executions.find(
      (candidate) => candidate.executionId === executionId,
    );
    adoptIfCurrent(latest, options);
    if (!execution) {
      throw new Error(
        `Connected image execution disappeared: ${executionId}`,
      );
    }
    if (
      execution.status !== 'queued'
      && execution.status !== 'running'
    ) return;
  }
}

function adoptIfCurrent(
  snapshot: BoardSnapshot,
  options: ConnectedPluginExecutionOptions,
): boolean {
  if (!isCurrentScope(options.snapshotRef.current, scopeFor(snapshot))) return false;
  options.adoptDurableSnapshot(snapshot);
  return true;
}

function isCurrentScope(
  snapshot: BoardSnapshot,
  scope: CanvasHostScopeV1,
): boolean {
  return snapshot.project.projectId === scope.projectId
    && snapshot.board.boardId === scope.boardId;
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return { boardId: snapshot.board.boardId, projectId: snapshot.project.projectId };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException(
    'Connected Plugin execution was aborted.',
    'AbortError',
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
