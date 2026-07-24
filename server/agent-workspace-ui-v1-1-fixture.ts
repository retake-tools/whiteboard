import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  messagesForSession,
  proposalsForSession,
} from '../src/core/agentSession';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import {
  createAgentRunForOperation,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { createDraftSkillOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory || workspaceDirectory === '.retake') {
  throw new Error('Agent Workspace UI fixture requires an explicit disposable RETAKE_WORKSPACE_DIR.');
}

const snapshot = await emptySnapshot();

const failedDraft = createDraftSkillOperation(snapshot, {
  bodyPlaceholder: '输入创意 Brief',
  inputTitle: '创意 Brief',
  operationBody: '生成可执行的视频剧本',
  operationTitle: '生成剧本',
  outputPlaceholder: '等待生成',
  outputTitle: '剧本',
  skillId: 'retake.screenplay.from-brief',
  initialText: {
    body: '一只橘猫必须在暴雨封城前把最后一卷胶片送进老影院。',
    inputSlotId: 'brief',
  },
});
const failedRun = createAgentRunForOperation(snapshot, failedDraft.operationBlock.blockId);
startAgentRun(snapshot, failedRun.record.agentRunId);
Object.assign(failedRun.record.permissions, { canModifyWorkflow: true });
reconcileAgentRuntime(snapshot);
assert.equal(failedRun.record.status, 'failed');

const waitingDraft = createDraftSkillOperation(snapshot, {
  bodyPlaceholder: '输入创意 Brief',
  inputTitle: '创意 Brief',
  operationBody: '生成可执行的视频剧本',
  operationTitle: '生成剧本',
  outputPlaceholder: '等待生成',
  outputTitle: '剧本',
  skillId: 'retake.screenplay.from-brief',
  initialText: { body: '', inputSlotId: 'brief' },
});
snapshot.edges = snapshot.edges.filter(
  (edge) => edge.targetBlockId !== waitingDraft.operationBlock.blockId,
);
const waitingRun = createAgentRunForOperation(snapshot, waitingDraft.operationBlock.blockId);
startAgentRun(snapshot, waitingRun.record.agentRunId);
reconcileAgentRuntime(snapshot);
assert.equal(waitingRun.record.status, 'waiting_input');

const historySession = createAgentSession(snapshot, {
  agentRunId: failedRun.record.agentRunId,
  model: 'fixture-model',
  title: '旧版：雨夜影院方向',
}).session;
const historyMessage = appendAgentUserMessage(snapshot, historySession.agentSessionId, {
  content: '保留这个方向作为历史版本。',
});
applyAgentRuntimeTurn(snapshot, {
  agentSessionId: historySession.agentSessionId,
  decision: { kind: 'reply', message: '已保留；不会修改当前画布。' },
  externalThreadId: 'fixture_history_thread',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture_history_turn',
  sourceMessageId: historyMessage.agentMessageId,
});

const primarySession = createAgentSession(snapshot, {
  agentRunId: waitingRun.record.agentRunId,
  model: 'fixture-model',
  title: '橘猫大侠 · 故事开发',
}).session;
const longMessage = appendAgentUserMessage(snapshot, primarySession.agentSessionId, {
  content: [
    '请先梳理这个故事的核心冲突，并保持以下边界：',
    '1. 不安装新的 Package；',
    '2. 不调用外部 Provider；',
    '3. 角色动机必须从现有 Brief 中得出；',
    '4. 如果需要改变已锁定的 Workflow，只能生成可审阅的 Change Proposal。',
    '',
    '我希望侧栏能够真实展示长内容、等待输入状态，以及需要人工决定的变更。',
  ].join('\n'),
  contextRefs: [{ kind: 'agent_run', agentRunId: waitingRun.record.agentRunId }],
});
applyAgentRuntimeTurn(snapshot, {
  agentSessionId: primarySession.agentSessionId,
  decision: {
    kind: 'reply',
    message: '当前 Run 正在等待 Brief 输入。我会保留现有范围，不调用 Provider；任何越界修改都会先形成 Change Proposal。',
  },
  externalThreadId: 'fixture_primary_thread',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture_primary_turn_001',
  sourceMessageId: longMessage.agentMessageId,
});

const pendingRequest = appendAgentUserMessage(snapshot, primarySession.agentSessionId, {
  content: '安装一个外部 Package，并替换当前 Workflow。',
});
const pendingTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: primarySession.agentSessionId,
  decision: {
    kind: 'change_proposal',
    message: '该请求超出当前 Run 的授权范围，需要人工审阅。',
    proposalKind: 'install_package',
    proposedCommand: {
      kind: 'unsupported',
      reason: 'Package installation is outside Agent Workspace V1.1.',
    },
    summary: '安装外部 Package，并替换当前 Workflow。',
  },
  externalThreadId: 'fixture_primary_thread',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture_primary_turn_002',
  sourceMessageId: pendingRequest.agentMessageId,
});
assert.equal(pendingTurn.proposal?.status, 'awaiting_decision');

