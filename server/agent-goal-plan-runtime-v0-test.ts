import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import {
  nextAgentRunExecutionAction,
  reconcileAgentRuntime,
} from '../src/core/agentRuntime';
import {
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import type { ChangeProposalRecord } from '../src/core/agentSessionContracts';
import {
  buildGoalPlanDraftLaunchCommand,
  goalPlanDraftLaunchRequirements,
  stageGoalPlanAgentLaunch,
} from '../src/core/goalPlanAgentLaunchApplication';
import { listGoalPlanWorkflowOptions } from '../src/core/goalPlanRegistry';
import type { BlockRecord, BoardSnapshot } from '../src/core/types';
import { parseAgentRuntimeDecision } from './agent-runtime-port';
import { resetWorkspace } from './local-store/snapshot-store';

const workflowEntryPointId = 'workflow:retake.workflow.story-to-storyboard';
const presetEntryPointId = 'agent:retake.agent.story-production-director';

const snapshot = await emptySnapshot();
const brief = textBlock(snapshot, 'block_goal_brief', '一只快递猫要在日出前把最后一卷胶片送到影院。');
snapshot.blocks.push(brief);
const session = createAgentSession(snapshot, { model: 'test-model' }).session;
const message = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '把这个故事推进到可审阅的故事板计划。',
  contextRefs: [{ blockId: brief.blockId, kind: 'block', slotId: 'brief' }],
});
const context = agentRuntimeTurnContext(snapshot, session.agentSessionId, message.agentMessageId);

assert.equal(listGoalPlanWorkflowOptions().length, 4);
assert.equal(context.goalPlanOptions.length, 4);
assert.equal(context.entrypointId, undefined);
assert.ok(context.goalPlanOptions.some((option) =>
  option.entrypointId === workflowEntryPointId
  && option.stepCount === 4
  && option.requiredInputSlotIds.includes('brief')));

const parsed = parseAgentRuntimeDecision(JSON.stringify({
  coverage: 'full',
  kind: 'goal_plan_proposal',
  limitations: [],
  message: '我会使用已安装的 Story to storyboard plan。',
  summary: '生成剧本、角色与场景设定，并推进到故事板计划。',
  workflowEntryPointId,
}), context);
assert.equal(parsed.kind, 'goal_plan_proposal');
assert.throws(
  () => parseAgentRuntimeDecision(JSON.stringify({
    coverage: 'full',
    kind: 'goal_plan_proposal',
    limitations: [],
    message: '使用不存在的流程。',
    summary: '越过目录。',
    workflowEntryPointId: 'workflow:missing',
  }), context),
  /outside the Goal Plan catalog/,
);

const turn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: parsed,
  externalThreadId: 'thread_goal_plan',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_goal_plan',
  sourceMessageId: message.agentMessageId,
});
assert.ok(turn.proposal);
assert.equal(turn.proposal.kind, 'plan_goal');
assert.equal(turn.proposal.proposedCommand.kind, 'goal_plan.instantiate');
assert.ok(turn.proposal.proposedCommand.kind === 'goal_plan.instantiate');
const command = turn.proposal.proposedCommand;
assert.equal(command.goalPlan.schemaRef, 'retake.agent-goal-plan/v1');
assert.equal(command.goalPlan.coverage, 'full');
assert.equal(command.goalPlan.steps.length, 4);
assert.equal(command.goalPlan.budget.maxExecutionCount, 4);
assert.equal(command.goalPlan.budget.packageInstallCount, 0);
assert.equal(command.goalPlan.budget.externalActionPolicy, 'explicit_user_per_action');
assert.equal(command.draftCommand.invocation.targetLock.entrypointKind, 'workflow');
assert.equal(command.draftCommand.invocation.mentionLocks[0]?.kind, 'block');

const beforeApproval = runtimeCounts(snapshot);
const approved = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: turn.proposal.recordVersion,
  proposalId: turn.proposal.proposalId,
});
assert.equal(approved.proposal.status, 'applied');
assert.equal(approved.proposal.appliedEffect?.kind, 'goal_plan_draft');
assert.deepEqual(runtimeCounts(snapshot), beforeApproval);
assert.ok(approved.proposal.appliedEffect?.kind === 'goal_plan_draft');
assert.equal(
  snapshot.blocks.find(
    (block) => block.blockId === approved.proposal.appliedEffect?.primaryBlockId,
  )?.data.packageEntryPointId,
  workflowEntryPointId,
);

