import { artifactIdentityKey, type ProjectArtifactSnapshot } from '../src/core/artifactContracts';
import type { BoardSnapshot } from '../src/core/types';
import type {
  WorkflowDefinitionLock,
  WorkflowStepOutputArtifactBinding,
} from '../src/core/workflowRuntimeContracts';

export interface WorkflowOutputArtifactIdentity {
  artifactScope: 'workflow_run';
  artifactType: string;
  outputSlotId: string;
  semanticKey: string;
  stepRunId: string;
  workflowDefinitionLock: WorkflowDefinitionLock;
  workflowOutputSlotId: string;
  workflowRunId: string;
}

export interface VerifiedWorkflowOutputArtifactFact {
  artifactId: string;
  artifactRevisionId: string;
  assetIds: string[];
  executionIds: string[];
}

export function verifyWorkflowOutputArtifactFact(
  snapshot: BoardSnapshot,
  artifactSnapshot: ProjectArtifactSnapshot,
  target: WorkflowOutputArtifactIdentity,
  binding: WorkflowStepOutputArtifactBinding,
): VerifiedWorkflowOutputArtifactFact {
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
    sourceContext: { workflowRunId: target.workflowRunId },
  });
  if (
    artifactIdentityKey(artifact) !== expectedIdentity
    || artifact.projectId !== snapshot.project.projectId
    || artifact.artifactType !== target.artifactType
    || artifact.scope !== 'workflow_run'
    || artifact.libraryVisibility !== 'hidden'
    || artifact.currentRevisionId !== revision.artifactRevisionId
  ) throw new Error('Workflow Artifact does not match the frozen target identity.');
  if (
    revision.artifactId !== artifact.artifactId
    || revision.projectId !== snapshot.project.projectId
    || revision.primaryAssetId !== binding.primaryAssetId
    || revision.sourceContext?.workflowRunId !== target.workflowRunId
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
    || revision.definitionLocks?.workflow?.workflowId !== target.workflowDefinitionLock.workflowId
    || revision.definitionLocks?.workflow?.version !== target.workflowDefinitionLock.version
    || revision.definitionLocks?.workflow?.definitionHash !== target.workflowDefinitionLock.definitionHash
    || revision.definitionLocks?.capability?.capabilityId !== step.capabilityLock.capabilityId
    || revision.definitionLocks?.capability?.version !== step.capabilityLock.version
    || revision.definitionLocks?.capability?.definitionHash !== step.capabilityLock.definitionHash
    || revision.definitionLocks?.skill?.skillId !== step.skillLock.skillId
    || revision.definitionLocks?.skill?.version !== step.skillLock.version
    || revision.definitionLocks?.skill?.definitionHash !== step.skillLock.definitionHash
  ) throw new Error('Workflow Artifact Revision Definition locks do not match the frozen target.');
  if (
    binding.executionIds.length === 1
    && revision.createdByExecutionId !== binding.executionIds[0]
  ) throw new Error('Workflow Artifact Revision Execution lineage does not match the StepRun binding.');
  return {
    artifactId: artifact.artifactId,
    artifactRevisionId: revision.artifactRevisionId,
    assetIds: [...binding.assetIds],
    executionIds: [...binding.executionIds],
  };
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