const failedRequest = appendAgentUserMessage(snapshot, primarySession.agentSessionId, {
  content: '切换到已经失效的旧 Run。',
});
const failedTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: primarySession.agentSessionId,
  decision: {
    kind: 'change_proposal',
    message: '切换 Run 需要人工批准。',
    proposalKind: 'out_of_scope',
    proposedCommand: {
      kind: 'agent_session.attach_run',
      targetAgentRunId: failedRun.record.agentRunId,
    },
    summary: '把当前会话切换到旧的 Agent Run。',
  },
  externalThreadId: 'fixture_primary_thread',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture_primary_turn_003',
  sourceMessageId: failedRequest.agentMessageId,
});
assert.ok(failedTurn.proposal);
snapshot.agentRuns = snapshot.agentRuns?.filter(
  (record) => record.agentRunId !== failedRun.record.agentRunId,
);
const failedDecision = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: failedTurn.proposal.recordVersion,
  proposalId: failedTurn.proposal.proposalId,
});
assert.equal(failedDecision.proposal.status, 'failed');
snapshot.agentRuns = [...(snapshot.agentRuns ?? []), failedRun.record];

historySession.updatedAt = '2026-07-23T09:00:00.000Z';
primarySession.updatedAt = '2026-07-24T09:00:00.000Z';
await saveSnapshot(snapshot);

assert.equal(snapshot.executions.length, 0);
assert.equal(messagesForSession(snapshot, primarySession.agentSessionId).length, 6);
assert.deepEqual(
  proposalsForSession(snapshot, primarySession.agentSessionId)
    .map((proposal) => proposal.status)
    .sort(),
  ['awaiting_decision', 'failed'],
);

const [workspaceSource, composerSource, historySource, appSource, topBarSource] = await Promise.all([
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentSessionHistoryMenu.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/TopBar.tsx', import.meta.url), 'utf8'),
]);
assert.match(workspaceSource, /role="log"/);
assert.match(workspaceSource, /aria-relevant="additions text"/);
assert.match(workspaceSource, /role="status"/);
assert.match(workspaceSource, /trapNarrowWorkspaceFocus/);
assert.match(workspaceSource, /proposalStatusKey/);
assert.match(composerSource, /autoFocus=\{autoFocus\}/);
assert.match(composerSource, /skillComposer\.keyboardHint/);
assert.match(historySource, /triggerRef\.current\?\.focus/);
assert.match(appSource, /agentWorkspaceButtonRef\.current\?\.focus/);
assert.match(
  topBarSource,
  /<TooltipIconButton\s+buttonRef=\{agentWorkspaceButtonRef\}[\s\S]{0,180}label=\{t\('agentWorkspace\.open'\)\}/,
);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  primarySessionId: primarySession.agentSessionId,
  runStatuses: snapshot.agentRuns?.map((run) => run.status),
  proposalStatuses: proposalsForSession(snapshot, primarySession.agentSessionId).map(
    (proposal) => proposal.status,
  ),
  providerExecutions: snapshot.executions.length,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const value = await resetWorkspace();
  value.blocks = [];
  value.edges = [];
  value.assets = [];
  value.executions = [];
  value.agentRuns = [];
  value.agentSessions = [];
  value.agentMessages = [];
  value.agentRuntimeBindings = [];
  value.agentRuntimeEvents = [];
  value.changeProposals = [];
  value.changeDecisions = [];
  value.workflowRuns = [];
  value.workflowStepRuns = [];
  value.historyEvents = [];
  return value;
}
