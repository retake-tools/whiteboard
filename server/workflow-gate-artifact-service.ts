import { reconcileAgentRuntime } from '../src/core/agentRuntime';
import { workflowOutputArtifactBinding } from '../src/core/agentWorkflowRuntime';
import {
  reconcileWorkflowGates,
  type WorkflowArtifactGateFact,
} from '../src/core/workflowGateRuntime';
import { reconcileWorkflowRuntime } from '../src/core/workflowRuntime';
import type { BoardSnapshot } from '../src/core/types';
import { readProjectArtifacts } from './local-store/artifact-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { verifyWorkflowOutputArtifactFact } from './workflow-output-artifact-fact';

export interface ReconcileWorkflowArtifactGatesInput {
  boardId: string;
  projectId: string;
  workflowRunId?: string;
}

export async function reconcileWorkflowArtifactGates(
  input: ReconcileWorkflowArtifactGatesInput,
): Promise<{ createdGateEvaluationIds: string[]; snapshot: BoardSnapshot }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const stateBefore = workflowGateState(snapshot);
  const existingEvaluationIds = new Set(
    (snapshot.workflowGateEvaluations ?? []).map((evaluation) => evaluation.gateEvaluationId),
  );
  reconcileWorkflowRuntime(snapshot);
  const artifactSnapshot = await readProjectArtifacts(input.projectId);
  const runs = (snapshot.workflowRuns ?? []).filter((run) =>
    (!input.workflowRunId || run.workflowRunId === input.workflowRunId)
    && run.gateDefinitionLocks.some((gate) => gate.subject.kind === 'artifact_revision'),
  );
  for (const run of runs) {
    const stepRuns = (snapshot.workflowStepRuns ?? []).filter(
      (step) => step.workflowRunId === run.workflowRunId,
    );
    const artifactFacts: WorkflowArtifactGateFact[] = [];
    for (const gate of run.gateDefinitionLocks) {
      if (gate.subject.kind !== 'artifact_revision') continue;
      const step = stepRuns.find((candidate) => candidate.stepId === gate.subject.stepId);
      if (!step) throw new Error(`Workflow Artifact Gate producer StepRun is missing: ${gate.gateId}`);
      const binding = workflowOutputArtifactBinding(snapshot, {
        artifactType: gate.subject.artifactType,
        outputSlotId: gate.subject.outputSlotId,
        stepRunId: step.stepRunId,
        workflowOutputSlotId: gate.subject.workflowOutputSlotId,
        workflowRunId: run.workflowRunId,
      });
      if (!binding) continue;
      const fact = verifyWorkflowOutputArtifactFact(snapshot, artifactSnapshot, {
        artifactScope: gate.subject.artifactScope,
        artifactType: gate.subject.artifactType,
        outputSlotId: gate.subject.outputSlotId,
        semanticKey: gate.subject.semanticKey,
        stepRunId: step.stepRunId,
        workflowDefinitionLock: run.workflowDefinitionLock,
        workflowOutputSlotId: gate.subject.workflowOutputSlotId,
        workflowRunId: run.workflowRunId,
      }, binding);
      artifactFacts.push({ gateId: gate.gateId, ...fact });
    }
    reconcileWorkflowGates(snapshot, run, stepRuns, { artifactFacts });
  }
  reconcileWorkflowRuntime(snapshot);
  reconcileAgentRuntime(snapshot);
  if (workflowGateState(snapshot) !== stateBefore) await saveSnapshot(snapshot);
  return {
    createdGateEvaluationIds: (snapshot.workflowGateEvaluations ?? [])
      .filter((evaluation) => !existingEvaluationIds.has(evaluation.gateEvaluationId))
      .map((evaluation) => evaluation.gateEvaluationId),
    snapshot,
  };
}

function workflowGateState(snapshot: BoardSnapshot): string {
  return JSON.stringify({
    agentRuns: snapshot.agentRuns ?? [],
    approvalRequests: snapshot.workflowApprovalRequests ?? [],
    gateEvaluations: snapshot.workflowGateEvaluations ?? [],
    workflowRuns: snapshot.workflowRuns ?? [],
    workflowStepRuns: snapshot.workflowStepRuns ?? [],
  });
}
