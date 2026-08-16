import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProjectAssetCatalogItem,
  ProjectAssetCatalogSnapshot,
} from '../../src/core/projectAssetCatalog';
import type { AssetKind, AssetRecord, BoardHistoryEvent } from '../../src/core/types';
import { createMockSvg } from '../mock-svg';
import { ensureWorkspace, projectsRoot, writeJson, writeJsonAtomic } from './context';
import {
  extensionForMime,
  kindForMime,
  mimeForExtension,
  parseDataUrl,
  sanitizeAssetFileName,
  resolveAssetStoragePath,
  readAssetMetadata,
} from './asset-files';
import { appendAssetImportedHistory, assertSourceExecutionAcceptsAssets } from './execution-store';
import { listProjectBoards, loadSnapshot, saveSnapshot } from './snapshot-store';

export async function listProjectAssets(projectId: string): Promise<ProjectAssetCatalogSnapshot> {
  assertLocalRecordId(projectId, 'projectId');
  await ensureWorkspace();
  const assetsRoot = path.join(projectsRoot, projectId, 'assets');
  const entries = await readdir(assetsRoot, { withFileTypes: true }).catch(() => []);
  const items = (await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry): Promise<ProjectAssetCatalogItem | undefined> => {
      const asset = await readAssetMetadata(projectId, entry.name).catch(() => undefined);
      if (!asset || asset.projectId !== projectId) return undefined;
      const storagePath = await resolveAssetStoragePath(projectId, asset.assetId).catch(() => undefined);
      const available = Boolean(storagePath && await access(storagePath).then(() => true).catch(() => false));
      return {
        asset,
        available,
        fileName: path.basename(asset.storageKey),
      };
    })))
    .filter((item): item is ProjectAssetCatalogItem => Boolean(item))
    .sort((left, right) => right.asset.createdAt.localeCompare(left.asset.createdAt));
  return { items, loadedAt: new Date().toISOString(), projectId };
}

export async function relinkAssetFromDataUrl(input: {
  assetId: string;
  dataUrl: string;
  height?: number;
  projectId: string;
  width?: number;
}): Promise<AssetRecord> {
  assertLocalRecordId(input.projectId, 'projectId');
  assertLocalRecordId(input.assetId, 'assetId');
  await ensureWorkspace();
  const asset = await readAssetMetadata(input.projectId, input.assetId);
  if (asset.projectId !== input.projectId) throw new Error('Asset project scope does not match.');
  if (asset.storageProvider !== 'local') throw new Error('Only local Assets can be relinked here.');
  const parsed = parseDataUrl(input.dataUrl);
  if (kindForMime(parsed.mimeType) !== asset.kind) {
    throw new Error(`Replacement file must keep the Asset kind: ${asset.kind}.`);
  }
  if (parsed.mimeType !== asset.mimeType) {
    throw new Error(`Replacement file must keep the Asset format: ${asset.mimeType}.`);
  }
  const storagePath = await resolveAssetStoragePath(input.projectId, input.assetId);
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, parsed.bytes);
  const updated: AssetRecord = {
    ...asset,
    height: input.height ?? asset.height,
    mimeType: parsed.mimeType,
    width: input.width ?? asset.width,
  };
  await writeJsonAtomic(
    path.join(projectsRoot, input.projectId, 'assets', input.assetId, 'metadata.json'),
    updated,
  );

  const boards = await listProjectBoards(input.projectId).catch(() => []);
  for (const board of boards) {
    const snapshot = await loadSnapshot(input.projectId, board.boardId);
    const assetIndex = snapshot.assets.findIndex((candidate) => candidate.assetId === input.assetId);
    if (assetIndex < 0) continue;
    snapshot.assets[assetIndex] = structuredClone(updated);
    const blockIds = snapshot.blocks
      .filter((block) => block.data.assetId === input.assetId)
      .map((block) => block.blockId);
    const historyEvent: BoardHistoryEvent = {
      actor: 'user',
      assetIds: [input.assetId],
      blockIds,
      createdAt: new Date().toISOString(),
      detail: { assetId: input.assetId, source: 'project_materials_relink' },
      eventId: `history_${randomUUID().slice(0, 8)}`,
      summary: path.basename(updated.storageKey),
      type: 'asset_replaced',
    };
    snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
    await saveSnapshot(snapshot);
  }
  return updated;
}

export async function createMockGeneratedAsset(input: { projectId: string; sourceExecutionId: string }): Promise<AssetRecord> {
  await assertSourceExecutionAcceptsAssets(input.projectId, input.sourceExecutionId);
  await ensureWorkspace();
  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const projectDir = path.join(projectsRoot, input.projectId);
  const assetDir = path.join(projectDir, 'assets', assetId);
  const fileName = 'original.svg';
  const storageKey = path.join(assetDir, fileName);
  const asset: AssetRecord = {
    assetId,
    projectId: input.projectId,
    kind: 'image',
    mimeType: 'image/svg+xml',
    storageProvider: 'local',
    storageKey: path.relative(projectDir, storageKey),
    previewUrl: `/api/local/assets/${input.projectId}/${assetId}/${fileName}`,
    width: 1280,
    height: 832,
    sourceExecutionId: input.sourceExecutionId,
    createdAt: new Date().toISOString(),
  };
  await mkdir(assetDir, { recursive: true });
  await writeFile(storageKey, createMockSvg(), 'utf8');
  await persistAsset(assetDir, asset);
  return asset;
}

