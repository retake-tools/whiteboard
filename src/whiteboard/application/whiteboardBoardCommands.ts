import {
  normalizeBoardBackground,
  setBoardBackground,
} from '../../core/boardBackground';
import type { BoardBackgroundV1, BoardSnapshot } from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardBoardCommandsV1 {
  setBackground(input: {
    background: BoardBackgroundV1;
    expectedScope: CanvasHostScopeV1;
  }): Promise<{ committed: boolean }>;
}

export function createWhiteboardBoardCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardBoardCommandsV1 {
  return Object.freeze({
    async setBackground(input: Parameters<WhiteboardBoardCommandsV1['setBackground']>[0]) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const current = normalizeBoardBackground(snapshot.board.background);
        const nextBackground = normalizeBoardBackground(input.background);
        if (JSON.stringify(current) === JSON.stringify(nextBackground)) {
          return { changed: false, result: {} };
        }
        const next = setBoardBackground(snapshot, nextBackground);
        snapshot.board = next.board;
        return { changed: true, result: {} };
      });
      return { committed: transaction.committed };
    },
  });
}

function assertScope(snapshot: BoardSnapshot, expected: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== expected.projectId
    || snapshot.board.boardId !== expected.boardId
  ) {
    throw new Error('Board command scope changed before commit.');
  }
}
