import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFlowEdges, createFlowNodes, nodeColor, nodeStrokeColor } from '../src/core/flowProjection';
import {
  arrangeGroupChildren,
  createExecutionResultGroup,
  createGroupFromBounds,
  createGroupAroundBlocks,
  blockLockedByGroup,
  dissolveGroup,
  findGroupDropTarget,
  groupMediaItems,
  groupStructureLocked,
  repairGroupRelationships,
} from '../src/core/grouping';
import { connectedWorkflowBlockIds } from '../src/core/workflowSelection';

const canvasSource = await readFile('src/app/useCanvasController.ts', 'utf8');
assert.match(canvasSource, /nodeDragActiveRef\.current = true/);
assert.match(canvasSource, /if \(!nodeDragActiveRef\.current\) setNodes\(createFlowNodesForSelection\(remoteSnapshot\)\)/);
const canvasViewSource = await readFile('src/app/WhiteboardCanvas.tsx', 'utf8');
const canvasCss = await readFile('src/styles/canvas.css', 'utf8');
const blockNodeCss = await readFile('src/nodes/block-node.css', 'utf8');
assert.match(canvasViewSource, /zoomOnDoubleClick=\{false\}/);
assert.match(canvasSource, /function selectConnectedWorkflow[\s\S]*?window\.requestAnimationFrame/);
assert.match(canvasViewSource, /data-pointer-moving="false"[\s\S]*?onPointerMoveCapture=\{handleCanvasPointerMove\}/);
assert.match(canvasCss, /\[data-pointer-moving='true'\] \.react-flow__node:not\(\.dragging\)[\s\S]*?cursor: default !important;/);
assert.match(blockNodeCss, /\.image-preview img \{[\s\S]*?pointer-events: none;[\s\S]*?-webkit-user-drag: none;/);
assert.match(blockNodeCss, /\.operation-input-quick-add \{[\s\S]*?pointer-events: none;/);
assert.match(blockNodeCss, /\.block-node-text \{[\s\S]*?cursor: text;/);
assert.match(blockNodeCss, /\.block-node-text \.block-heading,[\s\S]*?\.block-node-operation \.block-heading \{[\s\S]*?cursor: grab;/);
assert.match(blockNodeCss, /\.react-flow__node\.draggable \{[\s\S]*?cursor: grab;/);
assert.match(blockNodeCss, /\.react-flow__node\.dragging \*[\s\S]*?cursor: grabbing !important;/);
import type { BlockRecord, BoardSnapshot } from '../src/core/types';

const createdAt = '2026-07-10T00:00:00.000Z';

function block(
  blockId: string,
  type: BlockRecord['type'],
  x: number,
  y: number,
  width = 100,
  height = 80,
): BlockRecord {
  return {
    blockId,
    boardId: 'board_test',
    type,
    layerId: 'layer_default',
    position: { x, y },
    size: { width, height },
    zIndex: 2,
    data: { title: blockId },
    createdAt,
    updatedAt: createdAt,
  };
}

const drawInside = block('draw_inside', 'text', 40, 50, 100, 80);
const drawOutside = block('draw_outside', 'text', 360, 50, 100, 80);
const drawSnapshot = snapshot([drawInside, drawOutside]);
const drawnGroup = createGroupFromBounds(drawSnapshot, { x: 20, y: 20, width: 220, height: 160 }, { title: 'Drawn' });
assert.ok(drawnGroup);
assert.equal(drawInside.parentGroupId, drawnGroup.blockId);
assert.equal(drawOutside.parentGroupId, undefined);
assert.equal(findGroupDropTarget(
  drawSnapshot,
  drawOutside.blockId,
  { x: 60, y: 70, width: drawOutside.size.width, height: drawOutside.size.height },
), drawnGroup.blockId);
drawnGroup.data.groupContentsLocked = true;
assert.equal(blockLockedByGroup(drawSnapshot, drawInside.blockId), true);
assert.equal(groupStructureLocked(drawSnapshot, drawnGroup.blockId), true);
const lockedFlowNodes = createFlowNodes(drawSnapshot);
assert.equal(lockedFlowNodes.find((node) => node.id === drawInside.blockId)?.draggable, false);
assert.equal(lockedFlowNodes.find((node) => node.id === drawOutside.blockId)?.draggable, true);
assert.equal(lockedFlowNodes.find((node) => node.id === drawInside.blockId)?.deletable, false);
assert.equal(lockedFlowNodes.find((node) => node.id === drawnGroup.blockId)?.deletable, false);
const lockedNestedGroup = block('locked_nested_group', 'group', 60, 60, 180, 140);
lockedNestedGroup.data.groupPositionLocked = true;
lockedNestedGroup.data.groupContentsLocked = true;
const lockedNestedChild = block('locked_nested_child', 'image', 90, 90, 80, 60);
lockedNestedChild.parentGroupId = lockedNestedGroup.blockId;
const lockedNestingSnapshot = snapshot([lockedNestedGroup, lockedNestedChild]);
const lockedOuterGroup = createGroupFromBounds(
  lockedNestingSnapshot,
  { x: 20, y: 20, width: 300, height: 240 },
  { title: 'Locked outer' },
);
assert.ok(lockedOuterGroup);
assert.equal(lockedNestedGroup.parentGroupId, lockedOuterGroup.blockId);
assert.equal(
  createFlowNodes(lockedNestingSnapshot).find((node) => node.id === lockedNestedGroup.blockId)?.parentId,
  lockedOuterGroup.blockId,
);

function snapshot(blocks: BlockRecord[]): BoardSnapshot {
  return {
    schemaVersion: 1,
    project: {
      projectId: 'project_test',
      name: 'Test project',
      createdAt,
      updatedAt: createdAt,
      defaultBoardId: 'board_test',
    },
    board: {
      boardId: 'board_test',
      projectId: 'project_test',
      name: 'Test board',
      createdAt,
      updatedAt: createdAt,
    },
    layers: [{ id: 'layer_default', boardId: 'board_test', name: 'Default', visible: true, locked: false, order: 0 }],
    blocks,
    edges: [],
    assets: [],
    executions: [],
    historyEvents: [],
  };
}

const simplePrompt = block('simple_prompt', 'text', 0, 0);
const simpleSource = block('simple_source', 'image', 0, 120);
const simpleOperation = block('simple_operation', 'operation', 220, 0);
simpleOperation.data.promptSourceBlockId = simplePrompt.blockId;
const simpleWorkflowSnapshot = snapshot([simplePrompt, simpleSource, simpleOperation]);
simpleWorkflowSnapshot.edges.push(
  {
    edgeId: 'edge_simple_prompt',
    sourceBlockId: simplePrompt.blockId,
    targetBlockId: simpleOperation.blockId,
    kind: 'execution_input',
  },
  {
    edgeId: 'edge_simple_source',
    sourceBlockId: simpleSource.blockId,
    targetBlockId: simpleOperation.blockId,
    kind: 'execution_input',
    inputRole: 'source',
  },
);
const simpleWorkflowIds = new Set([simplePrompt.blockId, simpleSource.blockId, simpleOperation.blockId]);
assert.deepEqual(new Set(connectedWorkflowBlockIds(simpleWorkflowSnapshot, simplePrompt.blockId)), simpleWorkflowIds);
assert.deepEqual(new Set(connectedWorkflowBlockIds(simpleWorkflowSnapshot, simpleSource.blockId)), simpleWorkflowIds);
assert.deepEqual(new Set(connectedWorkflowBlockIds(simpleWorkflowSnapshot, simpleOperation.blockId)), simpleWorkflowIds);

const first = block('first', 'image', 100, 120);
const second = block('second', 'image', 240, 150);
const note = block('note', 'text', 500, 90, 180, 120);
const nestedSnapshot = snapshot([first, second, note]);
const innerGroup = createGroupAroundBlocks(nestedSnapshot, [first.blockId, second.blockId], { title: 'Candidates' });
assert.ok(innerGroup);
assert.equal(first.parentGroupId, innerGroup.blockId);
assert.equal(second.parentGroupId, innerGroup.blockId);

const outerGroup = createGroupAroundBlocks(nestedSnapshot, [innerGroup.blockId, note.blockId], {
  color: 'rose',
  kind: 'workflow',
  title: 'Workflow',
});
assert.ok(outerGroup);
assert.equal(innerGroup.parentGroupId, outerGroup.blockId);
assert.equal(note.parentGroupId, outerGroup.blockId);

const flowNodes = createFlowNodes(nestedSnapshot);
const outerNodeIndex = flowNodes.findIndex((node) => node.id === outerGroup.blockId);
const innerNodeIndex = flowNodes.findIndex((node) => node.id === innerGroup.blockId);
const firstNodeIndex = flowNodes.findIndex((node) => node.id === first.blockId);
assert.ok(outerNodeIndex < innerNodeIndex && innerNodeIndex < firstNodeIndex);

const innerNode = flowNodes[innerNodeIndex];
const firstNode = flowNodes[firstNodeIndex];
assert.equal(innerNode.parentId, outerGroup.blockId);
assert.deepEqual(innerNode.position, {
  x: innerGroup.position.x - outerGroup.position.x,
  y: innerGroup.position.y - outerGroup.position.y,
});
assert.equal(firstNode.parentId, innerGroup.blockId);
assert.deepEqual(firstNode.position, {
  x: first.position.x - innerGroup.position.x,
  y: first.position.y - innerGroup.position.y,
});
assert.equal(firstNode.extent, undefined);

nestedSnapshot.edges.push({
  edgeId: 'edge_group_scope',
  sourceBlockId: first.blockId,
  targetBlockId: note.blockId,
  kind: 'visual_note',
});
const scopedFlowNodes = createFlowNodes(nestedSnapshot, { selectedBlockIds: [outerGroup.blockId] });
assert.equal(scopedFlowNodes.find((node) => node.id === outerGroup.blockId)?.data.groupScopeSelected, false);
assert.equal(scopedFlowNodes.find((node) => node.id === innerGroup.blockId)?.data.groupScopeSelected, true);
assert.equal(scopedFlowNodes.find((node) => node.id === first.blockId)?.data.groupScopeSelected, true);
assert.equal(scopedFlowNodes.find((node) => node.id === note.blockId)?.data.groupScopeSelected, true);
assert.equal(createFlowEdges(nestedSnapshot, { selectedBlockIds: [outerGroup.blockId] })[0]?.className, 'is-connected-to-selection');
const outerFlowNode = scopedFlowNodes.find((node) => node.id === outerGroup.blockId);
assert.ok(outerFlowNode);
assert.equal(nodeColor(outerFlowNode), '#fda4af');
assert.equal(nodeStrokeColor(outerFlowNode), '#f43f5e');

const firstAbsolutePosition = { ...first.position };
assert.deepEqual(dissolveGroup(nestedSnapshot, innerGroup.blockId).sort(), ['first', 'second']);
assert.equal(first.parentGroupId, outerGroup.blockId);
assert.deepEqual(first.position, firstAbsolutePosition);
assert.equal(nestedSnapshot.blocks.some((candidate) => candidate.blockId === innerGroup.blockId), false);

const workflowGroup = block('workflow', 'group', 0, 0, 900, 600);
workflowGroup.data = { title: 'Workflow', groupKind: 'workflow' };
const operation = block('operation', 'operation', 80, 120, 320, 190);
operation.parentGroupId = workflowGroup.blockId;
const workflowPrompt = block('workflow_prompt', 'text', 20, 120, 220, 140);
workflowPrompt.parentGroupId = workflowGroup.blockId;
operation.data.promptSourceBlockId = workflowPrompt.blockId;
const resultOne = block('result_one', 'image', 480, 100, 180, 240);
const resultTwo = block('result_two', 'image', 700, 100, 180, 240);
const workflowVideo = block('workflow_video', 'video', 480, 400, 300, 180);
resultOne.data.assetId = 'asset_result_one';
resultTwo.data.assetId = 'asset_result_two';
resultOne.data.sourceExecutionId = 'exec_batch';
resultTwo.data.sourceExecutionId = 'exec_batch';
workflowVideo.data.assetId = 'asset_video';
workflowVideo.parentGroupId = workflowGroup.blockId;
const batchSnapshot = snapshot([workflowGroup, workflowPrompt, operation, resultOne, resultTwo, workflowVideo]);
batchSnapshot.assets.push(
  {
    assetId: 'asset_result_one', projectId: 'project_test', kind: 'image', mimeType: 'image/png',
    storageProvider: 'local', storageKey: 'one.png', previewUrl: '/one.png', createdAt,
  },
  {
    assetId: 'asset_result_two', projectId: 'project_test', kind: 'image', mimeType: 'image/png',
    storageProvider: 'local', storageKey: 'two.png', previewUrl: '/two.png', createdAt,
  },
  {
    assetId: 'asset_video', projectId: 'project_test', kind: 'video', mimeType: 'video/mp4',
    storageProvider: 'local', storageKey: 'video.mp4', previewUrl: '/video.mp4', createdAt,
  },
);
const batchGroup = createExecutionResultGroup(batchSnapshot, {
  executionId: 'exec_batch',
  operationBlock: operation,
  resultBlocks: [resultOne, resultTwo],
});
assert.ok(batchGroup);
assert.equal(batchGroup.data.groupKind, 'execution_results');
assert.equal(batchGroup.data.groupExecutionId, 'exec_batch');
assert.equal(batchGroup.parentGroupId, workflowGroup.blockId);
assert.equal(resultOne.parentGroupId, batchGroup.blockId);
assert.equal(resultTwo.parentGroupId, batchGroup.blockId);
const fittedBatchPosition = { ...batchGroup.position };
const fittedBatchSize = { ...batchGroup.size };
batchGroup.size.width += 200;
const refittedBatchGroup = createExecutionResultGroup(batchSnapshot, {
  executionId: 'exec_batch',
  operationBlock: operation,
  resultBlocks: [resultOne, resultTwo],
});
assert.equal(refittedBatchGroup?.blockId, batchGroup.blockId);
assert.deepEqual(refittedBatchGroup?.position, fittedBatchPosition);
assert.deepEqual(refittedBatchGroup?.size, fittedBatchSize);
batchSnapshot.executions.push({
  executionId: 'exec_batch',
  projectId: 'project_test',
  boardId: 'board_test',
  capabilityId: 'image.text_to_image',
  adapter: 'mcp_agent',
  status: 'succeeded',
  inputBlockIds: [workflowPrompt.blockId],
  outputBlockIds: [resultOne.blockId, resultTwo.blockId],
  outputAssetIds: ['asset_result_one', 'asset_result_two'],
  params: { operationBlockId: operation.blockId },
  startedAt: createdAt,
});
assert.deepEqual(new Set(connectedWorkflowBlockIds(batchSnapshot, operation.blockId)), new Set([
  workflowPrompt.blockId,
  operation.blockId,
  batchGroup.blockId,
  resultOne.blockId,
  resultTwo.blockId,
]));
batchSnapshot.edges.push(
  { edgeId: 'edge_result_one', sourceBlockId: operation.blockId, targetBlockId: resultOne.blockId, kind: 'execution_output' },
  { edgeId: 'edge_result_two', sourceBlockId: operation.blockId, targetBlockId: resultTwo.blockId, kind: 'execution_output' },
);
const collapsedNodes = createFlowNodes(batchSnapshot, { collapsedGroupIds: [batchGroup.blockId] });
assert.equal(collapsedNodes.some((node) => node.id === resultOne.blockId), false);
assert.equal(collapsedNodes.some((node) => node.id === resultTwo.blockId), false);
assert.deepEqual(collapsedNodes.find((node) => node.id === batchGroup.blockId)?.style, { width: 260, height: 88 });
assert.equal(collapsedNodes.find((node) => node.id === batchGroup.blockId)?.data.groupMediaCount, 2);
const collapsedEdges = createFlowEdges(batchSnapshot, { collapsedGroupIds: [batchGroup.blockId] });
assert.equal(collapsedEdges.length, 1);
assert.equal(collapsedEdges[0]?.target, batchGroup.blockId);
assert.equal(collapsedEdges[0]?.selectable, false);
assert.deepEqual(collapsedEdges[0]?.data?.proxyEdgeIds, ['edge_result_one', 'edge_result_two']);
assert.deepEqual(groupMediaItems(batchSnapshot, batchGroup.blockId).map((item) => item.block.blockId), [
  resultOne.blockId,
  resultTwo.blockId,
]);
assert.deepEqual(groupMediaItems(batchSnapshot, workflowGroup.blockId).map((item) => item.block.blockId), [
  resultOne.blockId,
  resultTwo.blockId,
  workflowVideo.blockId,
]);
const resultOneBeforeGrid = { ...resultOne.position };
assert.ok(arrangeGroupChildren(batchSnapshot, workflowGroup.blockId, 'grid'));
assert.equal(workflowGroup.data.groupLayoutMode, 'grid');
assert.ok(batchGroup.position.y > operation.position.y);
assert.notDeepEqual(resultOne.position, resultOneBeforeGrid);

const unrelatedGroup = block('unrelated_group', 'group', 1200, 0, 300, 300);
const unrelatedChild = block('unrelated_child', 'image', 1240, 60);
unrelatedChild.parentGroupId = unrelatedGroup.blockId;
batchSnapshot.blocks.push(unrelatedGroup, unrelatedChild);
assert.equal(createGroupAroundBlocks(batchSnapshot, [resultOne.blockId, unrelatedChild.blockId]), undefined);
assert.equal(resultOne.parentGroupId, batchGroup.blockId);
assert.equal(unrelatedChild.parentGroupId, unrelatedGroup.blockId);

const cycleOne = block('cycle_one', 'group', 0, 0);
const cycleTwo = block('cycle_two', 'group', 0, 0);
cycleOne.parentGroupId = cycleTwo.blockId;
cycleTwo.parentGroupId = cycleOne.blockId;
const invalidSnapshot = snapshot([cycleOne, cycleTwo]);
repairGroupRelationships(invalidSnapshot);
assert.ok(!cycleOne.parentGroupId || !cycleTwo.parentGroupId);

console.log({
  batchGroup: batchGroup.blockId,
  collapsedProxyEdges: collapsedEdges.length,
  drawnGroup: drawnGroup.blockId,
  nestedDepth: 2,
  projectedNodes: flowNodes.length,
});
