import {
  createAgentRunForOperation,
  createAgentRunForWorkflowArtifactSlice,
  createAgentRunForWorkflowGateSlice,
  createAgentRunForWorkflowRun,
  createAgentRunForWorkflowSlice,
  createAgentRunForWorkflowStageSlice,
  startAgentRun,
} from './agentRuntime';
import { setAgentSessionRun } from './agentSession';
import type {
  ChangeProposalRecord,
  PackageEntrypointAgentLaunchEffect,
  PackageEntrypointAgentLaunchTarget,
  PackageEntrypointDraftLaunchCommand,
  PackageEntryPointInvocationLock,
} from './agentSessionContracts';
import { nowIso } from './id';
import { resolvePackageEntryPoint } from './packageRegistry';
import type { BlockRecord, BoardSnapshot } from './types';
import {
  createWorkflowRunForGroup,
  workflowRunViewForId,
} from './workflowRuntime';

export interface PackageEntrypointAgentLaunchResult {
  effect: PackageEntrypointAgentLaunchEffect;
  stagedSnapshot: BoardSnapshot;
}

export function buildPackageEntrypointDraftLaunchCommand(input: {
  agentSessionId: string;
  expectedProposalVersion: number;
  proposalId: string;
  target: PackageEntrypointAgentLaunchTarget;
}): PackageEntrypointDraftLaunchCommand {
  return {
    agentSessionId: input.agentSessionId,
    expectedProposalVersion: input.expectedProposalVersion,
    idempotencyKey: `proposal:${input.proposalId}:package_entrypoint_draft.launch_agent`,
    kind: 'package_entrypoint_draft.launch_agent',
    proposalId: input.proposalId,
    schemaVersion: 1,
    target: structuredClone(input.target),
  };
}

