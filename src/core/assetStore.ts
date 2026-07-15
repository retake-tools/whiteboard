import { createId, nowIso } from './id';
import type { AssetRecord } from './types';

export function createMockGeneratedImage(projectId: string, sourceExecutionId: string): AssetRecord {
  const assetId = createId('asset');
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="832" viewBox="0 0 1280 832">
      <defs>
        <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#c9e9ff" offset="0"/>
          <stop stop-color="#fff2cc" offset="0.55"/>
          <stop stop-color="#e9b78f" offset="1"/>
        </linearGradient>
        <linearGradient id="panel" x1="0" x2="1">
          <stop stop-color="#202634" offset="0"/>
          <stop stop-color="#4a5a6f" offset="1"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="832" fill="url(#sky)"/>
      <path d="M0 620 C180 540 280 650 430 584 C610 504 760 660 940 574 C1080 510 1160 552 1280 498 L1280 832 L0 832 Z" fill="#d9aa72"/>
      <path d="M86 344 L166 176 L240 344 Z M178 344 L288 104 L392 344 Z M936 348 L1018 142 L1106 348 Z" fill="#74869a" opacity="0.62"/>
      <rect x="434" y="192" width="412" height="444" rx="34" fill="url(#panel)" opacity="0.95"/>
      <rect x="482" y="252" width="316" height="96" rx="18" fill="#ecf5ff" opacity="0.9"/>
      <circle cx="536" cy="508" r="48" fill="#14b8a6"/>
      <circle cx="744" cy="508" r="48" fill="#3b82f6"/>
      <path d="M522 468 L628 376 L758 468" fill="none" stroke="#111827" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M520 508 L640 594 L760 508" fill="none" stroke="#f8fafc" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="640" y="725" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="44" fill="#1f2937">Mock Codex Image Result</text>
    </svg>
  `);

  return {
    assetId,
    projectId,
    kind: 'image',
    mimeType: 'image/svg+xml',
    storageProvider: 'local_mock',
    storageKey: `local-mock://${assetId}/original.svg`,
    previewUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    width: 1280,
    height: 832,
    sourceExecutionId,
    createdAt: nowIso(),
  };
}

export async function createGeneratedImageAsset(
  projectId: string,
  sourceExecutionId: string,
): Promise<AssetRecord> {
  try {
    const response = await fetch('/api/local/assets/mock-generated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, sourceExecutionId }),
    });

    if (response.ok) {
      return (await response.json()) as AssetRecord;
    }
  } catch {
    // Browser-only fallback for static preview builds.
  }

  return createMockGeneratedImage(projectId, sourceExecutionId);
}

export async function createImageAssetFromDataUrl(input: {
  projectId: string;
  dataUrl: string;
  fileName?: string;
  width?: number;
  height?: number;
  sourceExecutionId?: string;
}): Promise<AssetRecord> {
  try {
    const response = await fetch('/api/local/assets/data-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (response.ok) {
      return (await response.json()) as AssetRecord;
    }
  } catch {
    // Browser-only fallback for static preview builds.
  }

  return {
    assetId: createId('asset'),
    projectId: input.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local_mock',
    storageKey: `local-mock://annotation-composite/${nowIso()}.png`,
    previewUrl: input.dataUrl,
    width: input.width,
    height: input.height,
    sourceExecutionId: input.sourceExecutionId,
    createdAt: nowIso(),
  };
}

export function getAssetPreviewUrl(assets: AssetRecord[], assetId?: string): string | undefined {
  if (!assetId) return undefined;
  return assets.find((asset) => asset.assetId === assetId)?.previewUrl;
}
