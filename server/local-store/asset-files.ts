import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetKind, AssetRecord } from '../../src/core/types';
import { projectsRoot } from './context';

export async function readAssetFile(input: { projectId: string; assetId: string; fileName: string }): Promise<{ bytes: Buffer; mimeType: string }> {
  const assetDir = path.join(projectsRoot, input.projectId, 'assets', input.assetId);
  const metadata = JSON.parse(await readFile(path.join(assetDir, 'metadata.json'), 'utf8')) as AssetRecord;
  return { bytes: await readFile(path.join(assetDir, input.fileName)), mimeType: metadata.mimeType };
}

export async function readAssetMetadata(projectId: string, assetId: string): Promise<AssetRecord> {
  const assetDir = path.join(projectsRoot, projectId, 'assets', assetId);
  return JSON.parse(await readFile(path.join(assetDir, 'metadata.json'), 'utf8')) as AssetRecord;
}

export async function readAssetAsDataUrl(projectId: string, assetId: string): Promise<string> {
  const metadata = await readAssetMetadata(projectId, assetId);
  const absoluteStoragePath = await resolveAssetStoragePath(projectId, assetId);
  const bytes = await readFile(absoluteStoragePath);
  if (bytes.byteLength >= 30 * 1024 * 1024) throw new Error(`Seedance image input exceeds 30 MB: ${assetId}`);
  if (!metadata.mimeType.startsWith('image/') || metadata.mimeType === 'image/svg+xml') {
    throw new Error(`Seedance requires a supported raster image input: ${assetId}`);
  }
  return `data:${metadata.mimeType};base64,${bytes.toString('base64')}`;
}

export async function resolveAssetStoragePath(projectId: string, assetId: string): Promise<string> {
  const projectDir = path.join(projectsRoot, projectId);
  const metadata = await readAssetMetadata(projectId, assetId);
  const absoluteStoragePath = path.resolve(projectDir, metadata.storageKey);
  const allowedRoot = `${path.resolve(projectDir)}${path.sep}`;
  if (!absoluteStoragePath.startsWith(allowedRoot)) throw new Error(`Asset storage path escapes its project: ${assetId}`);
  return absoluteStoragePath;
}

export function extensionForMime(mimeType?: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/svg+xml') return '.svg';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'text/markdown') return '.md';
  if (mimeType === 'text/plain') return '.txt';
  return '.bin';
}

export function parseDataUrl(dataUrl: string): { bytes: Buffer; mimeType: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Expected dataUrl to be a valid data URL.');
  const mimeType = match[1] || 'application/octet-stream';
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return { bytes, mimeType };
}

export function sanitizeAssetFileName(fileName: string, extension: string): string {
  const ext = path.extname(fileName) || extension;
  const base = path.basename(fileName, path.extname(fileName)).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'original'}${ext}`;
}

export function mimeForExtension(extension: string): string {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

export function kindForMime(mimeType?: string): AssetKind {
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType === 'text/markdown' || mimeType === 'text/plain') return 'document';
  return 'other';
}
