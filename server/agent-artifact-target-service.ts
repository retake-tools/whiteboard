import {
  acceptVerifiedAgentArtifactRevision,
  reconcileAgentRuntime,
} from '../src/core/agentRuntime';
import type { AgentRunRecord } from '../src/core/agentRuntimeContracts';
import { artifactIdentityKey } from '../src/core/artifactContracts';
import { workflowArtifactTargetBinding } from '../src/core/agentWorkflowRuntime';
import type { BoardSnapshot } from '../src/core/types';
import type { WorkflowStepOutputArtifactBinding } from '../src/core/workflowRuntimeContracts';
import { readProjectArtifacts } from './local-store/artifact-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';

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
    && record.target.until.kind === 'artifact'
    && record.status === 'running'
    && (!input.agentRunId || record.agentRunId === input.agentRunId)
    && (!input.workflowRunId || record.target.workflowRunId === input.workflowRunId),
  );
  const satisfiedAgentRunIds: string[] = [];
  for (const record of candidates) {
    const binding = workflowArtifactTargetBinding(snapshot, record);
    if (!binding) continue;
    assertAuthoritativeArtifactFact(snapshot, artifactSnapshot, record, binding);
    acceptVerifiedAgentArtifactRevision(snapshot, {
      agentRunId: record.agentRunId,
      artifactRevisionId: binding.artifactRevisionId,
      expectedAgentRunVersion: record.recordVersion,
    });
    satisfiedAgentRunIds.push(record.agentRunId);
  }
  if (
    satisfiedAgentRunIds.length > 0
    || JSON.stringify(snapshot.agentRuns ?? []) !== agentRuntimeStateBefore
  ) await saveSnapshot(snapshot);
  return { snapshot, satisfiedAgentRunIds };
}

function assertAuthoritativeArtifactFact(
  snapshot: BoardSnapshot,
  artifactSnapshot: Awaited<ReturnType<typeof readProjectArtifacts>>,
  record: AgentRunRecord,
  binding: WorkflowStepOutputArtifactBinding,
): void {
  if (
    record.target.kind !== 'workflow_slice'
    || record.target.until.kind !== 'artifact'
  ) throw new Error('Agent Run Artifact Slice target required.');
  const target = record.target.until;
  const artifact = artifactSnapshot.artifacts.find(
    (candidate) => candidate.artifactId === binding.artifactId,
  );
  const revision = artifactSnapshot.revisions.find(
    (candidate) => candidate.artifactRevisionId === binding.artifactRevisionId,
  );
  if (!artifact || !revision) {
    throw new Error('Workflow Artifact binding references a missing authoritative Artifact Revision.');
  }
  const expectedIdentity = artifactIdentityKey({
    scope: target.artifactScope,
    semanticKey: target.semanticKey,
    sourceContext: { workflowRunId: record.target.workflowRunId },
  });
  if (
    artifactIdentityKey(artifact) !== expectedIdentity
    || artifact.projectId !== snapshot.project.projectId
    || artifact.artifactType !== target.artifactType
    || artifact.scope !== 'workflow_run'
    || artifact.libraryVisibility !== 'hidden'
    || artifact.currentRevisionId !== revision.artifactRevisionId
  ) throw new Error('Workflow Artifact does not match the frozen Agent target identity.');
  if (
    revision.artifactId !== artifact.artifactId
    || revision.projectId !== snapshot.project.projectId
    || revision.primaryAssetId !== binding.primaryAssetId
    || revision.sourceContext?.workflowRunId !== record.target.workflowRunId
    || revision.sourceContext?.stepRunId !== target.stepRunId
    || revision.sourceContext?.outputSlotId !== target.outputSlotId
    || revision.sourceContext?.workflowOutputSlotId !== target.workflowOutputSlotId
    || !arraysEqual(revision.assetIds, binding.assetIds)
  ) throw new Error('Workflow Artifact Revision does not match the current StepRun binding.');
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.stepRunId === target.stepRunId,
  );
  if (
    !step
    || revision.definitionLocks?.workflow?.workflowId !== record.target.workflowDefinitionLock.workflowId
    || revision.definitionLocks?.workflow?.version !== record.target.workflowDefinitionLock.version
    || revision.definitionLocks?.workflow?.definitionHash !== record.target.workflowDefinitionLock.definitionHash
    || revision.definitionLocks?.capability?.capabilityId !== step.capabilityLock.capabilityId
    || revision.definitionLocks?.capability?.version !== step.capabilityLock.version
    || revision.definitionLocks?.capability?.definitionHash !== step.capabilityLock.definitionHash
    || revision.definitionLocks?.skill?.skillId !== step.skillLock.skillId
    || revision.definitionLocks?.skill?.version !== step.skillLock.version
    || revision.definitionLocks?.skill?.definitionHash !== step.skillLock.definitionHash
  ) throw new Error('Workflow Artifact Revision Definition locks do not match the Agent target.');
  if (
    binding.executionIds.length === 1
    && revision.createdByExecutionId !== binding.executionIds[0]
  ) throw new Error('Workflow Artifact Revision Execution lineage does not match the StepRun binding.');
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
