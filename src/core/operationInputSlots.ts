import { suggestedInputSlotId } from './capabilities';
import { suggestedTextInputSlotId } from './textOperations';
import type { BlockRecord, BoardSnapshot } from './types';

export function suggestedExecutionInputSlotId(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  operationBlock: BlockRecord,
  currentEdgeId?: string,
): string | undefined {
  if (sourceBlock.type === 'text' && operationBlock.type === 'operation') {
    return suggestedTextInputSlotId(snapshot, operationBlock, sourceBlock)
      ?? suggestedInputSlotId(snapshot, sourceBlock, operationBlock, currentEdgeId);
  }
  return suggestedInputSlotId(snapshot, sourceBlock, operationBlock, currentEdgeId);
}
