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
  name: 'retake-whiteboard-import-smoke-test',
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

  const bindingResult = await client.callTool({
    name: 'retake_resolve_current_project',
    arguments: {},
  });
  const binding = readStructuredContent<{
    project: { projectId: string };
    board: { boardId: string };
  }>(bindingResult.structuredContent);

  await client.callTool({
    name: 'retake_set_project_binding',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      codexProjectPath: process.cwd(),
      note: 'MCP import smoke test binding',
    },
  });
  const validationResult = await client.callTool({
    name: 'retake_validate_project_binding',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      codexProjectPath: process.cwd(),
    },
  });
  const validation = readStructuredContent<{ ok: boolean }>(validationResult.structuredContent);
  if (!validation.ok) {
    throw new Error('Expected Codex project binding validation to pass');
  }

  const prepared = await prepareExistingExecutionSlot();
  await client.callTool({
    name: 'retake_mark_execution_running',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: prepared.executionId,
    },
  });

  const generatedPath = await writeAgentOutputSvg(prepared.executionId);
  const assetResult = await client.callTool({
    name: 'retake_import_asset',
    arguments: {
      projectId: binding.project.projectId,
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

  const blockResult = await client.callTool({
    name: 'retake_update_image_result_block',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: prepared.executionId,
      assetId: asset.assetId,
      resultBlockId: prepared.resultBlockId,
      title: 'Imported agent file result',
      body: 'This block was created from a file imported via retake_import_asset.',
    },
  });
  const block = readStructuredContent<{
    block: { blockId: string };
    snapshotSummary: { blocks: number; edges: number; assets: number; executions: number };
  }>(blockResult.structuredContent);

  const snapshotResult = await client.callTool({
    name: 'retake_get_board_snapshot',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
    },
  });
  const snapshot = readStructuredContent<{
    blocks: unknown[];
    assets: Array<{ assetId: string; storageProvider: string; storageKey: string; previewUrl: string }>;
    executions: Array<{
      status: string;
      agentHost?: string;
      triggerMode?: string;
      operationVersion?: number;
      outputAssetIds: string[];
      outputBlockIds: string[];
    }>;
    edges: Array<{ sourceBlockId: string; targetBlockId: string; kind: string }>;
  }>(snapshotResult.structuredContent);
  const outputEdge = snapshot.edges.find(
    (edge) => edge.sourceBlockId === prepared.operationBlockId && edge.targetBlockId === prepared.resultBlockId,
  );
  if (!outputEdge || outputEdge.kind !== 'execution_output') {
    throw new Error('Expected imported result block to keep execution_output edge from operation block');
  }
  if (snapshot.executions[0]?.operationVersion !== 1) {
    throw new Error('Expected mark running to assign V1 before asset import');
  }

  await client.close();

  console.log(
    JSON.stringify(
      {
        generatedPath,
        bindingValidated: validation.ok,
        executionId: prepared.executionId,
        asset,
        blockId: block.block.blockId,
        operationBlockId: prepared.operationBlockId,
        outputEdgeKind: outputEdge.kind,
        summary: block.snapshotSummary,
        snapshot: {
          blocks: snapshot.blocks.length,
          assets: snapshot.assets.length,
          latestAsset: snapshot.assets[0],
          latestExecution: snapshot.executions[0],
        },
      },
      null,
      2,
    ),
  );
}

async function prepareExistingExecutionSlot(): Promise<{
  snapshot: BoardSnapshot;
  executionId: string;
  operationBlockId: string;
  resultBlockId: string;
}> {
  const snapshot = await ensureDefaultSnapshot();
  const imageBlock = createBlockRecord(snapshot, 'image');
  imageBlock.position = { x: -40, y: 270 };
  snapshot.blocks.push(imageBlock);

  const operation = addImageCodexOperation(snapshot, {
    operation: 'generate_image',
    sourceBlockId: imageBlock.blockId,
    instruction: 'Import a real local file generated by an agent.',
  });
  if (
    operation.resultBlock.size.width !== 214 ||
    operation.resultBlock.size.height !== 380 ||
    !operation.prompt.includes('target aspect ratio: 0.563')
  ) {
    throw new Error('Expected default text-to-image execution prompt and result slot to use 9:16');
  }
  await saveSnapshot(snapshot);

  return {
    snapshot,
    executionId: operation.execution.executionId,
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
  await client.close().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
