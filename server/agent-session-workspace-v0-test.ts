import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activeBoardAgentSessions,
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  ensureDefaultAgentSession,
  messagesForSession,
  proposalsForSession,
  runtimeEventsForSession,
  runtimeBindingForSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import { appendAgentRuntimeEvent, decideChangeProposal } from '../src/core/agentChangeApplication';
import { cancelAgentRun, createAgentRunForOperation, startAgentRun } from '../src/core/agentRuntime';
import { createDraftSkillOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { parseAgentRuntimeDecision } from './agent-runtime-port';

const [portSource, workspaceSource, composerSource, sharedComposerSource, controllerSource, appServerSource, apiSource, runtimeClientSource] = await Promise.all([
  readFile(new URL('./agent-runtime-port.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspaceComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAgentWorkspaceController.ts', import.meta.url), 'utf8'),
  readFile(new URL('./codex-app-server-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('./vite-local-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/core/agentRuntimeClient.ts', import.meta.url), 'utf8'),
]);

assert.match(portSource, /implements AgentRuntimePort/);
assert.match(portSource, /outputSchema: decisionSchema/);
assert.match(portSource, /publishedDecisionDelta/);
assert.match(portSource, /sandbox: 'read-only'/);
assert.match(portSource, /Do not call tools/);
assert.doesNotMatch(portSource, /saveSnapshot|createBlock|projectWorkflowDraft/);
assert.match(appServerSource, /thread\/resume/);
assert.doesNotMatch(appServerSource, /dynamicTools:/);
assert.doesNotMatch(workspaceSource, /\['chat', 'run', 'changes'\]/);
assert.doesNotMatch(workspaceSource, /agentWorkspace\.createSession/);
assert.match(workspaceSource, /AgentSessionHistoryMenu/);
assert.match(workspaceSource, /AgentRunSummaryCard/);
assert.match(composerSource, /<SkillQuickInputComposer/);
assert.match(composerSource, /mode="agent"/);
assert.doesNotMatch(composerSource, /onInvokeEntryPoint/);
assert.match(sharedComposerSource, /listPackageEntryPoints/);
assert.match(sharedComposerSource, /listPackageComposerMentionOptions/);
assert.match(controllerSource, /persistSnapshot\(withUserMessage, \{ requireLocalApi: true \}\)/);
assert.match(controllerSource, /applyAgentRuntimeTurn/);
assert.match(controllerSource, /ensureDefaultAgentSession/);
assert.match(controllerSource, /const agentSessionId = selectedSessionId \?\? ensureDefaultSession\(\)/);
assert.match(apiSource, /application\/x-ndjson/);
assert.match(runtimeClientSource, /response\.body\.getReader/);

const parserContext = {
  agentRun: {
    agentRunId: 'agent_run_parser',
    allowedActions: ['pause' as const, 'cancel' as const],
    status: 'running',
    targetKind: 'workflow_run',
  },
  availableAgentRuns: [
    { agentRunId: 'agent_run_parser', status: 'running', targetKind: 'workflow_run' },
    { agentRunId: 'agent_run_other', status: 'paused', targetKind: 'operation' },
  ],
  boardId: 'board_parser',
  history: [],
  mentions: [],
  projectId: 'project_parser',
  userMessage: 'pause',
};
assert.deepEqual(parseAgentRuntimeDecision('{"kind":"reply","message":"No state change."}', parserContext), {
  kind: 'reply',
  message: 'No state change.',
});
assert.throws(
  () => parseAgentRuntimeDecision('{"kind":"agent_run_control","message":"pause","action":"pause","agentRunId":"agent_run_foreign"}', parserContext),
  /outside the authorized scope/,
);
assert.deepEqual(parseAgentRuntimeDecision(JSON.stringify({
  kind: 'change_proposal',
  message: '需要批准后切换。',
  proposalKind: 'out_of_scope',
  proposedCommand: { kind: 'agent_session.attach_run', targetAgentRunId: 'agent_run_other' },
  summary: '切换到另一个同画板 Agent Run。',
}), parserContext), {
  kind: 'change_proposal',
  message: '需要批准后切换。',
  proposalKind: 'out_of_scope',
  proposedCommand: { kind: 'agent_session.attach_run', targetAgentRunId: 'agent_run_other' },
  summary: '切换到另一个同画板 Agent Run。',
});
assert.throws(
  () => parseAgentRuntimeDecision('{"kind":"agent_run_control","message":"resume","action":"resume","agentRunId":"agent_run_parser"}', parserContext),
  /outside the authorized scope/,
);

const snapshot = await emptySnapshot();
const defaultSession = ensureDefaultAgentSession(snapshot, {
  model: 'test-model',
  title: 'Default conversation',
});
assert.equal(defaultSession.created, true);
assert.equal(defaultSession.session.title, 'Default conversation');
const sameDefaultSession = ensureDefaultAgentSession(snapshot, {
  model: 'other-model',
  title: 'Should not replace',
});
assert.equal(sameDefaultSession.created, false);
assert.equal(sameDefaultSession.session.agentSessionId, defaultSession.session.agentSessionId);
assert.equal(activeBoardAgentSessions(snapshot).length, 1);
snapshot.agentSessions = [];
snapshot.agentRuntimeBindings = [];
const draft = createDraftSkillOperation(snapshot, {
  bodyPlaceholder: 'Brief',
  inputTitle: 'Brief',
  operationBody: 'Generate screenplay',
  operationTitle: 'Generate screenplay',
  outputPlaceholder: 'Waiting',
  outputTitle: 'Screenplay',
  skillId: 'retake.screenplay.from-brief',
  initialText: { body: 'A courier cat reaches the cinema.', inputSlotId: 'brief' },
});
const run = createAgentRunForOperation(snapshot, draft.operationBlock.blockId);
startAgentRun(snapshot, run.record.agentRunId);
const created = createAgentSession(snapshot, { agentRunId: run.record.agentRunId, model: 'test-model' });
assert.equal(created.session.projectId, snapshot.project.projectId);
assert.equal(created.session.boardId, snapshot.board.boardId);
assert.notEqual(created.session.agentSessionId, snapshot.board.boardId);
assert.equal(created.session.activeAgentRunId, run.record.agentRunId);
assert.equal(created.binding.runtimeKind, 'codex_app_server');
assert.equal(activeBoardAgentSessions(snapshot)[0]?.agentSessionId, created.session.agentSessionId);

const userMessage = appendAgentUserMessage(snapshot, created.session.agentSessionId, {
  content: '暂停当前运行',
  contextRefs: [{ kind: 'agent_run', agentRunId: run.record.agentRunId }],
});
const context = agentRuntimeTurnContext(snapshot, created.session.agentSessionId, userMessage.agentMessageId);
assert.equal(context.agentRun?.agentRunId, run.record.agentRunId);
assert.deepEqual(context.agentRun?.allowedActions, ['pause', 'cancel']);
assert.equal(context.entrypointId, undefined);
assert.equal(context.mentions.length, 0);

applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: {
    action: 'pause',
    agentRunId: run.record.agentRunId,
    kind: 'agent_run_control',
    message: '已暂停当前 Agent Run。',
  },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_001',
  sourceMessageId: userMessage.agentMessageId,
});
assert.equal(run.record.status, 'paused');
assert.equal(messagesForSession(snapshot, created.session.agentSessionId).length, 2);
assert.equal(runtimeBindingForSession(snapshot, created.session.agentSessionId)?.externalThreadId, 'thread_test_001');
cancelAgentRun(snapshot, run.record.agentRunId);
const secondDraft = createDraftSkillOperation(snapshot, {
  bodyPlaceholder: 'Brief 2',
  inputTitle: 'Brief 2',
  operationBody: 'Generate screenplay 2',
  operationTitle: 'Generate screenplay 2',
  outputPlaceholder: 'Waiting',
  outputTitle: 'Screenplay 2',
  skillId: 'retake.screenplay.from-brief',
  initialText: { body: 'A second story.', inputSlotId: 'brief' },
});
const secondRun = createAgentRunForOperation(snapshot, secondDraft.operationBlock.blockId);

const proposalRequest = appendAgentUserMessage(snapshot, created.session.agentSessionId, {
  content: '安装一个新插件并重写 Workflow 拓扑',
});
const proposalTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: {
    kind: 'change_proposal',
    message: '这个请求超出了当前 Agent Run 的权限范围。',
    proposalKind: 'install_package',
    proposedCommand: { kind: 'unsupported', reason: 'Package installation is not registered.' },
    summary: '请求安装 Package 并修改 Workflow。',
  },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_002',
  sourceMessageId: proposalRequest.agentMessageId,
});
assert.ok(proposalTurn.proposal);
assert.equal(proposalsForSession(snapshot, created.session.agentSessionId)[0]?.status, 'awaiting_decision');
assert.throws(
  () => decideChangeProposal(snapshot, {
    decision: 'approve',
    expectedProposalVersion: proposalTurn.proposal!.recordVersion,
    proposalId: proposalTurn.proposal!.proposalId,
  }),
  /no registered Application Service command/,
);
decideChangeProposal(snapshot, {
  decision: 'reject',
  expectedProposalVersion: proposalTurn.proposal!.recordVersion,
  proposalId: proposalTurn.proposal!.proposalId,
});
assert.equal(proposalTurn.proposal?.status, 'rejected');
assert.equal(snapshot.changeDecisions?.at(-1)?.decision, 'reject');

