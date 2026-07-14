import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBlockRecord } from '../src/core/blockFactory';
import { addImageCodexOperation } from '../src/core/imageOperations';
import type { BoardSnapshot } from '../src/core/types';
import { createAgentOutputSvg } from './agent-output-svg';
import { ensureDefaultSnapshot, saveSnapshot } from './local-store';

const client = new Client({ name: 'retake-whiteboard-multi-result-smoke-test', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: 'npm',
  args: ['run', '--silent', 'mcp'],
  cwd: process.cwd(),
  env: { RETAKE_WORKSPACE_DIR: process.env.RETAKE_WORKSPACE_DIR ?? '.retake-test' },
  stderr: 'pipe',
});

async function main(): Promise<void> {
  await client.connect(transport);
  await client.callTool({ name: 'retake_reset_workspace', arguments: {} });

  const prepared = await prepareMultiResultExecution();
  await client.callTool({
    name: 'retake_set_project_binding',
    arguments: {
      projectId: prepared.projectId,
      boardId: prepared.boardId,
      codexProjectPath: process.cwd(),
      note: 'Multi-result smoke test binding',
    },
  });

  const startResult = await client.callTool({
    name: 'retake_mark_execution_running',
    arguments: {
      projectId: prepared.projectId,
      boardId: prepared.boardId,
      executionId: prepared.executionId,
    },
  });
  const started = readStructuredContent<{ execution: { status: string } }>(startResult.structuredContent);
  if (started.execution.status !== 'running') {
    throw new Error(`Expected execution to enter running before generation, got ${started.execution.status}`);
  }
  const runningSnapshotResult = await client.callTool({
    name: 'retake_get_board_snapshot',
    arguments: { projectId: prepared.projectId, boardId: prepared.boardId },
  });
  const runningSnapshot = readStructuredContent<BoardSnapshot>(runningSnapshotResult.structuredContent);
  const runningOutputBlocks = prepared.resultBlockIds.map((blockId) =>
    runningSnapshot.blocks.find((block) => block.blockId === blockId),
  );
  if (runningOutputBlocks.some((block) => block?.data.status !== 'running')) {
    throw new Error('Expected every managed result block to show running before generation completes');
  }

  const updates: Array<{ assetId: string; executionStatus: string; resultBlockId: string }> = [];
  let failedPartialPreserved = false;
  let resumedFailedExecution = false;
  for (let index = 0; index < prepared.resultBlockIds.length; index += 1) {
    const resultBlockId = prepared.resultBlockIds[index];
    const outputPath = await writeAgentOutput(prepared.executionId, index);
    const assetResult = await client.callTool({
      name: 'retake_import_asset',
      arguments: {
        projectId: prepared.projectId,
        sourcePath: outputPath,
        sourceExecutionId: prepared.executionId,
        kind: 'image',
        mimeType: 'image/svg+xml',
      },
    });
    const asset = readStructuredContent<{ assetId: string }>(assetResult.structuredContent);
    const updateResult = await client.callTool({
      name: 'retake_update_image_result_block',
      arguments: {
        projectId: prepared.projectId,
        boardId: prepared.boardId,
        executionId: prepared.executionId,
        assetId: asset.assetId,
        resultBlockId,
        title: `Variant ${index + 1}`,
      },
    });
    const update = readStructuredContent<{
      block: { blockId: string };
      execution: { status: string };
    }>(updateResult.structuredContent);
    updates.push({ assetId: asset.assetId, executionStatus: update.execution.status, resultBlockId: update.block.blockId });

    if (index === 0) {
      const failResult = await client.callTool({
        name: 'retake_fail_execution',
        arguments: {
          projectId: prepared.projectId,
          boardId: prepared.boardId,
          executionId: prepared.executionId,
          errorMessage: 'Synthetic failure for the second variant.',
        },
      });
      const failed = readStructuredContent<{ execution: { status: string } }>(failResult.structuredContent);
      const failedSnapshotResult = await client.callTool({
        name: 'retake_get_board_snapshot',
        arguments: { projectId: prepared.projectId, boardId: prepared.boardId },
      });
      const failedSnapshot = readStructuredContent<BoardSnapshot>(failedSnapshotResult.structuredContent);
      const failedBlocks = prepared.resultBlockIds.map((blockId) =>
        failedSnapshot.blocks.find((block) => block.blockId === blockId),
      );
      const failedEvent = failedSnapshot.historyEvents?.find(
        (event) => event.executionId === prepared.executionId && event.type === 'execution_failed',
      );
      const failedResultBlockIds = Array.isArray(failedEvent?.detail?.failedResultBlockIds)
        ? failedEvent.detail.failedResultBlockIds
        : [];
      failedPartialPreserved =
        failed.execution.status === 'failed' &&
        failedBlocks[0]?.data.status === 'succeeded' &&
        failedBlocks[1]?.data.status === 'failed' &&
        failedBlocks[1]?.data.statusVisualDismissed !== true &&
        failedResultBlockIds.length === 1 &&
        failedResultBlockIds[0] === prepared.resultBlockIds[1];
      if (!failedPartialPreserved) {
        throw new Error('Expected partial failure to preserve the completed result and visibly fail only the missing result');
      }

      const resumeResult = await client.callTool({
        name: 'retake_mark_execution_running',
        arguments: {
          projectId: prepared.projectId,
          boardId: prepared.boardId,
          executionId: prepared.executionId,
        },
      });
      const resumed = readStructuredContent<{ execution: { status: string } }>(resumeResult.structuredContent);
      const resumedSnapshotResult = await client.callTool({
        name: 'retake_get_board_snapshot',
        arguments: { projectId: prepared.projectId, boardId: prepared.boardId },
      });
      const resumedSnapshot = readStructuredContent<BoardSnapshot>(resumedSnapshotResult.structuredContent);
      const resumedBlocks = prepared.resultBlockIds.map((blockId) =>
        resumedSnapshot.blocks.find((block) => block.blockId === blockId),
      );
      resumedFailedExecution =
        resumed.execution.status === 'running' &&
        resumedBlocks[0]?.data.status === 'succeeded' &&
        resumedBlocks[1]?.data.status === 'running';
      if (!resumedFailedExecution) {
        throw new Error('Expected failed execution resume to keep completed results and rerun only missing results');
      }
    }
  }

  const snapshotResult = await client.callTool({
    name: 'retake_get_board_snapshot',
    arguments: { projectId: prepared.projectId, boardId: prepared.boardId },
  });
  const snapshot = readStructuredContent<BoardSnapshot>(snapshotResult.structuredContent);
  const execution = snapshot.executions.find((candidate) => candidate.executionId === prepared.executionId);
  const outputBlocks = prepared.resultBlockIds.map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId));

  if (updates[0]?.executionStatus !== 'running') {
    throw new Error(`Expected partial multi-result execution to remain running, got ${updates[0]?.executionStatus}`);
  }
  if (updates[1]?.executionStatus !== 'succeeded' || execution?.status !== 'succeeded') {
    throw new Error('Expected multi-result execution to succeed after all result blocks were updated');
  }
  if (execution.operationVersion !== 1 || execution.previousExecutionId !== undefined) {
    throw new Error('Expected MCP mark running to assign the first operation version');
  }
  if (new Set(updates.map((update) => update.assetId)).size !== prepared.resultBlockIds.length) {
    throw new Error('Expected every result block to receive a distinct asset');
  }
  if (outputBlocks.some((block) => block?.data.status !== 'succeeded' || typeof block.data.assetId !== 'string')) {
    throw new Error('Expected every managed result block to contain a succeeded asset');
  }

  const directApiRetryRejected = await verifyDirectApiFailureCannotResume(prepared.projectId, prepared.boardId);
  await client.close();

  console.log(
    JSON.stringify(
      {
        executionId: prepared.executionId,
        failedPartialPreserved,
        markedRunningBeforeGeneration: true,
        resumedFailedExecution,
        directApiRetryRejected,
        resultBlockIds: prepared.resultBlockIds,
        updates,
      },
      null,
      2,
    ),
  );
}