const approvalRetryCounts = boardCounts(snapshot);
decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: turn.proposal.recordVersion,
  proposalId: turn.proposal.proposalId,
});
assert.deepEqual(boardCounts(snapshot), approvalRetryCounts);

assert.deepEqual(
  goalPlanDraftLaunchRequirements(snapshot, approved.proposal.proposalId),
  {
    capabilityIds: [
      'story.screenplay.generate',
      'design.character.define',
      'design.scene.define',
      'previs.storyboard.plan',
    ],
    skillIds: [
      'retake.screenplay.from-brief',
      'retake.character-bible.from-screenplay',
      'retake.scene-bible.from-screenplay',
      'retake.storyboard-plan.from-production-design',
    ],
  },
);
const launchCommand = buildGoalPlanDraftLaunchCommand({
  agentPresetEntryPointId: presetEntryPointId,
  agentSessionId: session.agentSessionId,
  expectedProposalVersion: approved.proposal.recordVersion,
  proposalId: approved.proposal.proposalId,
});
const launched = stageGoalPlanAgentLaunch(snapshot, launchCommand);
assert.equal(launched.effect.kind, 'goal_plan_agent_launch');
assert.equal(launched.effect.createdWorkflowRun, true);
assert.deepEqual(runtimeCounts(launched.stagedSnapshot), {
  agentRuns: 1,
  executions: 0,
  workflowRuns: 1,
  workflowStepRuns: 4,
});
const run = launched.stagedSnapshot.agentRuns?.[0];
assert.ok(run);
assert.equal(run.target.kind, 'goal');
assert.equal(run.status, 'running');
assert.equal(run.stopPolicy.kind, 'goal_plan_terminal');
assert.equal(run.sourceChangeProposalId, approved.proposal.proposalId);
assert.equal(run.scope.allowedStepRunIds.length, 4);
assert.equal(run.permissions.canCreateBlocks, false);
assert.equal(run.permissions.canInstallPackages, false);
assert.equal(run.permissions.canModifyWorkflow, false);
assert.equal(run.agentPresetSnapshot?.agentPresetId, 'retake.agent.story-production-director');
assert.equal(
  launched.stagedSnapshot.agentSessions?.find(
    (candidate) => candidate.agentSessionId === session.agentSessionId,
  )?.activeAgentRunId,
  run.agentRunId,
);
const nextAction = nextAgentRunExecutionAction(launched.stagedSnapshot);
assert.equal(nextAction?.agentRunId, run.agentRunId);
assert.ok(nextAction && run.scope.allowedOperationBlockIds.includes(nextAction.operationBlockId));

const invalidTarget = structuredClone(launched.stagedSnapshot);
const invalidRun = invalidTarget.agentRuns?.[0];
assert.ok(invalidRun?.target.kind === 'goal');
invalidRun.target.goalPlanSnapshot.steps[0]!.capabilityLock.definitionHash = 'sha256:stale';
reconcileAgentRuntime(invalidTarget);
assert.equal(invalidRun.status, 'failed');
assert.equal(invalidRun.stopReason, 'target_invalid');

const launchRetry = stageGoalPlanAgentLaunch(launched.stagedSnapshot, launchCommand);
assert.equal(launchRetry.effect.agentRunId, run.agentRunId);
assert.deepEqual(runtimeCounts(launchRetry.stagedSnapshot), runtimeCounts(launched.stagedSnapshot));

const activeMessage = appendAgentUserMessage(
  launched.stagedSnapshot,
  session.agentSessionId,
  { content: '再重新规划一个目标。' },
);
const activeContext = agentRuntimeTurnContext(
  launched.stagedSnapshot,
  session.agentSessionId,
  activeMessage.agentMessageId,
);
assert.equal(activeContext.goalPlanOptions.length, 0);
assert.throws(
  () => parseAgentRuntimeDecision(JSON.stringify({
    coverage: 'full',
    kind: 'goal_plan_proposal',
    limitations: [],
    message: '替换当前运行。',
    summary: '不允许。',
    workflowEntryPointId,
  }), activeContext),
  /cannot replace an active Agent Run/,
);

