import type { ProjectArtifactLibrarySnapshot } from '../../core/artifactContracts';
import { isTextDocumentCapability } from '../../core/capabilityRegistry';
import {
  executionConnection,
  resolveExecutionConnectionPreference,
} from '../../core/executionProviderPreferences';
import { generationPreparationCapabilityId } from '../../core/generationPreparationContracts';
import { executeExistingGenerationPreparationOperation } from '../../core/generationPreparationOperations';
import { blockLockedByGroup } from '../../core/grouping';
import {
  executeExistingTextGenerationOperation,
  type TextGenerationLabels,
} from '../../core/textOperations';
import type { BoardSnapshot } from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardTextGenerationCommandsV1 {
  queue(input: {
    artifactLibrary?: ProjectArtifactLibrarySnapshot;
    connectionUnavailableMessage: string;
    expectedScope: CanvasHostScopeV1;
    labels: Pick<TextGenerationLabels, 'resultTitle' | 'waitingBody'>;
    operationBlockId: string;
  }): Promise<{
    capabilityId: string;
    connectionId: string;
    executionId: string;
    resultBlockId: string;
    scope: CanvasHostScopeV1;
  }>;
}

export function createWhiteboardTextGenerationCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardTextGenerationCommandsV1 {
  return Object.freeze({
    async queue(input: Parameters<WhiteboardTextGenerationCommandsV1['queue']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const operation = requireTextOperation(snapshot, input.operationBlockId);
        const capabilityId = String(operation.data.capabilityId);
        const preference = resolveExecutionConnectionPreference({
          capabilityId,
          explicitConnectionId: typeof operation.data.connectionId === 'string'
            ? operation.data.connectionId
            : undefined,
          initialConnectionId: 'codex-app-server',
          projectId: snapshot.project.projectId,
          useCase: 'text',
        });
        const connectionId = preference.connectionId ?? '';
        const connection = executionConnection(connectionId, snapshot.project.projectId);
        if (!connection || !preference.isUsable) {
          throw new Error(input.connectionUnavailableMessage);
        }
        const run = capabilityId === generationPreparationCapabilityId
          ? executeExistingGenerationPreparationOperation(snapshot, {
              artifactLibrary: requireArtifactLibrary(input.artifactLibrary),
              connection,
              labels: input.labels,
              operationBlockId: operation.blockId,
            })
          : executeExistingTextGenerationOperation(snapshot, {
              connection,
              labels: input.labels,
              operationBlockId: operation.blockId,
            });
        return {
          capabilityId,
          connectionId,
          executionId: run.execution.executionId,
          resultBlockId: run.resultBlock.blockId,
          scope: {
            boardId: snapshot.board.boardId,
            projectId: snapshot.project.projectId,
          },
        };
      });
      return transaction.result;
    },
  });
}

function assertScope(snapshot: BoardSnapshot, scope: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== scope.projectId
    || snapshot.board.boardId !== scope.boardId
  ) {
    throw new Error('Text generation Operation belongs to another Project or Board.');
  }
}

function requireTextOperation(snapshot: BoardSnapshot, blockId: string) {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  const capabilityId = block?.type === 'operation' && typeof block.data.capabilityId === 'string'
    ? block.data.capabilityId
    : '';
  if (!block || block.type !== 'operation' || !isTextDocumentCapability(capabilityId)) {
    throw new Error(`Text generation Operation not found: ${blockId}`);
  }
  if (blockLockedByGroup(snapshot, block.blockId)) {
    throw new Error(`Text generation Operation is locked by its Group: ${blockId}`);
  }
  return block;
}

function requireArtifactLibrary(
  artifactLibrary: ProjectArtifactLibrarySnapshot | undefined,
): ProjectArtifactLibrarySnapshot {
  if (!artifactLibrary) {
    throw new Error('Generation Preparation requires the Project Artifact authority.');
  }
  return artifactLibrary;
}
