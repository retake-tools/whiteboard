import type { Edge, Node } from '@xyflow/react';
import type {
  BlockRecord,
  BlockType,
  ConnectionKind,
} from '../core/types';
import type { ReferenceIntentV1 } from '../core/referenceIntent';

/** Canvas-only projections. Headless domain consumers must not depend on ReactFlow. */
export type RetakeNode = Node<BlockRecord['data'], BlockType>;

export type RetakeEdge = Edge<{
  inputSlotId?: string;
  kind: ConnectionKind;
  proxyEdgeIds?: string[];
  referenceIntent?: ReferenceIntentV1;
  resultCount?: number;
  resultHeight?: number;
  resultIndex?: number;
  workflowFanoutCount?: number;
  workflowFanoutIndex?: number;
  workflowFaninCount?: number;
  workflowFaninIndex?: number;
  workflowGutterX?: number;
  workflowHistoricalResult?: boolean;
  workflowRouteKind?: 'long_dependency' | 'result_fanout' | 'standard' | 'step_dependency';
}>;
