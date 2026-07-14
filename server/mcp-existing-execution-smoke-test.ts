import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBlockRecord } from '../src/core/blockFactory';
import { addImageCodexOperation } from '../src/core/imageOperations';
import type { BoardSnapshot } from '../src/core/types';
import { createAgentOutputSvg } from './agent-output-svg';
import { ensureDefaultSnapshot, saveSnapshot } from './local-store';

const client = new Client({
  name: 'retake-whiteboard-existing-execution-smoke-test',
  version: '0.1.0',
});

const transport = new StdioClientTransport({
  command: 'npm',
  args: ['run', '--silent', 'mcp'],
  cwd: process.cwd(),
  env: {
    RETAKE_WORKSPACE_DIR: process.env.RETAKE_WORKSPACE_DIR ?? '.retake-test',
  },
  stderr: 'pipe',
});

async function main(): Promise<void> {
  await client.connect(transport);

  await client.callTool({
    name: 'retake_reset_workspace',
    arguments: {},
  });

  const prepared = await prepareExistingExecution();

  await client.callTool({
    name: 'retake_set_project_binding',
    arguments: {
      projectId: prepared.snapshot.project.projectId,
      boardId: prepared.snapshot.board.boardId,
      codexProjectPath: process.cwd(),
      note: 'Existing execution smoke test binding',
    },
  });

  const validationResult = await client.callTool({
    name: 'retake_validate_project_binding',
    arguments: {
      projectId: prepared.snapshot.project.projectId,
      boardId: prepared.snapshot.board.boardId,
      codexProjectPath: process.cwd(),
    },
  });
  const validation = readStructuredContent<{ ok: boolean }>(validationResult.structuredContent);
  if (!validation.ok) {
    throw new Error('Expected Codex project binding validation to pass');
  }

  const executionResult = await client.callTool({
    name: 'retake_get_execution',
    arguments: {
      projectId: prepared.snapshot.project.projectId,
      boardId: prepared.snapshot.board.boardId,
      executionId: prepared.executionId,
    },
  });
  const execution = readStructuredContent<{ executionId: string; status: string }>(
    executionResult.structuredContent,
  );
  if (execution.executionId !== prepared.executionId || execution.status !== 'queued') {
    throw new Error('Expected existing queued execution to be readable by MCP');
  }

  const runningResult = await client.callTool({
    name: 'retake_mark_execution_running',
    arguments: {
      projectId: prepared.snapshot.project.projectId,
      boardId: prepared.snapshot.board.boardId,
      executionId: prepared.executionId,
    },
  });
  const running = readStructuredContent<{
    execution: { status: string; operationVersion?: number };
  }>(
    runningResult.structuredContent,
  );
  const runningExecution = running.execution;
  if (runningExecution.status !== 'running' || runningExecution.operationVersion !== 1) {
    throw new Error('Expected starting the existing execution to assign operation version 1');
  }

  const generatedPath = await writeAgentOutputSvg(prepared.executionId);
  const assetResult = await client.callTool({
    name: 'retake_import_asset',
    arguments: {
      projectId: prepared.snapshot.project.projectId,
      sourcePath: generatedPath,
      sourceExecutionId: prepared.executionId,
      kind: 'image',
      mimeType: 'image/svg+xml',
    },
  });
  const asset = readStructuredContent<{
    assetId: string;
    storageProvider: string;
    storageKey: string;
    previewUrl: string;
  }>(assetResult.structuredContent);

  const resultBlock = await client.callTool({
    name: 'retake_update_image_result_block',
    arguments: {
      projectId: prepared.snapshot.project.projectId,
      boardId: prepared.snapshot.board.boardId,
      executionId: prepared.executionId,
      assetId: asset.assetId,
      resultBlockId: prepared.resultBlockId,
      title: 'Existing execution image result',
    },
  });
  const result = readStructuredContent<{
    block: { blockId: string; data: { status?: string; assetId?: string } };
    execution: { status: string; outputBlockIds: string[]; outputAssetIds: string[] };
  }>(resultBlock.structuredContent);

  const snapshotResult = await client.callTool({
    name: 'retake_get_board_snapshot',
    arguments: {
      projectId: prepared.snapshot.project.projectId,
      boardId: prepared.snapshot.board.boardId,
    },
  });
  const snapshot = readStructuredContent<BoardSnapshot>(snapshotResult.structuredContent);
  const updatedResultBlock = snapshot.blocks.find((block) => block.blockId === prepared.resultBlockId);
  const resultEdge = snapshot.edges.find(
    (edge) => edge.sourceBlockId === prepared.operationBlockId && edge.targetBlockId === result.block.blockId,
  );
  const inputEdge = snapshot.edges.find(
    (edge) => edge.sourceBlockId === prepared.sourceImageBlockId && edge.targetBlockId === prepared.operationBlockId,
  );

  await client.close();

  if (result.block.blockId !== prepared.resultBlockId) {
    throw new Error('Expected existing result block to be updated');
  }
  if (updatedResultBlock?.data.status !== 'succeeded' || updatedResultBlock.data.assetId !== asset.assetId) {
    throw new Error('Expected result image block status and asset to be synced to succeeded');
  }
  if (!resultEdge) {
    throw new Error('Expected result block to connect from the operation block');
  }
  if (!inputEdge) {
    throw new Error('Expected operation block to connect from the source image block');
  }

  console.log(
    JSON.stringify(
      {
        bindingValidated: validation.ok,
        executionId: prepared.executionId,
        operationVersion: runningExecution.operationVersion,
        sourceImageBlockId: prepared.sourceImageBlockId,
        operationBlockId: prepared.operationBlockId,
        generatedPath,
        resultBlockId: result.block.blockId,
        executionStatus: result.execution.status,
        resultStatus: updatedResultBlock.data.status,
        resultEdgeKind: resultEdge.kind,
        importedAsset: asset,
        outputAssetIds: result.execution.outputAssetIds,
        outputBlockIds: result.execution.outputBlockIds,
      },
      null,
      2,
    ),
  );
}