export async function importAssetFromPath(input: {
  projectId: string;
  sourceExecutionId?: string;
  sourcePath: string;
  kind?: AssetKind;
  mimeType?: string;
}): Promise<AssetRecord> {
  await assertSourceExecutionAcceptsAssets(input.projectId, input.sourceExecutionId);
  await ensureWorkspace();
  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const projectDir = path.join(projectsRoot, input.projectId);
  const assetDir = path.join(projectDir, 'assets', assetId);
  const extension = path.extname(input.sourcePath) || extensionForMime(input.mimeType);
  const fileName = `original${extension}`;
  const storageKey = path.join(assetDir, fileName);
  const asset: AssetRecord = {
    assetId,
    projectId: input.projectId,
    kind: input.kind ?? kindForMime(input.mimeType),
    mimeType: input.mimeType ?? mimeForExtension(extension),
    storageProvider: 'local',
    storageKey: path.relative(projectDir, storageKey),
    previewUrl: `/api/local/assets/${input.projectId}/${assetId}/${fileName}`,
    sourceExecutionId: input.sourceExecutionId,
    createdAt: new Date().toISOString(),
  };
  await mkdir(assetDir, { recursive: true });
  await copyFile(input.sourcePath, storageKey);
  await persistAsset(assetDir, asset);
  return asset;
}

export async function createAssetFromDataUrl(input: {
  projectId: string;
  dataUrl: string;
  deferSnapshotRegistration?: boolean;
  duration?: number;
  fileName?: string;
  kind?: AssetKind;
  width?: number;
  height?: number;
  sourceExecutionId?: string;
}): Promise<AssetRecord> {
  await assertSourceExecutionAcceptsAssets(input.projectId, input.sourceExecutionId);
  await ensureWorkspace();
  const parsed = parseDataUrl(input.dataUrl);
  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const projectDir = path.join(projectsRoot, input.projectId);
  const assetDir = path.join(projectDir, 'assets', assetId);
  const extension = path.extname(input.fileName ?? '') || extensionForMime(parsed.mimeType);
  const fileName = sanitizeAssetFileName(input.fileName ?? `original${extension}`, extension);
  const storageKey = path.join(assetDir, fileName);
  const asset: AssetRecord = {
    assetId,
    projectId: input.projectId,
    kind: input.kind ?? kindForMime(parsed.mimeType),
    mimeType: parsed.mimeType,
    storageProvider: 'local',
    storageKey: path.relative(projectDir, storageKey),
    previewUrl: `/api/local/assets/${input.projectId}/${assetId}/${fileName}`,
    duration: input.duration,
    width: input.width,
    height: input.height,
    sourceExecutionId: input.sourceExecutionId,
    createdAt: new Date().toISOString(),
  };
  await mkdir(assetDir, { recursive: true });
  await writeFile(storageKey, parsed.bytes);
  await persistAsset(assetDir, asset, input.deferSnapshotRegistration);
  return asset;
}

export async function importAssetFromUrl(input: {
  projectId: string;
  sourceExecutionId?: string;
  sourceUrl: string;
  duration?: number;
  fetchImpl?: typeof fetch;
}): Promise<AssetRecord> {
  await assertSourceExecutionAcceptsAssets(input.projectId, input.sourceExecutionId);
  const sourceUrl = new URL(input.sourceUrl);
  if (sourceUrl.protocol !== 'https:' && sourceUrl.protocol !== 'http:') {
    throw new Error('Generated asset URL must use HTTP or HTTPS.');
  }
  const response = await (input.fetchImpl ?? fetch)(sourceUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Generated video download failed (${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024 * 1024) {
    throw new Error('Generated video exceeds the 1 GB Retake import limit.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 1024 * 1024 * 1024) throw new Error('Generated video exceeds the 1 GB Retake import limit.');
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4';
  if (!mimeType.startsWith('video/')) throw new Error(`Generated result is not a video (${mimeType}).`);

  await ensureWorkspace();
  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const projectDir = path.join(projectsRoot, input.projectId);
  const assetDir = path.join(projectDir, 'assets', assetId);
  const extension = extensionForMime(mimeType) || '.mp4';
  const fileName = `original${extension}`;
  const storageKey = path.join(assetDir, fileName);
  const asset: AssetRecord = {
    assetId,
    projectId: input.projectId,
    kind: 'video',
    mimeType,
    storageProvider: 'local',
    storageKey: path.relative(projectDir, storageKey),
    previewUrl: `/api/local/assets/${input.projectId}/${assetId}/${fileName}`,
    duration: input.duration,
    sourceExecutionId: input.sourceExecutionId,
    createdAt: new Date().toISOString(),
  };
  await mkdir(assetDir, { recursive: true });
  await writeFile(storageKey, bytes);
  await persistAsset(assetDir, asset);
  return asset;
}

async function persistAsset(
  assetDir: string,
  asset: AssetRecord,
  deferSnapshotRegistration = false,
): Promise<void> {
  await writeJson(path.join(assetDir, 'metadata.json'), asset);
  if (!deferSnapshotRegistration) await appendAssetImportedHistory(asset);
}

function assertLocalRecordId(value: string, field: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`${field} is invalid.`);
}
