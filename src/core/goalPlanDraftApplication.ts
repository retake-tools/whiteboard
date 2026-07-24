import type {
  GoalPlanDraftAppliedEffect,
  GoalPlanInstantiateCommand,
} from './agentSessionContracts';
import {
  stagePackageEntrypointDraft,
  type PackageEntrypointDraftPresentation,
} from './packageEntrypointDraftApplication';
import type { BoardSnapshot } from './types';

export function stageGoalPlanDraft(
  snapshot: BoardSnapshot,
  command: GoalPlanInstantiateCommand,
  presentation: PackageEntrypointDraftPresentation = {},
): { effect: GoalPlanDraftAppliedEffect; stagedSnapshot: BoardSnapshot } {
  const priorEffect = (snapshot.changeProposals ?? [])
    .map((proposal) => proposal.appliedEffect)
    .find((effect) => effect?.idempotencyKey === command.idempotencyKey);
  if (priorEffect) {
    if (priorEffect.kind !== 'goal_plan_draft') {
      throw new Error('Goal Plan idempotency key conflicts with another effect.');
    }
    return {
      effect: structuredClone(priorEffect),
      stagedSnapshot: structuredClone(snapshot),
    };
  }
  if (command.schemaVersion !== 1) {
    throw new Error('Goal Plan schema version is unsupported.');
  }
  if (command.draftCommand.invocation.targetLock.entrypointKind !== 'workflow') {
    throw new Error('Goal Plan can only create one installed Workflow Draft.');
  }
  const staged = stagePackageEntrypointDraft(
    snapshot,
    command.draftCommand,
    presentation,
  );
  if (
    staged.effect.entrypointKind !== 'workflow'
    || !staged.effect.workflowGroupId
    || staged.effect.primaryBlockId !== staged.effect.workflowGroupId
  ) throw new Error('Goal Plan did not create one canonical Workflow Draft.');
  return {
    effect: {
      createdBlockIds: [...staged.effect.createdBlockIds],
      goalPlanId: command.goalPlan.goalPlanId,
      idempotencyKey: command.idempotencyKey,
      kind: 'goal_plan_draft',
      primaryBlockId: staged.effect.primaryBlockId,
      workflowGroupId: staged.effect.workflowGroupId,
    },
    stagedSnapshot: staged.stagedSnapshot,
  };
}
