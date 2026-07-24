import {
  createAgentRunForGoalPlan,
  startAgentRun,
} from './agentRuntime';
import {
  agentPresetSelectionMatchesRun,
  applyAgentPresetToRun,
  resolveAgentPresetSelection,
  type AgentPresetTargetRequirements,
} from './agentPresetApplication';
import { setAgentSessionRun } from './agentSession';
import type {
  ChangeProposalRecord,
  GoalPlanAgentLaunchEffect,
  GoalPlanDraftLaunchCommand,
} from './agentSessionContracts';
import { assertCurrentGoalPlanCommand } from './goalPlanRegistry';
import { nowIso } from './id';
import type { BlockRecord, BoardSnapshot } from './types';
import { createWorkflowRunForGroup } from './workflowRuntime';

export function buildGoalPlanDraftLaunchCommand(input: {
  agentPresetEntryPointId?: string;
  agentSessionId: string;
  expectedProposalVersion: number;
  proposalId: string;
}): GoalPlanDraftLaunchCommand {
  return {
    agentSessionId: input.agentSessionId,
    expectedProposalVersion: input.expectedProposalVersion,
    idempotencyKey: `proposal:${input.proposalId}:goal_plan_draft.launch_agent`,
    kind: 'goal_plan_draft.launch_agent',
    proposalId: input.proposalId,
    schemaVersion: 1,
    ...(input.agentPresetEntryPointId
      ? { agentPresetSelection: resolveAgentPresetSelection(input.agentPresetEntryPointId) }
      : {}),
  };
}

export function stageGoalPlanAgentLaunch(
  snapshot: BoardSnapshot,
  command: GoalPlanDraftLaunchCommand,
): { effect: GoalPlanAgentLaunchEffect; stagedSnapshot: BoardSnapshot } {
  if (command.schemaVersion !== 1) {
    throw new Error('Goal Plan Agent launch schema version is unsupported.');
  }
  const proposal = requireGoalProposal(snapshot, command.proposalId);
  if (proposal.draftLaunchEffect) {
    assertIdempotentRetry(snapshot, proposal, command);
    if (proposal.draftLaunchEffect.kind !== 'goal_plan_agent_launch') {
      throw new Error('Goal Plan launch effect kind changed.');
    }
    return {
      effect: structuredClone(proposal.draftLaunchEffect),
      stagedSnapshot: structuredClone(snapshot),
    };
  }
  if (proposal.recordVersion !== command.expectedProposalVersion) {
    throw new Error(
      `Change Proposal version conflict: expected ${command.expectedProposalVersion}, current ${proposal.recordVersion}.`,
    );
  }

  const stagedSnapshot = structuredClone(snapshot);
  const stagedProposal = requireGoalProposal(stagedSnapshot, command.proposalId);
  const session = (stagedSnapshot.agentSessions ?? []).find(
    (candidate) => candidate.agentSessionId === command.agentSessionId,
  );
  if (
    !session
    || session.status !== 'active'
    || session.projectId !== stagedSnapshot.project.projectId
    || session.boardId !== stagedSnapshot.board.boardId
    || stagedProposal.agentSessionId !== session.agentSessionId
  ) throw new Error('Goal Plan launch Session is not active in the Proposal Board.');
  if (
    stagedProposal.status !== 'applied'
    || stagedProposal.appliedEffect?.kind !== 'goal_plan_draft'
  ) throw new Error('Goal Plan launch requires an applied Goal Plan Draft.');
  const source = (stagedSnapshot.agentMessages ?? []).find(
    (message) => message.agentMessageId === stagedProposal.sourceMessageId,
  );
  if (!source) throw new Error('Goal Plan launch source message is missing.');
  assertCurrentGoalPlanCommand(stagedSnapshot, source, stagedProposal.proposedCommand);

  const group = requireGoalDraftGroup(stagedSnapshot, stagedProposal);
  assertGoalDraftLock(group, stagedProposal);
  const existingRunId = stringValue(group.data.workflowRunId);
  const workflow = createWorkflowRunForGroup(stagedSnapshot, group.blockId);
  const createdWorkflowRun = !existingRunId;
  if (createdWorkflowRun) {
    workflow.record.sourceChangeProposalId = stagedProposal.proposalId;
    workflow.record.sourceDraftLaunchIdempotencyKey = command.idempotencyKey;
  } else if (
    workflow.record.sourceChangeProposalId !== stagedProposal.proposalId
    || workflow.record.sourceDraftLaunchIdempotencyKey !== command.idempotencyKey
  ) throw new Error('Goal Plan Draft is already bound to another Workflow Run launch.');

  const created = createAgentRunForGoalPlan(stagedSnapshot, {
    goalPlanSnapshot: stagedProposal.proposedCommand.goalPlan,
    sourceChangeProposalId: stagedProposal.proposalId,
    workflowRunId: workflow.record.workflowRunId,
  });
  if (command.agentPresetSelection) {
    applyAgentPresetToRun(stagedSnapshot, {
      agentRunId: created.record.agentRunId,
      agentSessionId: session.agentSessionId,
      selection: command.agentPresetSelection,
    });
  }
  startAgentRun(stagedSnapshot, created.record.agentRunId);
  setAgentSessionRun(stagedSnapshot, session.agentSessionId, created.record.agentRunId);

  const launchedAt = nowIso();
  const effect: GoalPlanAgentLaunchEffect = {
    agentRunId: created.record.agentRunId,
    agentSessionId: session.agentSessionId,
    createdWorkflowRun,
    idempotencyKey: command.idempotencyKey,
    kind: 'goal_plan_agent_launch',
    launchedAt,
    targetKind: 'goal',
    workflowRunId: workflow.record.workflowRunId,
  };
  stagedProposal.draftLaunchEffect = effect;
  stagedProposal.updatedAt = launchedAt;
  stagedProposal.recordVersion += 1;
  return { effect, stagedSnapshot };
}

