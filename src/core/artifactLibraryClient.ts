import type {
  CreateOrAdvanceArtifactResult,
  ProjectArtifactLibrarySnapshot,
  PromoteProjectAssetCommand,
} from './artifactContracts';

export async function loadProjectArtifactLibrary(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectArtifactLibrarySnapshot> {
  const response = await fetch(
    `/api/local/artifacts?projectId=${encodeURIComponent(projectId)}`,
    { signal },
  );
  if (!response.ok) throw await artifactApiError(response, 'Failed to load Project Asset Library.');
  return (await response.json()) as ProjectArtifactLibrarySnapshot;
}

export async function promoteProjectAsset(
  command: PromoteProjectAssetCommand,
): Promise<CreateOrAdvanceArtifactResult> {
  const response = await fetch('/api/local/artifacts/promote', {
    body: JSON.stringify(command),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw await artifactApiError(response, 'Failed to add Asset to Project Library.');
  return (await response.json()) as CreateOrAdvanceArtifactResult;
}

async function artifactApiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
  return new Error(body?.error || fallback);
}
