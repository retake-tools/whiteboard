import {
  createAgentRunForOperation,
  createAgentRunForWorkflowArtifactSlice,
  createAgentRunForWorkflowGateSlice,
  createAgentRunForWorkflowRun,
  createAgentRunForWorkflowSlice,
  createAgentRunForWorkflowStageSlice,
  startAgentRun,
} from './agentRuntime';
import {
  agentPresetSelectionMatchesRun,
  applyAgentPresetToRun,
  resolveAgentPresetSelection,
} from './agentPresetApplication';
import type { AgentPresetTargetRequirements } from './agentPresetApplication';
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
import { workflowDefinitionFor, type WorkflowDefinition } from './workflowRegistry';

export interface PackageEntrypointAgentLaunchResult {
  effect: PackageEntrypointAgentLaunchEffect;
  stagedSnapshot: BoardSnapshot;
}

export function buildPackageEntrypointDraftLaunchCommand(input: {
  agentPresetEntryPointId?: string;
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
    ...(input.agentPresetEntryPointId
      ? { agentPresetSelection: resolveAgentPresetSelection(input.agentPresetEntryPointId) }
      : {}),
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
    if (proposal.draftLaunchEffect.kind !== 'package_entrypoint_agent_launch') {
      throw new Error('Package EntryPoint launch effect kind changed.');
    }
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
  if (
    stagedProposal.status !== 'applied'
    || stagedProposal.appliedEffect?.kind !== 'package_entrypoint_draft'
  ) {
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
  if (command.agentPresetSelection) {
    applyAgentPresetToRun(stagedSnapshot, {
      agentRunId,
      agentSessionId: session.agentSessionId,
      selection: command.agentPresetSelection,
    });
  }
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

export function packageEntrypointDraftLaunchRequirements(
  snapshot: BoardSnapshot,
  proposalId: string,
  target: PackageEntrypointAgentLaunchTarget,
): AgentPresetTargetRequirements {
  const proposal = requireProposal(snapshot, proposalId);
  if (
    proposal.status !== 'applied'
    || !proposal.appliedEffect
    || proposal.proposedCommand.kind !== 'package_entrypoint.instantiate'
  ) throw new Error('AgentPreset compatibility requires an applied typed Draft Proposal.');
  const lock = proposal.proposedCommand.invocation.targetLock;
  if (lock.entrypointKind === 'skill') {
    if (target.kind !== 'capability') {
      throw new Error('Skill Draft AgentPreset compatibility requires a capability target.');
    }
    return {
      capabilityIds: [lock.capabilityLock.capabilityId],
      skillIds: [lock.skillLock.skillId],
    };
  }
  if (target.kind === 'capability') {
    throw new Error('Workflow Draft AgentPreset compatibility requires a Workflow target.');
  }
  const definition = workflowDefinitionFor(lock.workflowDefinitionLock.workflowDefinitionId);
  const steps = workflowTargetSteps(definition, target);
  return {
    capabilityIds: unique(steps.map((step) => step.capabilityLock.capabilityId)),
    skillIds: unique(steps.map((step) => step.skillLock.skillId)),
  };
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

function workflowTargetSteps(
  definition: WorkflowDefinition,
  target: Exclude<PackageEntrypointAgentLaunchTarget, { kind: 'capability' }>,
): WorkflowDefinition['steps'] {
  if (target.kind === 'workflow_run') return definition.steps;
  const until = target.until;
  let targetStepIds: string[];
  if (until.kind === 'step') {
    targetStepIds = [until.stepId];
  } else if (until.kind === 'artifact') {
    const output = definition.outputSlots.find(
      (candidate) => candidate.slotId === until.workflowOutputSlotId,
    );
    if (!output) throw new Error(`Workflow AgentPreset target output is missing: ${until.workflowOutputSlotId}`);
    targetStepIds = [output.source.stepId];
  } else if (until.kind === 'stage') {
    if (!definition.stages?.some((stage) => stage.stageId === until.stageId)) {
      throw new Error(`Workflow AgentPreset target Stage is missing: ${until.stageId}`);
    }
    targetStepIds = definition.steps
      .filter((step) => step.stageId === until.stageId && !step.optional)
      .map((step) => step.stepId);
  } else {
    const gate = definition.gates.find((candidate) => candidate.gateId === until.gateId);
    if (!gate) throw new Error(`Workflow AgentPreset target Gate is missing: ${until.gateId}`);
    if (gate.subject.kind === 'step_output') {
      targetStepIds = [gate.subject.stepId];
    } else {
      const workflowOutputSlotId = gate.subject.workflowOutputSlotId;
      const output = definition.outputSlots.find(
        (candidate) => candidate.slotId === workflowOutputSlotId,
      );
      if (!output) {
        throw new Error(
          `Workflow AgentPreset Gate Artifact output is missing: ${workflowOutputSlotId}`,
        );
      }
      targetStepIds = [output.source.stepId];
    }
  }
  const stepById = new Map(definition.steps.map((step) => [step.stepId, step]));
  const included = new Set<string>();
  const visiting = new Set<string>();
  function include(stepId: string): void {
    if (included.has(stepId)) return;
    if (visiting.has(stepId)) throw new Error(`Workflow AgentPreset target has a dependency cycle: ${stepId}`);
    const step = stepById.get(stepId);
    if (!step) throw new Error(`Workflow AgentPreset target Step is missing: ${stepId}`);
    visiting.add(stepId);
    for (const dependencyId of step.dependsOn) include(dependencyId);
    visiting.delete(stepId);
    included.add(stepId);
  }
  for (const stepId of targetStepIds) include(stepId);
  return definition.steps.filter((step) => included.has(step.stepId));
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
  if (!agentPresetSelectionMatchesRun(run, command.agentPresetSelection)) {
    throw new Error('Package EntryPoint Agent launch retry AgentPreset conflicts with the existing effect.');
  }
}

function launchTargetMatches(
  target: NonNullable<BoardSnapshot['agentRuns']>[number]['target'],
  expected: PackageEntrypointAgentLaunchTarget,
): boolean {
  if (target.kind === 'goal') return false;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