async function verifyDirectApiFailureCannotResume(projectId: string, boardId: string): Promise<boolean> {
  const snapshot = await ensureDefaultSnapshot();
  const imageSlot = createBlockRecord(snapshot, 'image');
  snapshot.blocks.push(imageSlot);
  const operation = addImageCodexOperation(snapshot, {
    operation: 'generate_image',
    sourceBlockId: imageSlot.blockId,
    instruction: 'Direct API retry boundary test.',
  });
  operation.execution.adapter = 'direct_api';
  operation.execution.triggerMode = 'server_worker';
  delete operation.execution.agentHost;
  operation.operationBlock.data.adapter = 'direct_api';
  operation.operationBlock.data.triggerMode = 'server_worker';
  delete operation.operationBlock.data.agentHost;
  await saveSnapshot(snapshot);

  await client.callTool({
    name: 'retake_fail_execution',
    arguments: {
      projectId,
      boardId,
      executionId: operation.execution.executionId,
      errorMessage: 'Synthetic Direct API failure.',
    },
  });
  const resumeResult = await client.callTool({
    name: 'retake_mark_execution_running',
    arguments: { projectId, boardId, executionId: operation.execution.executionId },
  });
  if (!resumeResult.isError) {
    throw new Error('Expected failed Direct API execution to require its own execution adapter for retry');
  }
  return true;
}

