import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBlockRecord } from '../src/core/blockFactory';
import { addImageCodexOperation } from '../src/core/imageOperations';
import type { BoardSnapshot } from '../src/core/types';
import {
  ensureDefaultSnapshot,
  importAssetFromPath,
  saveSnapshot,
  setCodexProjectBinding,
} from './local-store';

const instruction = '将标注指向的白色折线改成紫色，保持其他元素和构图不变。';

async function main(): Promise<void> {
  const snapshot = await ensureDefaultSnapshot();
  const fixture = await createFixtureAssets(snapshot);
  const imageBlock = createBlockRecord(snapshot, 'image');
  imageBlock.position = nextFixturePosition(snapshot);
  imageBlock.data = {
    ...imageBlock.data,
    title: 'Codex E2E source image',
    body: 'Source image for Retake Codex/MCP E2E verification.',
    assetId: fixture.sourceAsset.assetId,
    previewUrl: fixture.sourceAsset.previewUrl,
  };

  snapshot.assets.unshift(fixture.sourceAsset);
  snapshot.blocks.push(imageBlock);

  const operation = addImageCodexOperation(snapshot, {
    operation: 'annotation_edit',
    sourceBlockId: imageBlock.blockId,
    instruction,
    taskTitle: 'Codex E2E annotation edit result',
    annotatedCompositeAsset: fixture.annotatedCompositeAsset,
  });

  await saveSnapshot(snapshot);
  await setCodexProjectBinding({
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    codexProjectPath: process.cwd(),
    note: 'Codex E2E verification fixture',
  });

  const summary = {
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    executionId: operation.execution.executionId,
    sourceBlockId: imageBlock.blockId,
    resultBlockId: operation.resultBlock.blockId,
    sourceAssetId: fixture.sourceAsset.assetId,
    annotatedCompositeAssetId: fixture.annotatedCompositeAsset.assetId,
    prompt: operation.prompt,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log('\n--- RETAKE CODEX PROMPT ---\n');
  console.log(operation.prompt);
}

async function createFixtureAssets(snapshot: BoardSnapshot) {
  const outputDir = path.join(process.cwd(), 'tmp', 'codex-e2e');
  const sourcePath = path.join(outputDir, `source-${Date.now()}.svg`);
  const compositePath = path.join(outputDir, `annotation-${Date.now()}.svg`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(sourcePath, createSourceSvg(), 'utf8');
  await writeFile(compositePath, createAnnotatedCompositeSvg(), 'utf8');

  const sourceAsset = await importAssetFromPath({
    projectId: snapshot.project.projectId,
    sourcePath,
    kind: 'image',
    mimeType: 'image/svg+xml',
  });
  const annotatedCompositeAsset = await importAssetFromPath({
    projectId: snapshot.project.projectId,
    sourcePath: compositePath,
    kind: 'image',
    mimeType: 'image/svg+xml',
  });

  return { sourceAsset, annotatedCompositeAsset };
}

function nextFixturePosition(snapshot: BoardSnapshot): { x: number; y: number } {
  const rightEdge = snapshot.blocks.reduce(
    (max, block) => Math.max(max, block.position.x + block.size.width),
    0,
  );
  return { x: rightEdge + 140, y: 270 };
}

function createSourceSvg(): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#eef2ff" offset="0"/>
      <stop stop-color="#cffafe" offset="0.48"/>
      <stop stop-color="#fef3c7" offset="1"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="768" fill="url(#bg)"/>
  <rect x="168" y="132" width="688" height="468" rx="32" fill="#111827"/>
  <rect x="216" y="190" width="592" height="112" rx="20" fill="#f8fafc"/>
  <circle cx="342" cy="438" r="72" fill="#38bdf8"/>
  <circle cx="512" cy="438" r="72" fill="#22c55e"/>
  <circle cx="682" cy="438" r="72" fill="#f97316"/>
  <path d="M292 438 L462 338 L732 438" fill="none" stroke="#f8fafc" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="512" y="680" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" fill="#1f2937">Retake E2E Source</text>
</svg>
`.trim();
}

function createAnnotatedCompositeSvg(): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  ${createSourceSvg().replace(/^<svg[^>]*>|<\/svg>$/g, '')}
  <path d="M260 530 C320 510 374 470 430 420" fill="none" stroke="#dc2626" stroke-width="10" stroke-linecap="round"/>
  <path d="M430 420 L394 420 L418 446 Z" fill="#dc2626"/>
  <text x="190" y="570" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="#dc2626">把这条白色折线改成紫色</text>
</svg>
`.trim();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
