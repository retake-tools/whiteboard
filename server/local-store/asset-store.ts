import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetKind, AssetRecord } from '../../src/core/types';
import { createMockSvg } from '../mock-svg';
import { ensureWorkspace, projectsRoot, writeJson } from './context';
import {
  extensionForMime,
  kindForMime,
  mimeForExtension,
  parseDataUrl,
  sanitizeAssetFileName,
} from './asset-files';
import { appendAssetImportedHistory, assertSourceExecutionAcceptsAssets } from './execution-store';

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
    width: input.width,
    height: input.height,
    sourceExecutionId: input.sourceExecutionId,
    createdAt: new Date().toISOString(),
  };
  await mkdir(assetDir, { recursive: true });
  await writeFile(storageKey, parsed.bytes);
  await persistAsset(assetDir, asset);
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

async function persistAsset(assetDir: string, asset: AssetRecord): Promise<void> {
  await writeJson(path.join(assetDir, 'metadata.json'), asset);
  await appendAssetImportedHistory(asset);
}
