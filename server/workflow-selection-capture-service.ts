import { listWorkflows } from '../src/core/workflowRegistry';
import { resolveWorkflowDefinitionV1 } from '../src/core/workflowAuthoringContracts';
import {
  proposeWorkflowSelectionCapture,
  type WorkflowSelectionCaptureProposalV1,
} from '../src/core/workflowSelectionCapture';
import {
  createProjectWorkflowDraftFromSelection,
  readProjectWorkflowAuthoring,
} from './local-store/workflow-authoring-store';
import { getBoardSnapshot } from './local-store/snapshot-store';

export async function workflowSelectionCaptureProposal(input: {
  blockIds: string[];
  boardId: string;
  projectId: string;
}): Promise<WorkflowSelectionCaptureProposalV1> {
  const snapshot = await getBoardSnapshot({ boardId: input.boardId, projectId: input.projectId });
  const runIds = [...new Set((snapshot.workflowStepRuns ?? [])
    .filter((step) => input.blockIds.includes(step.operationBlockId))
    .map((step) => step.workflowRunId))];
  const run = runIds.length === 1
    ? (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === runIds[0])
    : undefined;
  const authoring = await readProjectWorkflowAuthoring(input.projectId);
  const resolved = run ? resolveWorkflowDefinitionV1({
    definitionHash: run.workflowDefinitionLock.definitionHash,
    installedDefinitions: listWorkflows(),
    projectRevisions: authoring.revisions,
    version: run.workflowDefinitionLock.version,
    workflowId: run.workflowDefinitionLock.workflowId,
  }) : undefined;
  return proposeWorkflowSelectionCapture({
    blockIds: input.blockIds,
    snapshot,
    sourceDefinition: resolved?.definition,
  });
}

export async function captureWorkflowSelection(input: {
  blockIds: string[];
  boardId: string;
  expectedFingerprint: string;
  projectId: string;
}) {
  const proposal = await workflowSelectionCaptureProposal(input);
  if (proposal.fingerprint !== input.expectedFingerprint) {
    throw new Error('Workflow selection changed after preview; review it again.');
  }
  return createProjectWorkflowDraftFromSelection({ proposal });
}
