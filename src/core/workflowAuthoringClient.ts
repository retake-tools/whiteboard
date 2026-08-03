import type { WorkflowDefinition } from './workflowRegistry';
import type {
  ProjectWorkflowAuthoringSnapshotV1,
  ProjectWorkflowDraftV1,
  ProjectWorkflowRevisionV1,
  WorkflowProjectionTemplateV1,
} from './workflowAuthoringContracts';
import type { WorkflowSelectionCaptureProposalV1 } from './workflowSelectionCapture';

export async function loadProjectWorkflowAuthoring(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectWorkflowAuthoringSnapshotV1> {
  return readResponse(await fetch(
    `/api/local/workflow-authoring?projectId=${encodeURIComponent(projectId)}`,
    { signal },
  ));
}

export async function forkInstalledWorkflow(input: {
  projectId: string;
  workflowId: string;
}): Promise<{
  draft: ProjectWorkflowDraftV1;
  snapshot: ProjectWorkflowAuthoringSnapshotV1;
}> {
  return readResponse(await fetch('/api/local/workflow-authoring/drafts/fork', {
    body: JSON.stringify({
      projectId: input.projectId,
      source: { kind: 'installed', workflowId: input.workflowId },
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));
}

export async function forkProjectWorkflowRevision(input: {
  projectId: string;
  revisionId: string;
}): Promise<{
  draft: ProjectWorkflowDraftV1;
  snapshot: ProjectWorkflowAuthoringSnapshotV1;
}> {
  return readResponse(await fetch('/api/local/workflow-authoring/drafts/fork', {
    body: JSON.stringify({
      projectId: input.projectId,
      source: { kind: 'project_revision', revisionId: input.revisionId },
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));
}

export async function previewWorkflowSelectionCapture(input: {
  blockIds: string[];
  boardId: string;
  projectId: string;
}): Promise<WorkflowSelectionCaptureProposalV1> {
  return readResponse(await fetch('/api/local/workflow-authoring/capture/proposal', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));
}

export async function confirmWorkflowSelectionCapture(input: {
  blockIds: string[];
  boardId: string;
  expectedFingerprint: string;
  projectId: string;
}): Promise<{
  draft: ProjectWorkflowDraftV1;
  snapshot: ProjectWorkflowAuthoringSnapshotV1;
}> {
  return readResponse(await fetch('/api/local/workflow-authoring/capture', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));
}

export async function saveWorkflowAuthoringDraft(input: {
  definition: WorkflowDefinition;
  draftId: string;
  expectedRecordVersion: number;
  projectId: string;
  projectionTemplate: WorkflowProjectionTemplateV1;
}): Promise<{
  draft: ProjectWorkflowDraftV1;
  snapshot: ProjectWorkflowAuthoringSnapshotV1;
}> {
  return readResponse(await fetch(
    `/api/local/workflow-authoring/drafts/${encodeURIComponent(input.draftId)}`,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    },
  ));
}

export async function publishWorkflowAuthoringDraft(input: {
  draftId: string;
  expectedRecordVersion: number;
  projectId: string;
}): Promise<{
  draft: ProjectWorkflowDraftV1;
  revision: ProjectWorkflowRevisionV1;
  snapshot: ProjectWorkflowAuthoringSnapshotV1;
}> {
  return readResponse(await fetch(
    `/api/local/workflow-authoring/drafts/${encodeURIComponent(input.draftId)}/publish`,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  ));
}

export async function archiveWorkflowAuthoringRevision(input: {
  projectId: string;
  revisionId: string;
}): Promise<ProjectWorkflowAuthoringSnapshotV1> {
  return readResponse(await fetch(
    `/api/local/workflow-authoring/revisions/${encodeURIComponent(input.revisionId)}/archive`,
    {
      body: JSON.stringify({ projectId: input.projectId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  ));
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
  throw new Error(body?.error ?? `Workflow Authoring request failed (${response.status}).`);
}
