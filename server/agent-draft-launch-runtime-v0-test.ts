import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import {
  applyWorkflowLaunchPreferences,
  decideChangeProposal,
} from '../src/core/agentChangeApplication';
import { reconcileAgentRuntime } from '../src/core/agentRuntime';
import type {
  ChangeProposalRecord,
  PackageEntrypointAgentLaunchTarget,
} from '../src/core/agentSessionContracts';
import {
  buildPackageEntrypointDraftLaunchCommand,
  stagePackageEntrypointAgentLaunch,
} from '../src/core/packageEntrypointAgentLaunchApplication';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { resetWorkspace } from './local-store/snapshot-store';
import './studio-domain-test-fixtures';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-agent-draft-launch-v0')) {
  throw new Error('Agent Draft launch tests require a disposable RETAKE_WORKSPACE_DIR.');
}

const skill = await appliedProposal({
  content: '一只快递猫要在日出前把最后一卷胶片送到影院。',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const skillCommand = launchCommand(skill.proposal, skill.sessionId, { kind: 'capability' });
const launchedSkill = stagePackageEntrypointAgentLaunch(skill.snapshot, skillCommand);
const skillRun = launchedSkill.stagedSnapshot.agentRuns?.find(
  (run) => run.agentRunId === launchedSkill.effect.agentRunId,
);
assert.equal(skillRun?.target.kind, 'capability');
assert.equal(skillRun?.status, 'running');
assert.equal(skillRun?.sourceChangeProposalId, skill.proposal.proposalId);
assert.equal(
  launchedSkill.stagedSnapshot.agentSessions?.find(
    (session) => session.agentSessionId === skill.sessionId,
  )?.activeAgentRunId,
  skillRun?.agentRunId,
);
assert.equal(launchedSkill.stagedSnapshot.executions.length, 0);
assert.equal(launchedSkill.effect.targetKind, 'capability');

const skillRetry = stagePackageEntrypointAgentLaunch(
  launchedSkill.stagedSnapshot,
  skillCommand,
);
assert.equal(skillRetry.effect.agentRunId, launchedSkill.effect.agentRunId);
assert.equal(skillRetry.stagedSnapshot.agentRuns?.length, 1);
assert.throws(
  () => stagePackageEntrypointAgentLaunch(launchedSkill.stagedSnapshot, {
    ...skillCommand,
    target: { kind: 'workflow_run' },
  }),
  /retry target conflicts|Skill Draft/,
);

const waitingSkill = await appliedProposal({
  content: 'Temporary brief.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const waitingInput = waitingSkill.snapshot.blocks.find(
  (block) => block.type === 'text' && waitingSkill.proposal.appliedEffect?.createdBlockIds.includes(block.blockId),
);
assert.ok(waitingInput);
waitingInput.data.body = '';
const launchedWaiting = stagePackageEntrypointAgentLaunch(
  waitingSkill.snapshot,
  launchCommand(waitingSkill.proposal, waitingSkill.sessionId, { kind: 'capability' }),
);
reconcileAgentRuntime(launchedWaiting.stagedSnapshot);
assert.equal(launchedWaiting.stagedSnapshot.agentRuns?.[0]?.status, 'waiting_input');
assert.equal(launchedWaiting.stagedSnapshot.executions.length, 0);

const replaceable = await appliedProposal({
  content: '先生成一个快递猫故事梗概。',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const firstReplaceableLaunch = stagePackageEntrypointAgentLaunch(
  replaceable.snapshot,
  launchCommand(replaceable.proposal, replaceable.sessionId, { kind: 'capability' }),
);
const supersededRun = firstReplaceableLaunch.stagedSnapshot.agentRuns?.find(
  (run) => run.agentRunId === firstReplaceableLaunch.effect.agentRunId,
);
assert.ok(supersededRun);
supersededRun.status = 'needs_attention';
supersededRun.stopReason = 'operation_execution_missing';
supersededRun.error = 'No executable Operation is currently ready.';
const replacement = appliedProposalOnSnapshot(
  firstReplaceableLaunch.stagedSnapshot,
  replaceable.sessionId,
  {
    content: '改为规划完整快递猫分镜流程。',
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
    interactionMode: 'manual',
  },
);
const replacementLaunch = stagePackageEntrypointAgentLaunch(
  replacement.snapshot,
  launchCommand(replacement.proposal, replacement.sessionId, { kind: 'workflow_run' }),
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentRuns?.find(
    (run) => run.agentRunId === supersededRun.agentRunId,
  )?.status,
  'canceled',
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentRuns?.find(
    (run) => run.agentRunId === supersededRun.agentRunId,
  )?.stopReason,
  'superseded_by_new_run',
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentSessions?.find(
    (session) => session.agentSessionId === replaceable.sessionId,
  )?.activeAgentRunId,
  replacementLaunch.effect.agentRunId,
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentRuns?.find(
    (run) => run.agentRunId === replacementLaunch.effect.agentRunId,
  )?.interactionMode,
  'manual',
);

const protectedActive = await appliedProposal({
  content: '正在生成快递猫故事梗概。',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const protectedLaunch = stagePackageEntrypointAgentLaunch(
  protectedActive.snapshot,
  launchCommand(protectedActive.proposal, protectedActive.sessionId, { kind: 'capability' }),
);
const blockedReplacement = appliedProposalOnSnapshot(
  protectedLaunch.stagedSnapshot,
  protectedActive.sessionId,
  {
    content: '同时启动完整分镜流程。',
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  },
);
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    blockedReplacement.snapshot,
    launchCommand(blockedReplacement.proposal, blockedReplacement.sessionId, { kind: 'workflow_run' }),
  ),
  /still executing and must be stopped/,
);
assert.equal(blockedReplacement.snapshot.agentRuns?.length, 1);

const executedSkill = await appliedProposal({
  content: 'Already executed.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
executedSkill.snapshot.executions.push({
  params: { operationBlockId: executedSkill.proposal.appliedEffect?.primaryBlockId },
} as unknown as ExecutionRecord);
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    executedSkill.snapshot,
    launchCommand(executedSkill.proposal, executedSkill.sessionId, { kind: 'capability' }),
  ),
  /already has an Execution/,
);
assert.equal(executedSkill.snapshot.agentRuns?.length, 0);

const workflowTargets: PackageEntrypointAgentLaunchTarget[] = [
  { kind: 'workflow_run' },
  { kind: 'workflow_slice', until: { kind: 'step', stepId: 'screenplay_generate' } },
  {
    kind: 'workflow_slice',
    until: { kind: 'artifact', workflowOutputSlotId: 'storyboard_plan' },
  },
  { kind: 'workflow_slice', until: { kind: 'stage', stageId: 'story_screenplay' } },
];

for (const target of workflowTargets) {
  const workflow = await appliedProposal({
    content: '一个关于快递猫守护最后一卷胶片的短片。',
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  });
  const launched = stagePackageEntrypointAgentLaunch(
    workflow.snapshot,
    launchCommand(workflow.proposal, workflow.sessionId, target),
  );
  assert.equal(launched.stagedSnapshot.workflowRuns?.length, 1);
  assert.equal(launched.stagedSnapshot.workflowStepRuns?.length, 4);
  assert.equal(launched.effect.createdWorkflowRun, true);
  assert.ok(launched.effect.workflowRunId);
  const run = launched.stagedSnapshot.agentRuns?.[0];
  assert.equal(run?.target.kind, target.kind);
  assert.equal(run?.sourceChangeProposalId, workflow.proposal.proposalId);
  assert.equal(
    launched.stagedSnapshot.workflowRuns?.[0]?.sourceChangeProposalId,
    workflow.proposal.proposalId,
  );
  if (target.kind === 'workflow_slice') {
    assert.equal(run?.target.kind, 'workflow_slice');
    assert.equal(run?.target.kind === 'workflow_slice' ? run.target.until.kind : undefined, target.until.kind);
  }
}

const archived = await appliedProposal({
  content: 'Archived Session.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const archivedSession = archived.snapshot.agentSessions?.find(
  (session) => session.agentSessionId === archived.sessionId,
);
assert.ok(archivedSession);
archivedSession.status = 'archived';
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    archived.snapshot,
    launchCommand(archived.proposal, archived.sessionId, { kind: 'capability' }),
  ),
  /Session is not active/,
);
assert.equal(archived.snapshot.agentRuns?.length, 0);

const [controllerSource, runtimeControllerSource, workspaceSource] = await Promise.all([
  readFile(new URL('../src/app/useAgentWorkspaceController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAgentRuntimeController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
]);
assert.match(
  controllerSource,
  /await persistSnapshot\(result\.stagedSnapshot, \{ requireLocalApi: true \}\);[\s\S]*publishLaunch/,
  'The staged launch must be durably saved before React publishes the running AgentRun.',
);
assert.match(controllerSource, /await loadBoardSnapshot/);
assert.match(controllerSource, /reconcileAgentArtifactTarget/);
assert.match(controllerSource, /reconcileWorkflowArtifactGates/);
assert.match(runtimeControllerSource, /markAgentRunNeedsAttention/);
assert.match(workspaceSource, /agentWorkspace\.launchAgent/);
assert.match(workspaceSource, /WorkflowAgentTargetPicker/);
assert.match(workspaceSource, /agentWorkspace\.viewRun/);

console.log(JSON.stringify({
  ok: true,
  appliedProposalDoesNotLaunch: true,
  skillCapabilityLaunch: true,
  waitingInputWithoutExecution: true,
  idleRunSupersededByExplicitLaunch: true,
  activeRunProtectedFromReplacement: true,
  executedSkillRejected: true,
  workflowFullAndTypedSlices: true,
  sessionBinding: true,
  idempotentRetry: true,
  provenance: true,
  persistBeforePublish: true,
  authoritativeSliceTargetReconcile: true,
  launchUi: true,
  providerStartFailureBounded: true,
}));

async function appliedProposal(input: {
  content: string;
  entrypointId: string;
  interactionMode?: 'automatic' | 'manual';
}): Promise<{
  proposal: ChangeProposalRecord;
  sessionId: string;
  snapshot: BoardSnapshot;
}> {
  const snapshot = await emptySnapshot();
  const session = createAgentSession(snapshot, { model: 'test-model' }).session;
  return appliedProposalOnSnapshot(snapshot, session.agentSessionId, input);
}

function appliedProposalOnSnapshot(
  snapshot: BoardSnapshot,
  sessionId: string,
  input: {
    content: string;
    entrypointId: string;
    interactionMode?: 'automatic' | 'manual';
  },
): {
  proposal: ChangeProposalRecord;
  sessionId: string;
  snapshot: BoardSnapshot;
} {
  const message = appendAgentUserMessage(snapshot, sessionId, {
    content: input.content,
    contextRefs: [{ entrypointId: input.entrypointId, kind: 'entrypoint' }],
  });
  const turn = applyAgentRuntimeTurn(snapshot, {
    agentSessionId: sessionId,
    decision: { kind: 'reply', message: 'Create a Draft.' },
    externalThreadId: 'thread_agent_launch',
    runtimeModel: 'test-model',
    runtimeTurnId: `turn_${input.entrypointId}`,
    sourceMessageId: message.agentMessageId,
  });
  assert.ok(turn.proposal);
  if (input.interactionMode) {
    applyWorkflowLaunchPreferences(turn.proposal, {
      interactionMode: input.interactionMode,
    });
  }
  const approved = decideChangeProposal(snapshot, {
    decision: 'approve',
    expectedProposalVersion: turn.proposal.recordVersion,
    proposalId: turn.proposal.proposalId,
  });
  assert.equal(approved.proposal.status, 'applied');
  return { proposal: approved.proposal, sessionId, snapshot };
}

function launchCommand(
  proposal: ChangeProposalRecord,
  agentSessionId: string,
  target: PackageEntrypointAgentLaunchTarget,
) {
  return buildPackageEntrypointDraftLaunchCommand({
    agentSessionId,
    expectedProposalVersion: proposal.recordVersion,
    proposalId: proposal.proposalId,
    target,
  });
}

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
