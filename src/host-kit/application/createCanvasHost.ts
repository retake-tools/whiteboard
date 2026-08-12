import { createBlankBoardSnapshot } from '../../core/application/createBlankBoardSnapshot';
import { createStandardBlockRecord } from '../../core/application/createStandardBlockRecord';
import {
  cancelExecution as applyCancelExecution,
  executionIsActive,
} from '../../core/executionLifecycle';
import {
  addPluginImageOperation,
  completePluginImageOperation,
  failPluginImageOperation,
} from '../../core/pluginImageOperations';
import { createId, nowIso } from '../../core/id';
import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
  ExecutionRecord,
} from '../../core/types';
import {
  canvasHostApiVersionV1,
  canvasHostDomainSchemaVersionV1,
  type AttachAssetCommandV1,
  type CancelExecutionCommandV1,
  type CanvasHostReadModelV1,
  type CanvasHostScopeV1,
  type CanvasHostV1,
  type ConnectBlocksCommandV1,
  type CompleteLocalImageExecutionCommandV1,
  type CreateBlockCommandV1,
  type CreateBoardCommandV1,
  type CreateCanvasHostInputV1,
  type CreateExecutionCommandV1,
  type CreateGroupCommandV1,
  type DeepReadonly,
  type DissolveGroupCommandV1,
  type FitGroupCommandV1,
  type FailLocalImageExecutionCommandV1,
  type HostBoardRevisionV1,
  type HostPackageRuntimeSnapshotV1,
  type LayoutGroupCommandV1,
  type MoveBlocksCommandV1,
  type RemoveBlocksCommandV1,
  type RemoveConnectionsCommandV1,
  type ResizeBlockCommandV1,
  type ResizeGroupCommandV1,
  type StartLocalImageExecutionCommandV1,
  type TransitionExecutionCommandV1,
  type UpdateBlockCommandV1,
  type UpdateGroupCommandV1,
} from '../contracts';
import {
  connectBlocks as applyConnectBlocks,
  moveBlocks as applyMoveBlocks,
  removeBlocks as applyRemoveBlocks,
  removeConnections as applyRemoveConnections,
  resizeBlock as applyResizeBlock,
  updateBlock as applyUpdateBlock,
} from './boardEditing';
import {
  createGroup as applyCreateGroup,
  dissolveGroup as applyDissolveGroup,
  fitGroup as applyFitGroup,
  layoutGroup as applyLayoutGroup,
  resizeGroup as applyResizeGroup,
  updateGroup as applyUpdateGroup,
} from './groupEditing';
import { createWhiteboardCompatibilityBridge } from '../internal/createWhiteboardCompatibilityBridge';
import { registerWhiteboardCanvasHostBridge } from '../internal/whiteboardCompatibility';
import {
  appendExecutionHistory,
  appendHistory,
  assertExecutionTransition,
  assertKnownIds,
  assertNewAsset,
  assertPersistedAsset,
  assertScope,
  assertSnapshotIdentity,
  attachAssetToBlock,
  immutableSnapshot,
  immutableValue,
  isTerminal,
  requiredText,
  requireBlock,
  revisionFor,
  runtimeDemand,
  scopeFor,
  touch,
} from './canvasHostSupport';