async function prepareMultiResultExecution(): Promise<{
  boardId: string;
  executionId: string;
  projectId: string;
  resultBlockIds: string[];
}> {
  const snapshot = await ensureDefaultSnapshot();
  const imageSlot = createBlockRecord(snapshot, 'image');
  snapshot.blocks.push(imageSlot);
  const operation = addImageCodexOperation(snapshot, {
    operation: 'generate_image',
    sourceBlockId: imageSlot.blockId,
    instruction: 'Generate two distinct image variants.',
    generationParams: {
      variationCount: 2,
      aspectRatioPreset: '1:1',
      targetAspectRatio: 1,
      targetResolution: '2K',
      targetWidth: 2048,
      targetHeight: 2048,
      strength: 0.65,
    },
  });
  if (operation.execution.operationVersion !== undefined) {
    throw new Error('Expected queued Codex Managed execution to remain unversioned');
  }
  const effectiveGeneration = operation.execution.params?.generation as Record<string, unknown> | undefined;
  if (
    !effectiveGeneration ||
    effectiveGeneration.variationCount !== 2 ||
    effectiveGeneration.targetResolution !== undefined ||
    effectiveGeneration.targetWidth !== undefined ||
    effectiveGeneration.targetHeight !== undefined ||
    effectiveGeneration.strength !== undefined
  ) {
    throw new Error(
      'Expected text-to-image params to keep Count but remove unsupported resolution and irrelevant Strength fields',
    );
  }
  if (
    operation.prompt.includes('requested resolution preset') ||
    operation.prompt.includes('requested output size') ||
    operation.prompt.includes('requested edit strength')
  ) {
    throw new Error('Expected text-to-image prompt to omit unsupported or irrelevant generation fields');
  }
  await saveSnapshot(snapshot);
  return {
    boardId: snapshot.board.boardId,
    executionId: operation.execution.executionId,
    projectId: snapshot.project.projectId,
    resultBlockIds: operation.resultBlocks.map((block) => block.blockId),
  };
}

async function writeAgentOutput(executionId: string, index: number): Promise<string> {
  const outputDir = path.join(process.cwd(), 'tmp', 'agent-output');
  const outputPath = path.join(outputDir, `${executionId}-${index + 1}.svg`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, createAgentOutputSvg(`${executionId}-${index + 1}`), 'utf8');
  return outputPath;
}

function readStructuredContent<T>(value: unknown): T {
  if (!value || typeof value !== 'object') throw new Error('Expected structuredContent object from MCP tool');
  return value as T;
}

main().catch(async (error: unknown) => {
  await client.close().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
