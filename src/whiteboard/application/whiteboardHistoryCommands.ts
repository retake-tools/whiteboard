import { touchBoard } from '../../core/blockFactory';
import { appendPromptCopiedEvent } from '../../core/historyEvents';
import type { BoardSnapshot } from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardHistoryCommandsV1 {
  recordPromptCopied(input: {
    blockIds?: string[];
    executionId: string;
    expectedScope: CanvasHostScopeV1;
    prompt: string;
    source: string;
  }): Promise<{ eventId: string }>;
}

export function createWhiteboardHistoryCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardHistoryCommandsV1 {
  return Object.freeze({
    async recordPromptCopied(
      input: Parameters<WhiteboardHistoryCommandsV1['recordPromptCopied']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        if (!snapshot.executions.some(
          (execution) => execution.executionId === input.executionId,
        )) {
          throw new Error(`Prompt copy Execution not found: ${input.executionId}`);
        }
        touchBoard(appendPromptCopiedEvent(snapshot, input));
        const eventId = snapshot.historyEvents?.[0]?.eventId;
        if (!eventId) throw new Error('Prompt copy history event was not created.');
        return { eventId };
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
    throw new Error('Prompt copy belongs to another Project or Board.');
  }
}