async function prepareExistingExecution(): Promise<{
  snapshot: BoardSnapshot;
  executionId: string;
  sourceImageBlockId: string;
  operationBlockId: string;
  resultBlockId: string;
}> {
  const snapshot = await ensureDefaultSnapshot();
  const imageBlock = createBlockRecord(snapshot, 'image');
  imageBlock.position = { x: -40, y: 270 };
  snapshot.blocks.push(imageBlock);

  const operation = addImageCodexOperation(snapshot, {
    operation: 'create_similar',
    sourceBlockId: imageBlock.blockId,
    generationParams: { strength: 0.8 },
  });
  const effectiveGeneration = operation.execution.params?.generation as Record<string, unknown> | undefined;
  if (effectiveGeneration?.strength !== undefined || operation.prompt.includes('requested edit strength')) {
    throw new Error('Expected generic image-to-image execution and prompt to remove provider-specific Strength');
  }
  await saveSnapshot(snapshot);

  return {
    snapshot,
    executionId: operation.execution.executionId,
    sourceImageBlockId: imageBlock.blockId,
    operationBlockId: operation.operationBlock.blockId,
    resultBlockId: operation.resultBlock.blockId,
  };
}

async function writeAgentOutputSvg(executionId: string): Promise<string> {
  const outputDir = path.join(process.cwd(), 'tmp', 'agent-output');
  const outputPath = path.join(outputDir, `${executionId}.svg`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, createAgentOutputSvg(executionId), 'utf8');

  return outputPath;
}

function readStructuredContent<T>(value: unknown): T {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected structuredContent object from MCP tool');
  }

  return value as T;
}

main().catch(async (error: unknown) => {
  await client.close();
  console.error(error);
  process.exit(1);
});