export function stagePackageEntrypointAgentLaunch(
  snapshot: BoardSnapshot,
  command: PackageEntrypointDraftLaunchCommand,
): PackageEntrypointAgentLaunchResult {
  if (command.schemaVersion !== 1) {
    throw new Error('Package EntryPoint Agent launch schema version is unsupported.');
  }
  const proposal = requireProposal(snapshot, command.proposalId);
  if (proposal.draftLaunchEffect) {
    assertIdempotentRetry(snapshot, proposal, command);
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
  const stagedProposal = requireProposal(stagedSnapshot, command.proposalId);
  const session = (stagedSnapshot.agentSessions ?? []).find(
    (candidate) => candidate.agentSessionId === command.agentSessionId,
  );
  if (
    !session
    || session.status !== 'active'
    || session.projectId !== stagedSnapshot.project.projectId
    || session.boardId !== stagedSnapshot.board.boardId
    || stagedProposal.agentSessionId !== session.agentSessionId
  ) throw new Error('Package EntryPoint Agent launch Session is not active in the Proposal Board.');
  if (stagedProposal.status !== 'applied' || !stagedProposal.appliedEffect) {
    throw new Error('Package EntryPoint Agent launch requires an applied Draft Proposal.');
  }
  if (
    stagedProposal.projectId !== stagedSnapshot.project.projectId
    || stagedProposal.boardId !== stagedSnapshot.board.boardId
  ) throw new Error('Package EntryPoint Agent launch Proposal is outside the current Board scope.');
  if (stagedProposal.proposedCommand.kind !== 'package_entrypoint.instantiate') {
    throw new Error('Package EntryPoint Agent launch Proposal has no typed EntryPoint command.');
  }
  assertCurrentInvocationLock(stagedProposal.proposedCommand.invocation.targetLock);

  const effect = stagedProposal.appliedEffect;
  if (effect.idempotencyKey !== stagedProposal.proposedCommand.idempotencyKey) {
    throw new Error('Package EntryPoint Agent launch Draft effect provenance is invalid.');
  }

  let agentRunId: string;
  let workflowRunId: string | undefined;
  let createdWorkflowRun: boolean | undefined;
  if (effect.entrypointKind === 'skill') {
    if (command.target.kind !== 'capability') {
      throw new Error('Skill Draft can only launch a capability AgentRun.');
    }
    const operation = requireDraftBlock(stagedSnapshot, stagedProposal, effect.primaryBlockId, 'operation');
    assertSkillDraft(stagedProposal.proposedCommand.invocation.targetLock, operation);
    if (stagedSnapshot.executions.some(
      (execution) => execution.params?.operationBlockId === operation.blockId,
    )) throw new Error('Skill Draft already has an Execution and cannot launch a new AgentRun.');
    const created = createAgentRunForOperation(stagedSnapshot, operation.blockId);
    agentRunId = created.record.agentRunId;
  } else {
    if (command.target.kind === 'capability') {
      throw new Error('Workflow Draft requires a Workflow AgentRun target.');
    }
    const groupId = effect.workflowGroupId;
    if (!groupId || groupId !== effect.primaryBlockId) {
      throw new Error('Workflow Draft effect has no canonical Workflow Group.');
    }
    const group = requireDraftBlock(stagedSnapshot, stagedProposal, groupId, 'group');
    assertWorkflowDraft(stagedProposal.proposedCommand.invocation.targetLock, group);
    const existingRunId = stringValue(group.data.workflowRunId);
    const workflow = createWorkflowRunForGroup(stagedSnapshot, groupId);
    workflowRunId = workflow.record.workflowRunId;
    createdWorkflowRun = !existingRunId;
    if (createdWorkflowRun) {
      workflow.record.sourceChangeProposalId = stagedProposal.proposalId;
      workflow.record.sourceDraftLaunchIdempotencyKey = command.idempotencyKey;
    }
    agentRunId = createWorkflowAgentRun(
      stagedSnapshot,
      workflowRunId,
      command.target,
    );
  }

  const agentRun = (stagedSnapshot.agentRuns ?? []).find(
    (candidate) => candidate.agentRunId === agentRunId,
  );
  if (!agentRun) throw new Error(`Package EntryPoint AgentRun was not created: ${agentRunId}`);
  agentRun.sourceChangeProposalId = stagedProposal.proposalId;
  agentRun.sourceDraftLaunchIdempotencyKey = command.idempotencyKey;
  startAgentRun(stagedSnapshot, agentRunId);
  setAgentSessionRun(stagedSnapshot, session.agentSessionId, agentRunId);

  const launchedAt = nowIso();
  const launchEffect: PackageEntrypointAgentLaunchEffect = {
    agentRunId,
    agentSessionId: session.agentSessionId,
    ...(createdWorkflowRun !== undefined ? { createdWorkflowRun } : {}),
    idempotencyKey: command.idempotencyKey,
    kind: 'package_entrypoint_agent_launch',
    launchedAt,
    targetKind: command.target.kind,
    ...(workflowRunId ? { workflowRunId } : {}),
  };
  stagedProposal.draftLaunchEffect = launchEffect;
  stagedProposal.updatedAt = launchedAt;
  stagedProposal.recordVersion += 1;
  return { effect: launchEffect, stagedSnapshot };
}

function createWorkflowAgentRun(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  target: Exclude<PackageEntrypointAgentLaunchTarget, { kind: 'capability' }>,
): string {
  if (target.kind === 'workflow_run') {
    return createAgentRunForWorkflowRun(snapshot, workflowRunId).record.agentRunId;
  }
  const until = target.until;
  if (until.kind === 'artifact') {
    return createAgentRunForWorkflowArtifactSlice(
      snapshot,
      workflowRunId,
      until.workflowOutputSlotId,
    ).record.agentRunId;
  }
  if (until.kind === 'stage') {
    return createAgentRunForWorkflowStageSlice(
      snapshot,
      workflowRunId,
      until.stageId,
    ).record.agentRunId;
  }
  if (until.kind === 'gate') {
    return createAgentRunForWorkflowGateSlice(
      snapshot,
      workflowRunId,
      until.gateId,
      until.completion,
    ).record.agentRunId;
  }
  const workflow = workflowRunViewForId(snapshot, workflowRunId);
  const step = workflow?.steps.find((candidate) => candidate.record.stepId === until.stepId);
  if (!step) throw new Error(`Workflow launch target Step is not locked in the Run: ${until.stepId}`);
  return createAgentRunForWorkflowSlice(
    snapshot,
    workflowRunId,
    step.record.stepRunId,
  ).record.agentRunId;
}

function requireProposal(snapshot: BoardSnapshot, proposalId: string): ChangeProposalRecord {
  const proposal = (snapshot.changeProposals ?? []).find(
    (candidate) => candidate.proposalId === proposalId,
  );
  if (!proposal) throw new Error(`Change Proposal not found: ${proposalId}`);
  return proposal;
}

function requireDraftBlock(
  snapshot: BoardSnapshot,
  proposal: ChangeProposalRecord,
  blockId: string,
  blockType: 'group' | 'operation',
): BlockRecord {
  if (!proposal.appliedEffect?.createdBlockIds.includes(blockId)) {
    throw new Error(`Package EntryPoint Agent launch target is outside the Draft effect: ${blockId}`);
  }
  const block = snapshot.blocks.find(
    (candidate) =>
      candidate.blockId === blockId
      && candidate.boardId === snapshot.board.boardId
      && candidate.type === blockType,
  );
  if (!block) throw new Error(`Package EntryPoint Agent launch Draft ${blockType} not found: ${blockId}`);
  return block;
}

function assertSkillDraft(lock: PackageEntryPointInvocationLock, operation: BlockRecord): void {
  if (lock.entrypointKind !== 'skill') {
    throw new Error('Package EntryPoint Agent launch Draft kind does not match its command.');
  }
  if (
    operation.data.packageEntryPointId !== lock.entrypointId
    || operation.data.packageId !== lock.packageLock.packageId
    || operation.data.packageVersion !== lock.packageLock.version
    || operation.data.packageDigest !== lock.packageLock.digest
    || operation.data.capabilityId !== lock.capabilityLock.capabilityId
    || operation.data.skillId !== lock.skillLock.skillId
  ) throw new Error('Package EntryPoint Agent launch Skill Draft lock has changed.');
}

function assertWorkflowDraft(lock: PackageEntryPointInvocationLock, group: BlockRecord): void {
  if (lock.entrypointKind !== 'workflow') {
    throw new Error('Package EntryPoint Agent launch Draft kind does not match its command.');
  }
  if (
    group.data.groupKind !== 'workflow'
    || group.data.packageEntryPointId !== lock.entrypointId
    || group.data.packageId !== lock.packageLock.packageId
    || group.data.packageVersion !== lock.packageLock.version
    || group.data.packageDigest !== lock.packageLock.digest
    || group.data.workflowDefinitionId !== lock.workflowDefinitionLock.workflowDefinitionId
    || group.data.workflowDefinitionVersion !== lock.workflowDefinitionLock.version
    || group.data.workflowDefinitionHash !== lock.workflowDefinitionLock.definitionHash
  ) throw new Error('Package EntryPoint Agent launch Workflow Draft lock has changed.');
}

function assertCurrentInvocationLock(lock: PackageEntryPointInvocationLock): void {
  const resolution = resolvePackageEntryPoint({ entrypointId: lock.entrypointId });
  if (resolution.status !== 'resolved') {
    throw new Error('Package EntryPoint Agent launch EntryPoint is no longer installed.');
  }
  const current = resolution.target.kind === 'skill'
    ? {
        capabilityLock: resolution.target.capabilityLock,
        entrypointId: resolution.target.entrypoint.entrypointId,
        entrypointKind: resolution.target.kind,
        packageLock: resolution.target.packageLock,
        skillLock: resolution.target.skillLock,
      }
    : {
        entrypointId: resolution.target.entrypoint.entrypointId,
        entrypointKind: resolution.target.kind,
        packageLock: resolution.target.packageLock,
        workflowDefinitionLock: resolution.target.workflowDefinitionLock,
      };
  if (JSON.stringify(current) !== JSON.stringify(lock)) {
    throw new Error('Package EntryPoint Agent launch Registry lock has changed.');
  }
}

function assertIdempotentRetry(
  snapshot: BoardSnapshot,
  proposal: ChangeProposalRecord,
  command: PackageEntrypointDraftLaunchCommand,
): void {
  const effect = proposal.draftLaunchEffect!;
  if (
    effect.idempotencyKey !== command.idempotencyKey
    || effect.agentSessionId !== command.agentSessionId
  ) throw new Error('Package EntryPoint Agent launch idempotency key conflicts with another effect.');
  const run = (snapshot.agentRuns ?? []).find(
    (candidate) => candidate.agentRunId === effect.agentRunId,
  );
  if (!run || !launchTargetMatches(run.target, command.target)) {
    throw new Error('Package EntryPoint Agent launch retry target conflicts with the existing effect.');
  }
}

function launchTargetMatches(
  target: NonNullable<BoardSnapshot['agentRuns']>[number]['target'],
  expected: PackageEntrypointAgentLaunchTarget,
): boolean {
  if (target.kind === 'capability') return expected.kind === 'capability';
  if (target.kind === 'workflow_run') return expected.kind === 'workflow_run';
  if (expected.kind !== 'workflow_slice') return false;
  const actualUntil = target.until;
  const expectedUntil = expected.until;
  if (actualUntil.kind !== expectedUntil.kind) return false;
  if (actualUntil.kind === 'step' && expectedUntil.kind === 'step') {
    return actualUntil.stepId === expectedUntil.stepId;
  }
  if (actualUntil.kind === 'artifact' && expectedUntil.kind === 'artifact') {
    return actualUntil.workflowOutputSlotId === expectedUntil.workflowOutputSlotId;
  }
  if (actualUntil.kind === 'stage' && expectedUntil.kind === 'stage') {
    return actualUntil.stageId === expectedUntil.stageId;
  }
  return actualUntil.kind === 'gate'
    && expectedUntil.kind === 'gate'
    && actualUntil.gateDefinitionLock.gateId === expectedUntil.gateId
    && actualUntil.completion === expectedUntil.completion;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