await assertSourceDriftRejected();

const [workspaceSource, controllerSource, runtimePortSource] = await Promise.all([
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAgentWorkspaceController.ts', import.meta.url), 'utf8'),
  readFile(new URL('./agent-runtime-port.ts', import.meta.url), 'utf8'),
]);
assert.match(workspaceSource, /agentWorkspace\.goalPlan/);
assert.match(workspaceSource, /goalPlanDraftLaunchRequirements/);
assert.match(workspaceSource, /goalLaunchWarning/);
assert.match(controllerSource, /stageGoalPlanAgentLaunch/);
assert.match(runtimePortSource, /goal_plan_proposal/);
assert.match(runtimePortSource, /goalPlanOptions/);

console.log(JSON.stringify({
  ok: true,
  serverWorkflowCatalog: true,
  exactGoalPlanCommand: true,
  mentionedInputPreserved: true,
  approvalCreatesDraftOnly: true,
  explicitLaunchCreatesGoalRun: true,
  fullScopeAndLockedProvenance: true,
  nextExecutionBoundedToGoalScope: true,
  tamperedGoalTargetRejected: true,
  presetCompatibility: true,
  activeRunCannotBeReplanned: true,
  sourceDriftRejected: true,
  idempotentApprovalAndLaunch: true,
  boundedPermissions: true,
  goalPlanUi: true,
}));

async function assertSourceDriftRejected(): Promise<void> {
  const value = await emptySnapshot();
  const goalSession = createAgentSession(value, { model: 'test-model' }).session;
  const source = appendAgentUserMessage(value, goalSession.agentSessionId, {
    content: '先生成故事，再推进到故事板。',
  });
  const goalTurn = applyAgentRuntimeTurn(value, {
    agentSessionId: goalSession.agentSessionId,
    decision: {
      coverage: 'full',
      kind: 'goal_plan_proposal',
      limitations: [],
      message: '创建计划。',
      summary: '选择已安装 Workflow。',
      workflowEntryPointId,
    },
    externalThreadId: 'thread_goal_plan_drift',
    runtimeModel: 'test-model',
    runtimeTurnId: 'turn_goal_plan_drift',
    sourceMessageId: source.agentMessageId,
  });
  assert.ok(goalTurn.proposal);
  source.content = '源目标已经改变。';
  const result = decideChangeProposal(value, {
    decision: 'approve',
    expectedProposalVersion: goalTurn.proposal.recordVersion,
    proposalId: goalTurn.proposal.proposalId,
  });
  assert.equal(result.proposal.status, 'failed');
  assert.match(result.proposal.applyError ?? '', /no longer matches its source message/);
  assert.deepEqual(runtimeCounts(value), {
    agentRuns: 0,
    executions: 0,
    workflowRuns: 0,
    workflowStepRuns: 0,
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

function textBlock(snapshot: BoardSnapshot, blockId: string, body: string): BlockRecord {
  return {
    blockId,
    boardId: snapshot.board.boardId,
    createdAt: '2026-07-24T00:00:00.000Z',
    data: { body, title: 'Goal Brief' },
    layerId: 'layer_default',
    position: { x: 40, y: 40 },
    size: { height: 180, width: 280 },
    type: 'text',
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
}

function runtimeCounts(value: BoardSnapshot) {
  return {
    agentRuns: value.agentRuns?.length ?? 0,
    executions: value.executions.length,
    workflowRuns: value.workflowRuns?.length ?? 0,
    workflowStepRuns: value.workflowStepRuns?.length ?? 0,
  };
}

function boardCounts(value: BoardSnapshot) {
  return {
    blocks: value.blocks.length,
    edges: value.edges.length,
    proposals: value.changeProposals?.length ?? 0,
    ...runtimeCounts(value),
  };
}