export function goalPlanDraftLaunchRequirements(
  snapshot: BoardSnapshot,
  proposalId: string,
): AgentPresetTargetRequirements {
  const proposal = requireGoalProposal(snapshot, proposalId);
  if (
    proposal.status !== 'applied'
    || proposal.appliedEffect?.kind !== 'goal_plan_draft'
  ) throw new Error('Goal Plan AgentPreset compatibility requires an applied Goal Plan Draft.');
  return {
    capabilityIds: unique(
      proposal.proposedCommand.goalPlan.steps.map((step) => step.capabilityLock.capabilityId),
    ),
    skillIds: unique(
      proposal.proposedCommand.goalPlan.steps.map((step) => step.skillLock.skillId),
    ),
  };
}

function requireGoalProposal(
  snapshot: BoardSnapshot,
  proposalId: string,
): ChangeProposalRecord & {
  proposedCommand: Extract<
    ChangeProposalRecord['proposedCommand'],
    { kind: 'goal_plan.instantiate' }
  >;
} {
  const proposal = (snapshot.changeProposals ?? []).find(
    (candidate) => candidate.proposalId === proposalId,
  );
  if (
    !proposal
    || proposal.projectId !== snapshot.project.projectId
    || proposal.boardId !== snapshot.board.boardId
    || proposal.kind !== 'plan_goal'
    || proposal.proposedCommand.kind !== 'goal_plan.instantiate'
  ) throw new Error(`Goal Plan Proposal not found: ${proposalId}`);
  return proposal as ChangeProposalRecord & {
    proposedCommand: Extract<
      ChangeProposalRecord['proposedCommand'],
      { kind: 'goal_plan.instantiate' }
    >;
  };
}

function requireGoalDraftGroup(
  snapshot: BoardSnapshot,
  proposal: ChangeProposalRecord,
): BlockRecord {
  const effect = proposal.appliedEffect;
  if (
    effect?.kind !== 'goal_plan_draft'
    || effect.primaryBlockId !== effect.workflowGroupId
    || !effect.createdBlockIds.includes(effect.workflowGroupId)
  ) throw new Error('Goal Plan Draft effect has no canonical Workflow Group.');
  const group = snapshot.blocks.find(
    (block) =>
      block.blockId === effect.workflowGroupId
      && block.boardId === snapshot.board.boardId
      && block.type === 'group',
  );
  if (!group) throw new Error(`Goal Plan Workflow Group not found: ${effect.workflowGroupId}`);
  return group;
}

function assertGoalDraftLock(
  group: BlockRecord,
  proposal: ReturnType<typeof requireGoalProposal>,
): void {
  const selected = proposal.proposedCommand.goalPlan.selectedWorkflow;
  if (
    group.data.groupKind !== 'workflow'
    || group.data.packageEntryPointId !== selected.entrypointId
    || group.data.packageId !== selected.packageLock.packageId
    || group.data.packageVersion !== selected.packageLock.version
    || group.data.packageDigest !== selected.packageLock.digest
    || group.data.workflowDefinitionId !== selected.workflowDefinitionLock.workflowDefinitionId
    || group.data.workflowDefinitionVersion !== selected.workflowDefinitionLock.version
    || group.data.workflowDefinitionHash !== selected.workflowDefinitionLock.definitionHash
  ) throw new Error('Goal Plan Workflow Draft lock has changed.');
}

function assertIdempotentRetry(
  snapshot: BoardSnapshot,
  proposal: ChangeProposalRecord,
  command: GoalPlanDraftLaunchCommand,
): void {
  const effect = proposal.draftLaunchEffect;
  if (
    effect?.kind !== 'goal_plan_agent_launch'
    || effect.idempotencyKey !== command.idempotencyKey
    || effect.agentSessionId !== command.agentSessionId
  ) throw new Error('Goal Plan launch idempotency key conflicts with another effect.');
  const run = (snapshot.agentRuns ?? []).find(
    (candidate) => candidate.agentRunId === effect.agentRunId,
  );
  if (
    !run
    || run.target.kind !== 'goal'
    || run.target.goalPlanSnapshot.goalPlanId !== (
      proposal.proposedCommand.kind === 'goal_plan.instantiate'
        ? proposal.proposedCommand.goalPlan.goalPlanId
        : undefined
    )
    || !agentPresetSelectionMatchesRun(run, command.agentPresetSelection)
  ) throw new Error('Goal Plan launch retry conflicts with the existing AgentRun.');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
