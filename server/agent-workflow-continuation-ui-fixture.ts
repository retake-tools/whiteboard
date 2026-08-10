import { rm } from 'node:fs/promises';
import './studio-domain-test-fixtures';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import {
  createAgentRunForWorkflowRun,
  markAgentRunNeedsAttention,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { createWorkflowRunForGroup } from '../src/core/workflowRuntime';
import { storyToStoryboardWorkflow } from './studio-domain-test-fixtures';
import { retakeRoot } from './local-store/context';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-agent-workflow-continuation')) {
  throw new Error('Agent Workflow continuation fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { force: true, recursive: true });
const snapshot = await resetWorkspace();
snapshot.project.name = '[TEST] Agent Workflow Continuation';
snapshot.board.name = '[TEST] Agent Workflow Continuation';
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

const projection = projectWorkflowDraft(snapshot, {
  connectionIdForCapability: () => 'fixture-connection',
  labelsForSkill: (skillId) => ({
    operationTitle: skillId === 'retake.screenplay.from-brief'
      ? '更新故事剧本'
      : '继续制作',
    promptPlaceholder: '连接上一步结果',
    promptTitle: '输入',
    resultTitle: '结果',
    waitingBody: '等待执行',
  }),
  outputPlaceholder: '等待上一步完成',
  workflowId: storyToStoryboardWorkflow.workflowId,
  workflowTitle: '花店 IP 设计',
});
const brief = snapshot.blocks.find(
  (block) => block.data.workflowInputSlotId === 'brief',
);
if (!brief) throw new Error('Fixture brief is missing.');
brief.data.body = '为一家温暖的社区花店设计完整的角色和应用方案。';
const workflowRun = createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
const agentRun = createAgentRunForWorkflowRun(snapshot, workflowRun.record.workflowRunId);
startAgentRun(snapshot, agentRun.record.agentRunId);
reconcileAgentRuntime(snapshot);
markAgentRunNeedsAttention(
  snapshot,
  agentRun.record.agentRunId,
  'Operation returned without creating an Execution.',
);
const session = createAgentSession(snapshot, {
  agentRunId: agentRun.record.agentRunId,
  model: 'fixture-model',
  title: '花店 IP Agent',
}).session;
const userMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '继续完成这个设计流程。',
});
applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    kind: 'reply',
    message: '流程会在需要处理时直接告诉你下一步，不需要反复输入“继续”。',
  },
  externalThreadId: 'fixture-agent-workflow-continuation',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture-agent-workflow-continuation-turn',
  sourceMessageId: userMessage.agentMessageId,
});
await saveSnapshot(snapshot);

console.log(JSON.stringify({
  agentRunId: agentRun.record.agentRunId,
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
  workspaceDirectory,
}));
