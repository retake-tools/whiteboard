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

export function extensionForMime(mimeType?: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/svg+xml') return '.svg';
  if (mimeType === 'video/mp4') return '.mp4';
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
  return 'application/octet-stream';
}

export function kindForMime(mimeType?: string): AssetKind {
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('image/')) return 'image';
  return 'other';
}
