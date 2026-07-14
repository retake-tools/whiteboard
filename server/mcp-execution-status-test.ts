import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cancelExecution } from '../src/core/executionLifecycle';
import { getBoardSnapshot, saveSnapshot } from './local-store';

const client = new Client({
  name: 'retake-whiteboard-execution-status-test',
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
      note: 'MCP execution status test',
    },
  });

  const failedExecutionResult = await client.callTool({
    name: 'retake_create_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      capabilityId: 'image.text_to_image',
      adapter: 'mcp_agent',
      inputBlockIds: ['block_brief'],
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
      provider: 'openai',
      model: 'image-model-placeholder',
    },
  });
  const failedExecution = readStructuredContent<{ executionId: string }>(failedExecutionResult.structuredContent);

  const failResult = await client.callTool({
    name: 'retake_fail_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: failedExecution.executionId,
      errorMessage: 'Synthetic provider failure for MCP status test',
    },
  });
  const failedStatus = readStructuredContent<{
    execution: { status: string; errorMessage?: string; outputBlockIds: string[]; outputAssetIds: string[] };
  }>(failResult.structuredContent);

  if (failedStatus.execution.status !== 'failed') {
    throw new Error('Expected execution status to be failed');
  }
  if (!failedStatus.execution.errorMessage?.includes('Synthetic provider failure')) {
    throw new Error('Expected failed execution to persist errorMessage');
  }
  if (failedStatus.execution.outputBlockIds.length || failedStatus.execution.outputAssetIds.length) {
    throw new Error('Failed execution should not have outputs');
  }

  const completedExecutionResult = await client.callTool({
    name: 'retake_create_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      capabilityId: 'video.generate',
      adapter: 'direct_api',
      inputBlockIds: ['block_brief'],
      triggerMode: 'server_worker',
      provider: 'retake-api-placeholder',
      model: 'video-model-placeholder',
    },
  });
  const completedExecution = readStructuredContent<{ executionId: string }>(completedExecutionResult.structuredContent);

  await client.callTool({
    name: 'retake_complete_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: completedExecution.executionId,
      outputAssetIds: ['asset_output_placeholder'],
    },
  });

  const completedResult = await client.callTool({
    name: 'retake_get_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: completedExecution.executionId,
    },
  });
  const completedStatus = readStructuredContent<{
    status: string;
    outputBlockIds: string[];
    outputAssetIds: string[];
    provider?: string;
    model?: string;
  }>(completedResult.structuredContent);

  if (completedStatus.status !== 'succeeded') {
    throw new Error('Expected execution status to be succeeded');
  }
  if (completedStatus.outputBlockIds.length) {
    throw new Error('Expected generic completion without a result block to keep outputBlockIds empty');
  }
  if (!completedStatus.outputAssetIds.includes('asset_output_placeholder')) {
    throw new Error('Expected completed execution to persist outputAssetIds');
  }

  const cancelableExecutionResult = await client.callTool({
    name: 'retake_create_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      capabilityId: 'image.text_to_image',
      adapter: 'mcp_agent',
      inputBlockIds: ['block_brief'],
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
    },
  });
  const cancelableExecution = readStructuredContent<{ executionId: string }>(cancelableExecutionResult.structuredContent);
  const cancellationSnapshot = await getBoardSnapshot({
    projectId: binding.project.projectId,
    boardId: binding.board.boardId,
  });
  const cancellation = cancelExecution(cancellationSnapshot, cancelableExecution.executionId);
  if (cancellation.execution?.status !== 'canceled') throw new Error('Expected local cancellation to persist canceled');
  await saveSnapshot(cancellationSnapshot);

  const canceledStartResult = await client.callTool({
    name: 'retake_mark_execution_running',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: cancelableExecution.executionId,
    },
  });
  const canceledCompleteResult = await client.callTool({
    name: 'retake_complete_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: cancelableExecution.executionId,
    },
  });
  const canceledFailResult = await client.callTool({
    name: 'retake_fail_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: cancelableExecution.executionId,
      errorMessage: 'Old agent attempted to overwrite cancellation',
    },
  });
  const canceledAssetResult = await client.callTool({
    name: 'retake_create_mock_generated_asset',
    arguments: {
      projectId: binding.project.projectId,
      sourceExecutionId: cancelableExecution.executionId,
    },
  });
  if (
    !canceledStartResult.isError ||
    !canceledCompleteResult.isError ||
    !canceledFailResult.isError ||
    !canceledAssetResult.isError
  ) {
    throw new Error('Expected every old-agent mutation to reject a canceled execution');
  }

  await client.close();

  console.log(
    JSON.stringify(
      {
        failedExecutionId: failedExecution.executionId,
        failedStatus: failedStatus.execution.status,
        failedHasOutputs: false,
        completedExecutionId: completedExecution.executionId,
        completedStatus: completedStatus.status,
        completedProvider: completedStatus.provider,
        completedModel: completedStatus.model,
        canceledExecutionId: cancelableExecution.executionId,
        canceledMutationsRejected: true,
      },
      null,
      2,
    ),
  );
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
