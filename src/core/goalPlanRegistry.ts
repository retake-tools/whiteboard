import { capabilityDefinitionFor } from './capabilityRegistry';
import type {
  AgentMessageRecord,
  GoalPlanInstantiateCommand,
} from './agentSessionContracts';
import type {
  GoalPlanCoverage,
  GoalPlanSnapshotV1,
  GoalPlanWorkflowOptionV1,
} from './goalPlanContracts';
import {
  buildPackageEntrypointInstantiationCommand,
} from './packageEntrypointDraftApplication';
import {
  listPackageEntryPoints,
  resolvePackageEntryPoint,
} from './packageRegistry';
import type { BoardSnapshot } from './types';
import { workflowDefinitionFor } from './workflowRegistry';

export function listGoalPlanWorkflowOptions(): GoalPlanWorkflowOptionV1[] {
  return listPackageEntryPoints().flatMap((registration) => {
    if (registration.entrypoint.kind !== 'workflow') return [];
    const resolution = resolvePackageEntryPoint({
      entrypointId: registration.entrypoint.entrypointId,
    });
    if (resolution.status !== 'resolved' || resolution.target.kind !== 'workflow') return [];
    const definition = workflowDefinitionFor(
      resolution.target.workflowDefinitionLock.workflowDefinitionId,
    );
    return [{
      capabilityIds: unique(definition.steps.map((step) => step.capabilityLock.capabilityId)),
      description: registration.entrypoint.description,
      entrypointId: registration.entrypoint.entrypointId,
      includesExternalActionAuthorization: definition.steps.some((step) =>
        capabilityDefinitionFor(step.capabilityLock.capabilityId).runtimeRequirements.includes(
          'explicit_external_action_authorization',
        )),
      name: registration.entrypoint.name,
      packageId: registration.packageLock.packageId,
      packageVersion: registration.packageLock.version,
      requiredInputSlotIds: [...registration.entrypoint.requiredInputSlotIds],
      skillIds: unique(definition.steps.map((step) => step.skillLock.skillId)),
      stepCount: definition.steps.length,
      workflowDefinitionId: definition.workflowId,
      workflowVersion: definition.version,
    }];
  });
}

export function buildGoalPlanInstantiationCommand(
  snapshot: BoardSnapshot,
  source: AgentMessageRecord,
  input: {
    coverage: GoalPlanCoverage;
    limitations: string[];
    proposalId: string;
    workflowEntryPointId: string;
  },
): GoalPlanInstantiateCommand {
  assertGoalSource(snapshot, source);
  const resolution = resolvePackageEntryPoint({
    entrypointId: input.workflowEntryPointId,
  });
  if (resolution.status !== 'resolved' || resolution.target.kind !== 'workflow') {
    throw new Error('Goal Plan requires one installed Workflow EntryPoint.');
  }
  const definition = workflowDefinitionFor(
    resolution.target.workflowDefinitionLock.workflowDefinitionId,
  );
  const goalPlan: GoalPlanSnapshotV1 = {
    schemaRef: 'retake.agent-goal-plan/v1',
    budget: {
      externalActionPolicy: 'explicit_user_per_action',
      maxExecutionCount: definition.steps.length,
      packageInstallCount: 0,
    },
    coverage: input.coverage,
    goal: source.content.trim(),
    goalPlanId: `goal_plan_${input.proposalId}`,
    limitations: normalizeLimitations(input.limitations),
    selectedWorkflow: {
      entrypointId: resolution.target.entrypoint.entrypointId,
      packageLock: structuredClone(resolution.target.packageLock),
      workflowDefinitionLock: structuredClone(resolution.target.workflowDefinitionLock),
    },
    sourceMessageFingerprint: goalSourceMessageFingerprint(source),
    sourceMessageId: source.agentMessageId,
    steps: definition.steps.map((step) => ({
      capabilityLock: structuredClone(step.capabilityLock),
      dependsOn: [...step.dependsOn],
      optional: step.optional,
      skillLock: structuredClone(step.skillLock),
      stageId: step.stageId,
      stepId: step.stepId,
    })),
  };
  const draftSource: AgentMessageRecord = {
    ...structuredClone(source),
    contextRefs: [
      {
        entrypointId: resolution.target.entrypoint.entrypointId,
        kind: 'entrypoint',
      },
      ...structuredClone(source.contextRefs),
    ],
  };
  let draftCommand: GoalPlanInstantiateCommand['draftCommand'];
  try {
    draftCommand = buildPackageEntrypointInstantiationCommand(
      snapshot,
      draftSource,
      input.proposalId,
    );
  } catch (error) {
    if (
      !draftSource.contextRefs.some((ref) =>
        ref.kind === 'asset'
        || ref.kind === 'block'
        || ref.kind === 'inline')
      || !(error instanceof Error)
      || error.message !== 'Package Composer instruction has no compatible input slot.'
    ) throw error;
    draftCommand = buildPackageEntrypointInstantiationCommand(
      snapshot,
      { ...draftSource, content: '' },
      input.proposalId,
    );
  }
  draftCommand.idempotencyKey = `proposal:${input.proposalId}:goal_plan.workflow_draft`;
  if (draftCommand.invocation.targetLock.entrypointKind !== 'workflow') {
    throw new Error('Goal Plan Draft command must lock one Workflow EntryPoint.');
  }
  return {
    draftCommand,
    goalPlan,
    idempotencyKey: `proposal:${input.proposalId}:goal_plan.instantiate`,
    kind: 'goal_plan.instantiate',
    schemaVersion: 1,
  };
}

