import {
  acceptVerifiedAgentArtifactRevision,
  acceptVerifiedAgentStageArtifactRevisions,
  reconcileAgentRuntime,
} from '../src/core/agentRuntime';
import {
  workflowArtifactTargetBinding,
  workflowStageTargetBindings,
} from '../src/core/agentWorkflowRuntime';
import type { BoardSnapshot } from '../src/core/types';
import { readProjectArtifacts } from './local-store/artifact-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { verifyWorkflowOutputArtifactFact } from './workflow-output-artifact-fact';

export interface ReconcileAgentArtifactTargetsInput {
  agentRunId?: string;
  boardId: string;
  projectId: string;
  workflowRunId?: string;
}

export async function reconcileAgentArtifactTargets(
  input: ReconcileAgentArtifactTargetsInput,
): Promise<{ snapshot: BoardSnapshot; satisfiedAgentRunIds: string[] }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const agentRuntimeStateBefore = JSON.stringify(snapshot.agentRuns ?? []);
  reconcileAgentRuntime(snapshot);
  const artifactSnapshot = await readProjectArtifacts(input.projectId);
  const candidates = (snapshot.agentRuns ?? []).filter((record) =>
    record.target.kind === 'workflow_slice'
    && (
      record.target.until.kind === 'artifact'
      || (
        record.target.until.kind === 'stage'
        && record.target.until.outputTargets.length > 0
      )
    )
    && record.status === 'running'
    && (!input.agentRunId || record.agentRunId === input.agentRunId)
    && (!input.workflowRunId || record.target.workflowRunId === input.workflowRunId),
  );
  const satisfiedAgentRunIds: string[] = [];
  for (const record of candidates) {
    if (record.target.kind !== 'workflow_slice') {
      throw new Error('Agent Run Workflow Slice target required.');
    }
    if (record.target.until.kind === 'artifact') {
      const binding = workflowArtifactTargetBinding(snapshot, record);
      if (!binding) continue;
      verifyWorkflowOutputArtifactFact(snapshot, artifactSnapshot, {
        artifactScope: record.target.until.artifactScope,
        artifactType: record.target.until.artifactType,
        outputSlotId: record.target.until.outputSlotId,
        semanticKey: record.target.until.semanticKey,
        stepRunId: record.target.until.stepRunId,
        workflowDefinitionLock: record.target.workflowDefinitionLock,
        workflowOutputSlotId: record.target.until.workflowOutputSlotId,
        workflowRunId: record.target.workflowRunId,
      }, binding);
      acceptVerifiedAgentArtifactRevision(snapshot, {
        agentRunId: record.agentRunId,
        artifactRevisionId: binding.artifactRevisionId,
        expectedAgentRunVersion: record.recordVersion,
      });
    } else if (record.target.until.kind === 'stage') {
      const bindings = workflowStageTargetBindings(snapshot, record);
      if (!bindings) continue;
      for (let index = 0; index < record.target.until.outputTargets.length; index += 1) {
        const target = record.target.until.outputTargets[index];
        const binding = bindings[index];
        if (!target || !binding) throw new Error('Agent Run Stage output target is incomplete.');
        verifyWorkflowOutputArtifactFact(snapshot, artifactSnapshot, {
          artifactScope: target.artifactScope,
          artifactType: target.artifactType,
          outputSlotId: target.outputSlotId,
          semanticKey: target.semanticKey,
          stepRunId: target.stepRunId,
          workflowDefinitionLock: record.target.workflowDefinitionLock,
          workflowOutputSlotId: target.workflowOutputSlotId,
          workflowRunId: record.target.workflowRunId,
        }, binding);
      }
      acceptVerifiedAgentStageArtifactRevisions(snapshot, {
        agentRunId: record.agentRunId,
        artifactRevisionIds: bindings.map((binding) => binding.artifactRevisionId),
        expectedAgentRunVersion: record.recordVersion,
      });
    }
    satisfiedAgentRunIds.push(record.agentRunId);
  }
  if (
    satisfiedAgentRunIds.length > 0
    || JSON.stringify(snapshot.agentRuns ?? []) !== agentRuntimeStateBefore
  ) await saveSnapshot(snapshot);
  return { snapshot, satisfiedAgentRunIds };
}
