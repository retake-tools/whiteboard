import type { AgentRunRecord } from './agentRuntimeContracts';
import type { BoardSnapshot } from './types';
import {
  workflowRunExperienceFor,
  type WorkflowRunExperienceArtifactView,
  type WorkflowRunExperienceExecutionView,
  type WorkflowRunExperienceGateView,
  type WorkflowRunExperienceItemView,
  type WorkflowRunExperienceStepView,
} from './workflowRunExperience';
import type { WorkflowStepRunRecord } from './workflowRuntimeContracts';
import { tryCapabilityDefinitionFor } from './capabilityRegistry';
import { listSkills } from './skillRegistry';

export const workflowWorkspaceNodeWidth = 248;
export const workflowWorkspaceNodeHeight = 132;

export interface WorkflowWorkspaceGraphNodeView {
  artifacts: WorkflowRunExperienceArtifactView[];
  capabilityId: string;
  capabilityLabel: string;
  dependsOnStepIds: string[];
  executions: WorkflowRunExperienceExecutionView[];
  gates: WorkflowRunExperienceGateView[];
  inputSlotCount: number;
  operationBlockId: string;
  outputTypes: string[];
  outputSlotIds: string[];
  position: { x: number; y: number };
  resolvedInputCount: number;
  skillId: string;
  skillLabel: string;
  stageId?: string;
  step: WorkflowRunExperienceStepView;
}

export interface WorkflowWorkspaceGraphEdgeView {
  edgeId: string;
  sourceStepRunId: string;
  targetStepRunId: string;
}

export interface WorkflowWorkspaceGraphView {
  defaultSelectedStepRunId?: string;
  edges: WorkflowWorkspaceGraphEdgeView[];
  nodes: WorkflowWorkspaceGraphNodeView[];
  run: WorkflowRunExperienceItemView;
  runs: WorkflowRunExperienceItemView[];
}

export function workflowWorkspaceGraphFor(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  activeAgentRun?: AgentRunRecord,
): WorkflowWorkspaceGraphView | undefined {
  const experience = workflowRunExperienceFor(snapshot, activeAgentRun);
  const run = experience.runs.find(
    (candidate) => candidate.workflowRunId === workflowRunId,
  );
  if (!run) return undefined;
  const runRecord = (snapshot.workflowRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId,
  );
  if (!runRecord) return undefined;
  const stepRecordByRunId = new Map(
    (snapshot.workflowStepRuns ?? [])
      .filter((record) => record.workflowRunId === workflowRunId)
      .map((record) => [record.stepRunId, record]),
  );
  const stepRecordByStepId = new Map(
    [...stepRecordByRunId.values()].map((record) => [record.stepId, record]),
  );
  const levelByStepId = new Map<string, number>();
  for (const step of run.steps) {
    const record = stepRecordByRunId.get(step.stepRunId);
    if (record) resolveStepLevel(record, stepRecordByStepId, levelByStepId, new Set());
  }
  const rowByLevel = new Map<number, number>();
  const skillById = new Map(listSkills().map((skill) => [skill.skillId, skill]));
  const nodes = run.steps.flatMap((step): WorkflowWorkspaceGraphNodeView[] => {
    const record = stepRecordByRunId.get(step.stepRunId);
    if (!record) return [];
    const level = levelByStepId.get(step.stepId) ?? 0;
    const row = rowByLevel.get(level) ?? 0;
    rowByLevel.set(level, row + 1);
    const capability = tryCapabilityDefinitionFor(record.capabilityLock.capabilityId);
    return [{
      artifacts: run.artifacts.filter(
        (artifact) => artifact.stepRunId === step.stepRunId,
      ),
      capabilityId: record.capabilityLock.capabilityId,
      capabilityLabel: capability?.displayName ?? record.capabilityLock.capabilityId,
      dependsOnStepIds: [...record.dependsOn],
      executions: run.executions.filter(
        (execution) => execution.stepRunId === step.stepRunId,
      ),
      gates: run.gates.filter(
        (gate) => gate.operationBlockId === step.operationBlockId,
      ),
      inputSlotCount: capability?.inputSlots.length ?? record.resolvedInputBindings.length,
      operationBlockId: step.operationBlockId,
      outputTypes: record.outputSlotIds.map((outputSlotId) => {
        const artifactType = record.outputArtifactBindings.find(
          (binding) => binding.outputSlotId === outputSlotId,
        )?.artifactType;
        const output = capability?.outputSlots.find((slot) => slot.slotId === outputSlotId);
        return artifactType ?? output?.artifactType ?? output?.dataType ?? outputSlotId;
      }),
      outputSlotIds: [...record.outputSlotIds],
      position: {
        x: level * (workflowWorkspaceNodeWidth + 92),
        y: row * (workflowWorkspaceNodeHeight + 48),
      },
      resolvedInputCount: record.resolvedInputBindings.length,
      skillId: record.skillLock.skillId,
      skillLabel: skillById.get(record.skillLock.skillId)?.name ?? record.skillLock.skillId,
      ...(record.stageId ? { stageId: record.stageId } : {}),
      step,
    }];
  });
  const edges = run.steps.flatMap((step): WorkflowWorkspaceGraphEdgeView[] => {
    const target = stepRecordByRunId.get(step.stepRunId);
    if (!target) return [];
    return target.dependsOn.flatMap((sourceStepId) => {
      const source = stepRecordByStepId.get(sourceStepId);
      if (!source) return [];
      return [{
        edgeId: `${source.stepRunId}->${target.stepRunId}`,
        sourceStepRunId: source.stepRunId,
        targetStepRunId: target.stepRunId,
      }];
    });
  });
  const defaultStep = preferredStep(run.steps);
  return {
    ...(defaultStep ? {
      defaultSelectedStepRunId: defaultStep.stepRunId,
    } : {}),
    edges,
    nodes,
    run,
    runs: experience.runs,
  };
}

function resolveStepLevel(
  step: WorkflowStepRunRecord,
  stepById: Map<string, WorkflowStepRunRecord>,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  const cached = memo.get(step.stepId);
  if (cached !== undefined) return cached;
  if (visiting.has(step.stepId)) return 0;
  visiting.add(step.stepId);
  let level = 0;
  for (const dependencyId of step.dependsOn) {
    const dependency = stepById.get(dependencyId);
    if (!dependency) continue;
    level = Math.max(
      level,
      resolveStepLevel(dependency, stepById, memo, visiting) + 1,
    );
  }
  visiting.delete(step.stepId);
  memo.set(step.stepId, level);
  return level;
}

function preferredStep(
  steps: WorkflowRunExperienceStepView[],
): WorkflowRunExperienceStepView | undefined {
  return steps.find((step) => step.role === 'current')
    ?? steps.find((step) => step.role === 'next')
    ?? steps.find((step) => step.role === 'blocked')
    ?? steps[0];
}