export function assertCurrentGoalPlanCommand(
  snapshot: BoardSnapshot,
  source: AgentMessageRecord,
  command: GoalPlanInstantiateCommand,
): void {
  if (command.schemaVersion !== 1) {
    throw new Error('Goal Plan schema version is unsupported.');
  }
  const expected = buildGoalPlanInstantiationCommand(snapshot, source, {
    coverage: command.goalPlan.coverage,
    limitations: command.goalPlan.limitations,
    proposalId: proposalIdFromGoalPlan(command.goalPlan),
    workflowEntryPointId: command.goalPlan.selectedWorkflow.entrypointId,
  });
  if (JSON.stringify(expected) !== JSON.stringify(command)) {
    throw new Error('Goal Plan command no longer matches its source message and installed Workflow.');
  }
}

export function goalSourceMessageFingerprint(source: AgentMessageRecord): string {
  return `fnv1a:${fnv1a(JSON.stringify({
    agentMessageId: source.agentMessageId,
    content: source.content,
    contextRefs: source.contextRefs,
  }))}`;
}

function assertGoalSource(
  snapshot: BoardSnapshot,
  source: AgentMessageRecord,
): void {
  if (
    source.projectId !== snapshot.project.projectId
    || source.boardId !== snapshot.board.boardId
    || source.role !== 'user'
  ) throw new Error('Goal Plan source message is outside the current Board scope.');
  if (!source.content.trim()) throw new Error('Goal Plan requires a non-empty goal.');
  if (source.contextRefs.some((ref) => ref.kind === 'entrypoint')) {
    throw new Error('An explicit EntryPoint must use the Typed EntryPoint Proposal path.');
  }
}

function normalizeLimitations(limitations: string[]): string[] {
  const normalized = unique(limitations.map((value) => value.trim()).filter(Boolean));
  if (normalized.length > 8) throw new Error('Goal Plan supports at most 8 explicit limitations.');
  return normalized;
}

function proposalIdFromGoalPlan(goalPlan: GoalPlanSnapshotV1): string {
  const prefix = 'goal_plan_';
  if (!goalPlan.goalPlanId.startsWith(prefix) || goalPlan.goalPlanId.length === prefix.length) {
    throw new Error('Goal Plan identity is invalid.');
  }
  return goalPlan.goalPlanId.slice(prefix.length);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
