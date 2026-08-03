import type { BlockRecord, BoardSnapshot } from './types';
import type {
  WorkflowStepOutputArtifactBinding,
  WorkflowStepRunRecord,
} from './workflowRuntimeContracts';

export interface WorkflowSelectedStepOutput {
  artifactBinding?: WorkflowStepOutputArtifactBinding;
  assetId: string;
  sourceStepRunId: string;
}

/**
 * Resolve a manual-single upstream Workflow selection without mutating the
 * projected canvas Block. Workflow edges remain stable, while executions read
 * the accepted Asset/Artifact revision as the effective input.
 */
export function workflowSelectedStepOutputForInput(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  inputSlotId: string | undefined,
): WorkflowSelectedStepOutput | undefined {
  if (!inputSlotId) return undefined;
  const targetStep = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.operationBlockId === operationBlockId,
  );
  const resolvedBinding = targetStep?.resolvedInputBindings.find(
    (candidate) => candidate.inputSlotId === inputSlotId,
  );
  if (!targetStep || resolvedBinding?.source.kind !== 'step_output') return undefined;
  const source = resolvedBinding.source;

  const sourceStep = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => (
      candidate.workflowRunId === targetStep.workflowRunId
      && candidate.stepId === source.stepId
    ),
  );
  if (
    !sourceStep
    || sourceStep.status !== 'succeeded'
    || sourceStep.freshness !== 'current'
    || sourceStep.outputAcceptancePolicy !== 'manual_single'
    || sourceStep.acceptedOutputAssetIds.length !== 1
  ) return undefined;

  const assetId = sourceStep.acceptedOutputAssetIds[0];
  if (!sourceStep.outputAssetIds.includes(assetId)) return undefined;
  const asset = snapshot.assets.find(
    (candidate) => candidate.assetId === assetId && candidate.projectId === snapshot.project.projectId,
  );
  if (!asset) return undefined;

  const artifactBinding = currentArtifactBinding(
    sourceStep,
    source.outputSlotId,
    assetId,
  );
  return {
    ...(artifactBinding ? { artifactBinding: structuredClone(artifactBinding) } : {}),
    assetId,
    sourceStepRunId: sourceStep.stepRunId,
  };
}

export function resolveWorkflowInputBlock(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  inputSlotId: string | undefined,
  block: BlockRecord,
): BlockRecord {
  const selected = workflowSelectedStepOutputForInput(
    snapshot,
    operationBlockId,
    inputSlotId,
  );
  if (!selected) return block;
  const asset = snapshot.assets.find((candidate) => candidate.assetId === selected.assetId);
  if (!asset) return block;

  const resolved = structuredClone(block);
  resolved.data.assetId = asset.assetId;
  resolved.data.previewUrl = asset.previewUrl;
  resolved.data.sourceExecutionId = asset.sourceExecutionId;
  resolved.data.reviewStatus = 'selected';
  if (selected.artifactBinding) {
    resolved.data.artifactId = selected.artifactBinding.artifactId;
    resolved.data.artifactRevisionId = selected.artifactBinding.artifactRevisionId;
    resolved.data.artifactType = selected.artifactBinding.artifactType;
  } else {
    delete resolved.data.artifactId;
    delete resolved.data.artifactRevisionId;
    delete resolved.data.artifactType;
  }
  return resolved;
}

function currentArtifactBinding(
  step: WorkflowStepRunRecord,
  outputSlotId: string,
  assetId: string,
): WorkflowStepOutputArtifactBinding | undefined {
  return step.outputArtifactBindings.find((candidate) => (
    candidate.outputSlotId === outputSlotId
    && candidate.primaryAssetId === assetId
    && candidate.assetIds.length === 1
    && candidate.assetIds[0] === assetId
  ));
}
