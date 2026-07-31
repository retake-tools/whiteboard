import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createImageOperationPrompt } from '../src/core/prompts';
import type { BlockRecord } from '../src/core/types';
import { importExecutionAssetFromPath } from './execution-image-import-service';
import {
  createAssetFromDataUrl,
  createExecution,
  getBoardSnapshot,
  resetWorkspace,
  resolveAssetStoragePath,
  saveSnapshot,
} from './local-store';

const directory = await mkdtemp(
  path.join(tmpdir(), 'retake-outpaint-mcp-import-'),
);

try {
  const snapshot = await resetWorkspace();
  const sourcePixels = Buffer.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]);
  const sourceBytes = await sharp(sourcePixels, {
    raw: { channels: 4, height: 2, width: 2 },
  }).png().toBuffer();
  const sourceAsset = await createAssetFromDataUrl({
    dataUrl: `data:image/png;base64,${sourceBytes.toString('base64')}`,
    fileName: 'source.png',
    height: 2,
    kind: 'image',
    projectId: snapshot.project.projectId,
    width: 2,
  });
  const sourceBlock = imageBlock({
    assetId: sourceAsset.assetId,
    blockId: 'block_outpaint_source',
    boardId: snapshot.board.boardId,
    title: 'Outpaint source',
  });
  snapshot.assets.unshift(sourceAsset);
  snapshot.blocks = [sourceBlock];
  await saveSnapshot(snapshot);

  const execution = await createExecution({
    adapter: 'mcp_agent',
    agentHost: 'codex',
    boardId: snapshot.board.boardId,
    capabilityId: 'image.outpaint',
    inputBlockIds: [sourceBlock.blockId],
    projectId: snapshot.project.projectId,
    prompt: 'Continue the surrounding scene.',
    triggerMode: 'manual_agent_session',
  });
  const persisted = await getBoardSnapshot({
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  });
  const storedExecution = persisted.executions.find(
    (candidate) => candidate.executionId === execution.executionId,
  );
  assert.ok(storedExecution);
  const parameters = {
    aspectPreset: '4:3',
    contractVersion: 1,
    guideHeight: 3,
    guideWidth: 4,
    maskEncoding: 'grayscale_white_expand_v1',
    sourceHeight: 2,
    sourceWidth: 2,
    sourceX: 1,
    sourceY: 1,
    targetHeight: 3,
    targetWidth: 4,
  };
  const operationBlock = operationBlockFor(
    persisted.board.boardId,
    storedExecution.executionId,
  );
  const resultBlock = imageBlock({
    blockId: 'block_outpaint_result',
    boardId: persisted.board.boardId,
    sourceExecutionId: storedExecution.executionId,
    title: 'Expanded result',
  });
  storedExecution.outputBlockIds = [resultBlock.blockId];
  storedExecution.params = {
    generation: {
      targetHeight: parameters.targetHeight,
      targetWidth: parameters.targetWidth,
    },
    inputBindings: [{
      assetId: sourceAsset.assetId,
      blockId: sourceBlock.blockId,
      inputSlotId: 'source_image',
    }],
    operationBlockId: operationBlock.blockId,
    pluginParameters: parameters,
  };
  persisted.blocks.push(operationBlock, resultBlock);
  await saveSnapshot(persisted);

  const prompt = createImageOperationPrompt(
    persisted,
    sourceBlock,
    operationBlock,
    [resultBlock],
    storedExecution,
  );
  assert.match(prompt, /Authoritative outpaint geometry:/);
  assert.match(prompt, /Do not copy, mirror, tile, repeat/);
  assert.match(prompt, /exact 4 x 3 px target canvas/);
  assert.match(
    prompt,
    /natural size 2 x 2 px in rectangle x=1, y=1, width=2, height=2/,
  );
  assert.match(prompt, /retake_import_asset will normalize its size/);

  const candidatePath = path.join(directory, 'candidate.png');
  await writeFile(
    candidatePath,
    await sharp({
      create: {
        background: { alpha: 1, b: 240, g: 120, r: 20 },
        channels: 4,
        height: 6,
        width: 8,
      },
    }).png().toBuffer(),
  );
  const imported = await importExecutionAssetFromPath({
    kind: 'image',
    projectId: snapshot.project.projectId,
    sourceExecutionId: storedExecution.executionId,
    sourcePath: candidatePath,
  });
  assert.equal(imported.mimeType, 'image/png');
  assert.equal(imported.width, 4);
  assert.equal(imported.height, 3);
  const importedPath = await resolveAssetStoragePath(
    snapshot.project.projectId,
    imported.assetId,
  );
  const output = await sharp(await readFile(importedPath))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual(pixel(output, 4, 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(output, 4, 2, 1), [0, 255, 0, 255]);
  assert.deepEqual(pixel(output, 4, 1, 2), [0, 0, 255, 255]);
  assert.deepEqual(pixel(output, 4, 2, 2), [255, 255, 0, 255]);
  assert.deepEqual(pixel(output, 4, 0, 0), [20, 120, 240, 255]);

  console.log(JSON.stringify({
    exactMcpGeometryPrompt: true,
    importedHeight: imported.height,
    importedMimeType: imported.mimeType,
    importedWidth: imported.width,
    sourcePixelsPreserved: true,
  }));
} finally {
  await rm(directory, { force: true, recursive: true });
}

function imageBlock(input: {
  assetId?: string;
  blockId: string;
  boardId: string;
  sourceExecutionId?: string;
  title: string;
}): BlockRecord {
  const now = new Date().toISOString();
  return {
    blockId: input.blockId,
    boardId: input.boardId,
    createdAt: now,
    data: {
      assetId: input.assetId,
      sourceExecutionId: input.sourceExecutionId,
      title: input.title,
    },
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { height: 230, width: 300 },
    type: 'image',
    updatedAt: now,
    zIndex: 1,
  };
}

function operationBlockFor(
  boardId: string,
  executionId: string,
): BlockRecord {
  const now = new Date().toISOString();
  return {
    blockId: 'block_outpaint_operation',
    boardId,
    createdAt: now,
    data: {
      capabilityId: 'image.outpaint',
      sourceExecutionId: executionId,
      title: 'AI Expand',
    },
    layerId: 'layer_default',
    position: { x: 320, y: 0 },
    size: { height: 190, width: 320 },
    type: 'operation',
    updatedAt: now,
    zIndex: 1,
  };
}

function pixel(
  bytes: Buffer,
  width: number,
  x: number,
  y: number,
): number[] {
  const offset = (y * width + x) * 4;
  return [...bytes.subarray(offset, offset + 4)];
}
