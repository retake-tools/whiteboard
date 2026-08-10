import { rm } from 'node:fs/promises';
import { createBlockRecord } from '../src/core/blockFactory';
import { createId, nowIso } from '../src/core/id';
import { retakeRoot } from './local-store/context';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-canvas-execution-activity-v0')) {
  throw new Error('Canvas Execution Activity fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { recursive: true, force: true });
const snapshot = await resetWorkspace();
snapshot.project.name = '[TEST] Canvas Execution Activity V0';
snapshot.board.name = '[TEST] Canvas Execution Activity V0';
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.workflowRuns = [];
snapshot.workflowStepRuns = [];
snapshot.agentRuns = [];
snapshot.agentSessions = [];
snapshot.agentMessages = [];
snapshot.agentRuntimeBindings = [];
snapshot.agentRuntimeEvents = [];

const operation = createBlockRecord(snapshot, 'operation');
operation.position = { x: 180, y: 150 };
operation.data = {
  adapter: 'codex_app_server',
  body: '正在生成一张角色设定图。',
  capabilityId: 'image.generate',
  connectionId: 'codex-app-server',
  title: '生成角色设定图',
};
const result = createBlockRecord(snapshot, 'image');
result.position = { x: 580, y: 150 };
result.data = {
  body: '正在等待图片连接返回结果。',
  operationBlockId: operation.blockId,
  status: 'running',
  title: '角色设定图',
};
snapshot.blocks.push(operation, result);
snapshot.edges.push({
  edgeId: createId('edge'),
  kind: 'execution_output',
  sourceBlockId: operation.blockId,
  targetBlockId: result.blockId,
});
const executionId = createId('exec');
snapshot.executions.push({
  adapter: 'codex_app_server',
  boardId: snapshot.board.boardId,
  capabilityId: 'image.generate',
  connectionId: 'codex-app-server',
  executionId,
  inputBlockIds: [],
  outputAssetIds: [],
  outputBlockIds: [result.blockId],
  params: { operationBlockId: operation.blockId },
  projectId: snapshot.project.projectId,
  startedAt: nowIso(),
  status: 'running',
});
await saveSnapshot(snapshot);

console.log(JSON.stringify({
  boardId: snapshot.board.boardId,
  executionId,
  operationBlockId: operation.blockId,
  projectId: snapshot.project.projectId,
  workspaceDirectory,
}));