export async function createCanvasHost(
  input: CreateCanvasHostInputV1,
): Promise<CanvasHostV1> {
  assertAdapterVersions(input);
  const [initialSnapshot, initialRuntime] = await Promise.all([
    input.storage.loadBoard(input.initialScope),
    input.packageRuntime.bootstrap({
      experience: input.experience,
      scope: input.initialScope,
    }),
  ]);
  let current = structuredClone(initialSnapshot);
  let published = immutableSnapshot(current);
  let durableRevision = revisionFor(current);
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<(snapshot: DeepReadonly<BoardSnapshot>) => void>();
  const runtimeListeners = new Set<(
    snapshot: DeepReadonly<HostPackageRuntimeSnapshotV1>,
  ) => void>();
  let runtimeSnapshot = immutableValue(initialRuntime);

  const readModel: CanvasHostReadModelV1 = Object.freeze({
    getRevision: () => revisionFor(current),
    getSnapshot: () => published,
    subscribe(listener: (snapshot: DeepReadonly<BoardSnapshot>) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const runtimeReadModel = Object.freeze({
    getSnapshot: () => runtimeSnapshot,
    subscribe(listener: (snapshot: DeepReadonly<HostPackageRuntimeSnapshotV1>) => void) {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  });

  function publishRuntime(snapshot: HostPackageRuntimeSnapshotV1): void {
    const next = immutableValue(snapshot);
    const changed = next.revision !== runtimeSnapshot.revision;
    runtimeSnapshot = next;
    if (changed) {
      for (const listener of runtimeListeners) listener(runtimeSnapshot);
    }
  }

  const unsubscribeRuntime = input.packageRuntime.subscribe(publishRuntime);

  function requireActive(): void {
    if (disposed) throw new Error('Canvas Host has been disposed.');
  }

  function serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = tail.then(operation, operation);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  function publish(snapshot: BoardSnapshot): void {
    current = structuredClone(snapshot);
    published = immutableSnapshot(current);
    for (const listener of listeners) listener(published);
  }

  async function saveStaged(
    staged: BoardSnapshot,
    expectedRevision: HostBoardRevisionV1 | undefined,
  ): Promise<BoardSnapshot> {
    const saved = await input.storage.saveBoard({
      expectedRevision,
      snapshot: immutableSnapshot(staged),
    });
    assertSnapshotIdentity(saved);
    durableRevision = revisionFor(saved);
    publish(saved);
    return current;
  }

  async function loadScopedCommandSnapshot(scope: CanvasHostScopeV1): Promise<{
    active: boolean;
    expectedRevision: HostBoardRevisionV1;
    snapshot: BoardSnapshot;
  }> {
    const active = sameScope(scopeFor(current), scope);
    const snapshot = active
      ? structuredClone(current)
      : await input.storage.loadBoard(scope);
    assertScope(snapshot, scope);
    assertSnapshotIdentity(snapshot);
    return {
      active,
      expectedRevision: active ? durableRevision : revisionFor(snapshot),
      snapshot,
    };
  }

  async function saveScopedCommandSnapshot(
    staged: BoardSnapshot,
    scope: CanvasHostScopeV1,
    expectedRevision: HostBoardRevisionV1,
    active: boolean,
  ): Promise<BoardSnapshot> {
    if (active) return saveStaged(staged, expectedRevision);
    const saved = await input.storage.saveBoard({
      expectedRevision,
      snapshot: immutableSnapshot(staged),
    });
    assertScope(saved, scope);
    assertSnapshotIdentity(saved);
    return saved;
  }

  async function mutate<Result>(
    update: (staged: BoardSnapshot) => { resultId: string; select: (snapshot: BoardSnapshot) => Result },
  ): Promise<DeepReadonly<Result>> {
    return serialize(async () => {
      requireActive();
      const expectedRevision = durableRevision;
      const staged = structuredClone(current);
      const { resultId, select } = update(staged);
      touch(staged);
      const saved = await saveStaged(staged, expectedRevision);
      const result = select(saved);
      if (!result) throw new Error(`Application command result is missing: ${resultId}.`);
      return immutableValue(result);
    });
  }

  async function createBoard(
    command: CreateBoardCommandV1,
  ): Promise<DeepReadonly<BoardSnapshot>> {
    return serialize(async () => {
      requireActive();
      const staged = createBlankBoardSnapshot({
        boardId: command.boardId,
        boardName: command.boardName,
        projectId: command.projectId,
        projectName: command.projectName,
      });
      const saved = await saveStaged(staged, undefined);
      const nextRuntime = await input.packageRuntime.setScope({
        demand: runtimeDemand(saved),
        scope: scopeFor(saved),
      });
      publishRuntime(nextRuntime);
      return immutableSnapshot(saved);
    });
  }

  async function createBlock(
    command: CreateBlockCommandV1,
  ): Promise<DeepReadonly<BlockRecord>> {
    return mutate((staged) => {
      const block = createStandardBlockRecord({ ...command, snapshot: staged });
      staged.blocks.push(block);
      if (block.type === 'operation') {
        appendHistory(staged, {
          actor: 'user',
          blockIds: [block.blockId],
          summary: `Created operation ${block.data.title}`,
          type: 'operation_created',
        });
      }
      return {
        resultId: block.blockId,
        select: (snapshot) => snapshot.blocks.find(
          (candidate) => candidate.blockId === block.blockId,
        )!,
      };
    });
  }

  async function createGroup(command: CreateGroupCommandV1) {
    return mutate((staged) => {
      const groupId = applyCreateGroup(staged, command);
      return {
        resultId: groupId,
        select: (snapshot) => requireBlock(snapshot, groupId),
      };
    });
  }

  async function updateGroup(command: UpdateGroupCommandV1) {
    return mutate((staged) => {
      const groupId = applyUpdateGroup(staged, command);
      return {
        resultId: groupId,
        select: (snapshot) => requireBlock(snapshot, groupId),
      };
    });
  }

  async function resizeGroup(command: ResizeGroupCommandV1) {
    return mutate((staged) => {
      const groupId = applyResizeGroup(staged, command);
      return {
        resultId: groupId,
        select: (snapshot) => requireBlock(snapshot, groupId),
      };
    });
  }

  async function fitGroup(command: FitGroupCommandV1) {
    return mutate((staged) => {
      const groupId = applyFitGroup(staged, command);
      return {
        resultId: groupId,
        select: (snapshot) => requireBlock(snapshot, groupId),
      };
    });
  }

  async function layoutGroup(command: LayoutGroupCommandV1) {
    return mutate((staged) => {
      const groupId = applyLayoutGroup(staged, command);
      return {
        resultId: groupId,
        select: (snapshot) => requireBlock(snapshot, groupId),
      };
    });
  }

  async function dissolveGroup(command: DissolveGroupCommandV1) {
    return mutate((staged) => {
      const childBlockIds = applyDissolveGroup(staged, command);
      return {
        resultId: command.groupId,
        select: () => ({ childBlockIds, groupId: command.groupId }),
      };
    });
  }

  async function attachAsset(
    command: AttachAssetCommandV1,
  ): Promise<DeepReadonly<AssetRecord>> {
    return serialize(async () => {
      requireActive();
      const asset: AssetRecord = {
        assetId: command.assetId ?? createId('asset'),
        createdAt: nowIso(),
        height: command.height,
        kind: command.kind,
        mimeType: command.mimeType,
        previewUrl: command.previewUrl,
        projectId: current.project.projectId,
        sourceExecutionId: command.sourceExecutionId,
        storageKey: command.storageKey,
        storageProvider: command.storageProvider,
        width: command.width,
      };
      assertNewAsset(current, asset);
      if (command.blockId) {
        attachAssetToBlock(structuredClone(current), command.blockId, asset, {
          fileName: command.fileName,
        });
      }
      const persisted = await input.storage.persistAsset(
        immutableValue(asset),
        command.fileName === undefined ? undefined : { fileName: command.fileName },
      );
      assertPersistedAsset(asset, persisted, command.assetId);
      assertNewAsset(current, persisted);
      const expectedRevision = durableRevision;
      const staged = structuredClone(current);
      staged.assets.push(structuredClone(persisted));
      const previousAssetId = command.blockId
        ? attachAssetToBlock(staged, command.blockId, persisted, {
            fileName: command.fileName,
          })
        : undefined;
      appendHistory(staged, {
        actor: 'user',
        assetIds: [previousAssetId, persisted.assetId].filter(
          (assetId): assetId is string => assetId !== undefined,
        ),
        blockIds: command.blockId ? [command.blockId] : undefined,
        detail: previousAssetId === undefined
          ? { assetId: persisted.assetId }
          : { assetId: persisted.assetId, previousAssetId },
        summary: command.fileName || `Imported ${persisted.kind} asset`,
        type: previousAssetId === undefined ? 'asset_imported' : 'asset_replaced',
      });
      touch(staged);
      const saved = await saveStaged(staged, expectedRevision);
      return immutableValue(saved.assets.find(
        (candidate) => candidate.assetId === persisted.assetId,
      )!);
    });
  }

  async function cancelExecution(command: CancelExecutionCommandV1) {
    return mutate((staged) => {
      const existing = staged.executions.find(
        (candidate) => candidate.executionId === command.executionId,
      );
      if (!existing) throw new Error(`Execution not found: ${command.executionId}.`);
      if (!executionIsActive(existing)) {
        throw new Error(`Execution is not active: ${command.executionId}.`);
      }
      const canceled = applyCancelExecution(staged, command.executionId);
      const executionId = canceled.execution!.executionId;
      return {
        resultId: executionId,
        select: (snapshot) => ({
          execution: snapshot.executions.find(
            (candidate) => candidate.executionId === executionId,
          )!,
          removedBlockIds: canceled.removedBlockIds,
        }),
      };
    });
  }

  async function startLocalImageExecution(
    command: StartLocalImageExecutionCommandV1,
  ) {
    return mutate((staged) => {
      const sourceBlock = requireBlock(staged, command.sourceBlockId);
      const sourceAssetId = typeof sourceBlock.data.assetId === 'string'
        ? sourceBlock.data.assetId
        : undefined;
      const sourceAsset = sourceAssetId
        ? staged.assets.find((candidate) => candidate.assetId === sourceAssetId)
        : undefined;
      if (sourceBlock.type !== 'image' || sourceAsset?.kind !== 'image') {
        throw new Error('Local image execution requires a bound Image Block with an Asset.');
      }
      const started = addPluginImageOperation(staged, {
        body: command.body ?? command.title,
        capabilityId: requiredText(command.capabilityId, 'capabilityId'),
        params: structuredClone(command.params ?? {}),
        sourceBlockId: sourceBlock.blockId,
        title: requiredText(command.title, 'title'),
      });
      const operationBlockId = started.operationBlock.blockId;
      const resultBlockId = started.resultBlock.blockId;
      const executionId = started.execution.executionId;
      return {
        resultId: executionId,
        select: (snapshot) => ({
          execution: snapshot.executions.find(
            (candidate) => candidate.executionId === executionId,
          )!,
          operationBlock: requireBlock(snapshot, operationBlockId),
          resultBlock: requireBlock(snapshot, resultBlockId),
        }),
      };
    });
  }

  async function completeLocalImageExecution(
    command: CompleteLocalImageExecutionCommandV1,
  ) {
    return serialize(async () => {
      requireActive();
      if (
        command.asset.kind !== 'image'
        || !command.asset.mimeType.startsWith('image/')
      ) {
        throw new Error('Local image execution completion requires an Image Asset.');
      }
      const target = await loadScopedCommandSnapshot(command.scope);
      const asset: AssetRecord = {
        assetId: command.asset.assetId ?? createId('asset'),
        createdAt: nowIso(),
        height: command.asset.height,
        kind: command.asset.kind,
        mimeType: command.asset.mimeType,
        previewUrl: command.asset.previewUrl,
        projectId: target.snapshot.project.projectId,
        sourceExecutionId: command.executionId,
        storageKey: command.asset.storageKey,
        storageProvider: command.asset.storageProvider,
        width: command.asset.width,
      };
      assertNewAsset(target.snapshot, asset);
      completePluginImageOperation(structuredClone(target.snapshot), {
        asset,
        executionId: command.executionId,
      });
      const persisted = await input.storage.persistAsset(
        immutableValue(asset),
        command.asset.fileName === undefined
          ? undefined
          : { fileName: command.asset.fileName },
      );
      assertPersistedAsset(asset, persisted, command.asset.assetId);
      if (persisted.sourceExecutionId !== command.executionId) {
        throw new Error('Storage Adapter changed Asset execution lineage while persisting it.');
      }
      assertNewAsset(target.snapshot, persisted);
      const staged = structuredClone(target.snapshot);
      const completed = completePluginImageOperation(staged, {
        asset: persisted,
        executionId: command.executionId,
      });
      const saved = await saveScopedCommandSnapshot(
        staged,
        command.scope,
        target.expectedRevision,
        target.active,
      );
      return immutableValue({
        asset: saved.assets.find(
          (candidate) => candidate.assetId === persisted.assetId,
        )!,
        execution: saved.executions.find(
          (candidate) => candidate.executionId === completed.execution.executionId,
        )!,
        operationBlock: requireBlock(saved, completed.operationBlock.blockId),
        resultBlock: requireBlock(saved, completed.resultBlock.blockId),
      });
    });
  }

  async function failLocalImageExecution(
    command: FailLocalImageExecutionCommandV1,
  ) {
    return serialize(async () => {
      requireActive();
      const target = await loadScopedCommandSnapshot(command.scope);
      const existing = target.snapshot.executions.find(
        (candidate) => candidate.executionId === command.executionId,
      );
      if (
        !existing
        || existing.adapter !== 'local_canvas'
        || existing.status !== 'running'
      ) {
        throw new Error(`Local image execution is not running: ${command.executionId}.`);
      }
      const staged = structuredClone(target.snapshot);
      const failed = failPluginImageOperation(staged, {
        errorMessage: requiredText(command.errorMessage, 'errorMessage'),
        executionId: command.executionId,
      })!;
      const saved = await saveScopedCommandSnapshot(
        staged,
        command.scope,
        target.expectedRevision,
        target.active,
      );
      return immutableValue(saved.executions.find(
        (candidate) => candidate.executionId === failed.executionId,
      )!);
    });
  }

  async function createExecution(
    command: CreateExecutionCommandV1,
  ): Promise<DeepReadonly<ExecutionRecord>> {
    return mutate((staged) => {
      assertKnownIds(staged, command.inputBlockIds, command.inputAssetIds ?? []);
      if (command.operationBlockId) {
        const operation = requireBlock(staged, command.operationBlockId);
        if (operation.type !== 'operation') {
          throw new Error('Execution operationBlockId must reference an Operation Block.');
        }
      }
      const execution: ExecutionRecord = {
        adapter: command.adapter,
        boardId: staged.board.boardId,
        capabilityId: requiredText(command.capabilityId, 'capabilityId'),
        connectionId: command.connectionId,
        executionId: createId('execution'),
        inputAssetIds: [...(command.inputAssetIds ?? [])],
        inputBlockIds: [...command.inputBlockIds],
        outputAssetIds: [],
        outputBlockIds: [...(command.outputBlockIds ?? [])],
        params: command.params || command.operationBlockId
          ? {
              ...structuredClone(command.params ?? {}),
              ...(command.operationBlockId
                ? { operationBlockId: command.operationBlockId }
                : {}),
            }
          : undefined,
        projectId: staged.project.projectId,
        prompt: command.prompt,
        provider: command.provider,
        recordVersion: 1,
        startedAt: nowIso(),
        status: 'queued',
        triggerMode: command.triggerMode,
      };
      staged.executions.push(execution);
      if (command.operationBlockId) {
        const operation = requireBlock(staged, command.operationBlockId);
        operation.data.executionStatus = execution.status;
        operation.data.sourceExecutionId = execution.executionId;
        operation.data.status = execution.status;
        operation.updatedAt = execution.startedAt;
      }
      return {
        resultId: execution.executionId,
        select: (snapshot) => snapshot.executions.find(
          (candidate) => candidate.executionId === execution.executionId,
        )!,
      };
    });
  }

  async function transitionExecution(
    command: TransitionExecutionCommandV1,
  ): Promise<DeepReadonly<ExecutionRecord>> {
    return mutate((staged) => {
      const execution = staged.executions.find(
        (candidate) => candidate.executionId === command.executionId,
      );
      if (!execution) throw new Error(`Execution not found: ${command.executionId}.`);
      assertExecutionTransition(execution.status, command.status);
      assertKnownIds(
        staged,
        command.outputBlockIds ?? execution.outputBlockIds,
        command.outputAssetIds ?? execution.outputAssetIds,
      );
      execution.status = command.status;
      execution.outputAssetIds = [...(command.outputAssetIds ?? execution.outputAssetIds)];
      execution.outputBlockIds = [...(command.outputBlockIds ?? execution.outputBlockIds)];
      execution.errorMessage = command.errorMessage;
      execution.recordVersion = (execution.recordVersion ?? 0) + 1;
      if (isTerminal(command.status)) {
        execution.completedAt = command.completedAt ?? nowIso();
      }
      const operation = staged.blocks.find(
        (block) => block.data.sourceExecutionId === execution.executionId,
      );
      if (operation) {
        operation.data.executionStatus = command.status;
        operation.data.status = command.status;
        operation.updatedAt = nowIso();
      }
      appendExecutionHistory(staged, execution);
      return {
        resultId: execution.executionId,
        select: (snapshot) => snapshot.executions.find(
          (candidate) => candidate.executionId === execution.executionId,
        )!,
      };
    });
  }

  async function moveBlocks(command: MoveBlocksCommandV1) {
    return mutate((staged) => {
      const blockIds = applyMoveBlocks(staged, command);
      return {
        resultId: blockIds.join(','),
        select: (snapshot) => blockIds.map((blockId) => requireBlock(snapshot, blockId)),
      };
    });
  }

  async function resizeBlock(command: ResizeBlockCommandV1) {
    return mutate((staged) => {
      const blockId = applyResizeBlock(staged, command);
      return {
        resultId: blockId,
        select: (snapshot) => requireBlock(snapshot, blockId),
      };
    });
  }

  async function connectBlocks(command: ConnectBlocksCommandV1) {
    return mutate((staged) => {
      const edge = applyConnectBlocks(staged, command);
      return {
        resultId: edge.edgeId,
        select: (snapshot) => snapshot.edges.find((candidate) => candidate.edgeId === edge.edgeId)!,
      };
    });
  }

  async function removeBlocks(command: RemoveBlocksCommandV1) {
    return mutate((staged) => {
      const removedIds = applyRemoveBlocks(staged, command);
      return {
        resultId: removedIds.join(','),
        select: () => removedIds,
      };
    });
  }

  async function removeConnections(command: RemoveConnectionsCommandV1) {
    return mutate((staged) => {
      const removedIds = applyRemoveConnections(staged, command);
      return {
        resultId: removedIds.join(','),
        select: () => removedIds,
      };
    });
  }

  async function updateBlock(command: UpdateBlockCommandV1) {
    return mutate((staged) => {
      const blockId = applyUpdateBlock(staged, command);
      return {
        resultId: blockId,
        select: (snapshot) => requireBlock(snapshot, blockId),
      };
    });
  }

  const host: CanvasHostV1 = Object.freeze({
    apiVersion: canvasHostApiVersionV1,
    commands: Object.freeze({
      attachAsset,
      cancelExecution,
      completeLocalImageExecution,
      connectBlocks,
      createBlock,
      createBoard,
      createExecution,
      createGroup,
      dissolveGroup,
      failLocalImageExecution,
      fitGroup,
      layoutGroup,
      moveBlocks,
      removeBlocks,
      removeConnections,
      resizeBlock,
      resizeGroup,
      startLocalImageExecution,
      transitionExecution,
      updateBlock,
      updateGroup,
    }),
    connections: input.connections,
    domainSchemaVersion: canvasHostDomainSchemaVersionV1,
    async dispose() {
      await serialize(async () => {
        if (disposed) return;
        disposed = true;
        listeners.clear();
        runtimeListeners.clear();
        unsubscribeRuntime();
        await input.packageRuntime.dispose();
      });
    },
    environment: Object.freeze(structuredClone(input.environment)),
    experience: Object.freeze(structuredClone(input.experience)),
    readModel,
    runtime: runtimeReadModel,
    async setScope(scope: CanvasHostScopeV1) {
      await serialize(async () => {
        requireActive();
        const snapshot = await input.storage.loadBoard(scope);
        assertScope(snapshot, scope);
        const nextRuntime = await input.packageRuntime.setScope({
          demand: runtimeDemand(snapshot),
          scope,
        });
        publishRuntime(nextRuntime);
        publish(snapshot);
        durableRevision = revisionFor(snapshot);
      });
    },
  });
  registerWhiteboardCanvasHostBridge(host, createWhiteboardCompatibilityBridge({
    current: () => current,
    durableRevision: () => durableRevision,
    persistAsset: (asset, options) => input.storage.persistAsset(asset, options),
    publish,
    requireActive,
    saveStaged,
    serialize,
    setDurableRevision: (revision) => {
      durableRevision = revision;
    },
  }));
  return host;
}

function assertAdapterVersions(input: CreateCanvasHostInputV1): void {
  for (const [name, version] of [
    ['Connection', input.connections.adapterVersion],
    ['Package Runtime', input.packageRuntime.adapterVersion],
    ['Storage', input.storage.adapterVersion],
  ] as const) {
    if (version !== 1) throw new Error(`${name} Adapter version is not compatible with Canvas Host V1.`);
  }
}

function sameScope(left: CanvasHostScopeV1, right: CanvasHostScopeV1): boolean {
  return left.boardId === right.boardId && left.projectId === right.projectId;
}
