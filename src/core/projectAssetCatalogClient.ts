import { createAssetFromDataUrl } from './assetStore';
import type { AssetRecord } from './types';
import type { ProjectAssetCatalogSnapshot } from './projectAssetCatalog';

export async function loadProjectAssetCatalog(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectAssetCatalogSnapshot> {
  const response = await fetch(
    `/api/local/assets?projectId=${encodeURIComponent(projectId)}`,
    { signal },
  );
  if (!response.ok) throw await assetApiError(response, 'Failed to load local materials.');
  return (await response.json()) as ProjectAssetCatalogSnapshot;
}

export async function uploadProjectMaterial(input: {
  dataUrl: string;
  fileName: string;
  height?: number;
  projectId: string;
  width?: number;
}): Promise<AssetRecord> {
  return createAssetFromDataUrl({
    ...input,
    deferSnapshotRegistration: true,
  });
}

export async function relinkProjectMaterial(input: {
  assetId: string;
  dataUrl: string;
  height?: number;
  projectId: string;
  width?: number;
}): Promise<AssetRecord> {
  const response = await fetch('/api/local/assets/relink-data-url', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw await assetApiError(response, 'Failed to relink local material.');
  return (await response.json()) as AssetRecord;
}

async function assetApiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
  return new Error(body?.error || fallback);
}
