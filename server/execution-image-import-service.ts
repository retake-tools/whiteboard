import { readFile } from 'node:fs/promises';
import type { AssetKind, AssetRecord } from '../src/core/types';
import {
  createAssetFromDataUrl,
  getProjectExecutionContext,
  importAssetFromPath,
  resolveAssetStoragePath,
} from './local-store';
import { compositeOutpaintImage } from './outpaint-image-compositor';

export async function importExecutionAssetFromPath(input: {
  projectId: string;
  sourceExecutionId?: string;
  sourcePath: string;
  kind?: AssetKind;
  mimeType?: string;
}): Promise<AssetRecord> {
  if (!input.sourceExecutionId) {
    return importAssetFromPath(input);
  }
  const context = await getProjectExecutionContext({
    executionId: input.sourceExecutionId,
    projectId: input.projectId,
  }).catch(() => undefined);
  if (context?.execution.capabilityId !== 'image.outpaint') {
    return importAssetFromPath(input);
  }
  if (input.kind && input.kind !== 'image') {
    throw new Error('Outpaint execution output must be an image.');
  }
  const sourceAssetId = outpaintSourceAssetId(
    context.execution.params?.inputBindings,
  );
  if (!sourceAssetId) {
    throw new Error('Outpaint execution source asset was not found.');
  }
  const sourcePath = await resolveAssetStoragePath(
    input.projectId,
    sourceAssetId,
  );
  const candidateBytes = await readFile(input.sourcePath);
  const composite = await compositeOutpaintImage({
    candidateBytes,
    parameters: context.execution.params?.pluginParameters,
    sourcePath,
  });
  return createAssetFromDataUrl({
    dataUrl: `data:image/png;base64,${composite.bytes.toString('base64')}`,
    fileName: `outpaint-${input.sourceExecutionId}.png`,
    height: composite.height,
    kind: 'image',
    projectId: input.projectId,
    sourceExecutionId: input.sourceExecutionId,
    width: composite.width,
  });
}

function outpaintSourceAssetId(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const binding of value) {
    if (!binding || typeof binding !== 'object') continue;
    const record = binding as Record<string, unknown>;
    if (
      record.inputSlotId === 'source_image'
      && typeof record.assetId === 'string'
    ) {
      return record.assetId;
    }
  }
  return undefined;
}