const attachRequest = appendAgentUserMessage(snapshot, created.session.agentSessionId, {
  content: '切换到另一个 Agent Run',
});
const attachTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: {
    kind: 'change_proposal',
    message: '需要先批准切换。',
    proposalKind: 'out_of_scope',
    proposedCommand: { kind: 'agent_session.attach_run', targetAgentRunId: secondRun.record.agentRunId },
    summary: '把 Session 绑定到同一 Board 的另一个 Agent Run。',
  },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_attach',
  sourceMessageId: attachRequest.agentMessageId,
});
assert.ok(attachTurn.proposal);
assert.throws(
  () => decideChangeProposal(snapshot, {
    decision: 'approve',
    expectedProposalVersion: attachTurn.proposal!.recordVersion + 1,
    proposalId: attachTurn.proposal!.proposalId,
  }),
  /version conflict/,
);
const missingTargetSnapshot = structuredClone(snapshot);
missingTargetSnapshot.agentRuns = missingTargetSnapshot.agentRuns?.filter(
  (candidate) => candidate.agentRunId !== secondRun.record.agentRunId,
);
const failedAttach = decideChangeProposal(missingTargetSnapshot, {
  decision: 'approve',
  expectedProposalVersion: attachTurn.proposal!.recordVersion,
  proposalId: attachTurn.proposal!.proposalId,
});
assert.equal(failedAttach.proposal.status, 'failed');
assert.match(failedAttach.proposal.applyError ?? '', /outside the approved Board scope/);
assert.equal(missingTargetSnapshot.changeDecisions?.at(-1)?.decision, 'approve');
const attachDecision = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: attachTurn.proposal!.recordVersion,
  proposalId: attachTurn.proposal!.proposalId,
});
assert.equal(attachDecision.proposal.status, 'applied');
assert.equal(created.session.activeAgentRunId, secondRun.record.agentRunId);

appendAgentRuntimeEvent(snapshot, {
  event: {
    agentSessionId: created.session.agentSessionId,
    kind: 'turn_started',
    occurredAt: '2026-07-23T00:00:00.000Z',
    runtimeEventId: 'agent_event_test_started',
  },
  sourceMessageId: attachRequest.agentMessageId,
});
appendAgentRuntimeEvent(snapshot, {
  event: {
    agentSessionId: created.session.agentSessionId,
    delta: '{"kind":',
    kind: 'decision_delta',
    occurredAt: '2026-07-23T00:00:01.000Z',
    runtimeEventId: 'agent_event_test_delta',
  },
  sourceMessageId: attachRequest.agentMessageId,
});
appendAgentRuntimeEvent(snapshot, {
  event: {
    agentSessionId: created.session.agentSessionId,
    delta: '{"kind":',
    kind: 'decision_delta',
    occurredAt: '2026-07-23T00:00:01.000Z',
    runtimeEventId: 'agent_event_test_delta',
  },
  sourceMessageId: attachRequest.agentMessageId,
});
assert.deepEqual(runtimeEventsForSession(snapshot, created.session.agentSessionId).map((event) => event.sequence), [1, 2]);

const secondSession = createAgentSession(snapshot, { title: 'Second session' });
assert.equal(activeBoardAgentSessions(snapshot).length, 2);
assert.throws(
  () => setAgentSessionRun(snapshot, secondSession.session.agentSessionId, 'agent_run_foreign'),
  /outside the current Board scope/,
);
assert.throws(
  () => appendAgentUserMessage(snapshot, secondSession.session.agentSessionId, {
    content: 'Use foreign block',
    contextRefs: [
      { kind: 'entrypoint', entrypointId: 'skill:retake.screenplay.from-brief' },
      { kind: 'block', blockId: 'block_foreign', slotId: 'brief' },
    ],
  }),
  /outside Session scope/,
);

await saveSnapshot(snapshot);
const stale = structuredClone(snapshot);
const replyRequest = appendAgentUserMessage(snapshot, created.session.agentSessionId, { content: '状态如何？' });
applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: { kind: 'reply', message: '当前 Agent Run 已暂停。' },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_003',
  sourceMessageId: replyRequest.agentMessageId,
});
await saveSnapshot(snapshot);
await saveSnapshot(stale);
const recovered = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
assert.equal(messagesForSession(recovered, created.session.agentSessionId).length, 8);
assert.equal(runtimeBindingForSession(recovered, created.session.agentSessionId)?.externalThreadId, 'thread_test_001');
assert.ok(proposalsForSession(recovered, created.session.agentSessionId).some((proposal) => proposal.status === 'rejected'));
assert.ok(proposalsForSession(recovered, created.session.agentSessionId).some((proposal) => proposal.status === 'applied'));
assert.equal(runtimeEventsForSession(recovered, created.session.agentSessionId).length, 2);
assert.equal(recovered.changeDecisions?.length, 2);

console.log(JSON.stringify({
  ok: true,
  boardScopedSessions: true,
  canonicalMessages: true,
  persistentRuntimeBinding: true,
  boundedRunControl: true,
  outOfScopeProposal: true,
  staleSaveProtected: true,
  noChatAsExecutionContract: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.agentRuns = [];
  snapshot.agentSessions = [];
  snapshot.agentMessages = [];
  snapshot.agentRuntimeBindings = [];
  snapshot.agentRuntimeEvents = [];
  snapshot.changeProposals = [];
  snapshot.changeDecisions = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  return snapshot;
}
