import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({
  name: 'retake-whiteboard-smoke-test',
  version: '0.1.0',
});
const installedLauncherDir = process.env.RETAKE_MCP_LAUNCHER_DIR;

const transport = new StdioClientTransport({
  command: installedLauncherDir ? process.execPath : 'npm',
  args: installedLauncherDir ? ['./scripts/start-mcp.mjs'] : ['run', '--silent', 'mcp'],
  cwd: installedLauncherDir ?? process.cwd(),
  env: {
    RETAKE_WORKSPACE_DIR: process.env.RETAKE_WORKSPACE_DIR ?? '.retake-test',
  },
  stderr: 'pipe',
});

async function main(): Promise<void> {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  const requiredTools = [
    'retake_resolve_current_project',
    'retake_get_board_snapshot',
    'retake_set_project_binding',
    'retake_validate_project_binding',
    'retake_get_binding_prompt',
    'retake_create_execution',
    'retake_get_execution',
    'retake_mark_execution_running',
    'retake_complete_execution',
    'retake_fail_execution',
    'retake_create_mock_generated_asset',
    'retake_update_image_result_block',
    'retake_import_asset',
  ];

  for (const toolName of requiredTools) {
    if (!toolNames.includes(toolName)) {
      throw new Error(`Missing MCP tool: ${toolName}`);
    }
  }

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
      note: 'MCP smoke test binding',
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

  const promptResult = await client.callTool({
    name: 'retake_get_binding_prompt',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      codexProjectPath: process.cwd(),
    },
  });
  const bindingPrompt = readStructuredContent<{ prompt: string }>(promptResult.structuredContent);
  if (!bindingPrompt.prompt.includes(binding.project.projectId) || !bindingPrompt.prompt.includes(binding.board.boardId)) {
    throw new Error('Expected binding prompt to include current projectId and boardId');
  }
  if (!bindingPrompt.prompt.includes('retake_get_board_snapshot')) {
    throw new Error('Expected binding prompt to confirm the active board snapshot');
  }
  if (
    bindingPrompt.prompt.includes('retake_create_execution') ||
    bindingPrompt.prompt.includes('retake_update_image_result_block')
  ) {
    throw new Error('Binding prompt must not instruct Codex to create an execution or result block');
  }

  const executionResult = await client.callTool({
    name: 'retake_create_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      capabilityId: 'image.text_to_image',
      adapter: 'mcp_agent',
      inputBlockIds: ['block_brief'],
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
      skillId: 'image.general_concept',
      prompt: 'MCP smoke test image generation',
    },
  });
  const execution = readStructuredContent<{ executionId: string }>(executionResult.structuredContent);

  const assetResult = await client.callTool({
    name: 'retake_create_mock_generated_asset',
    arguments: {
      projectId: binding.project.projectId,
      sourceExecutionId: execution.executionId,
    },
  });
  const asset = readStructuredContent<{ assetId: string }>(assetResult.structuredContent);

  const completeResult = await client.callTool({
    name: 'retake_complete_execution',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      executionId: execution.executionId,
      outputAssetIds: [asset.assetId],
    },
  });
  const completed = readStructuredContent<{
    execution: { status: string; outputAssetIds: string[] };
    snapshotSummary: { blocks: number; edges: number; assets: number; executions: number };
  }>(completeResult.structuredContent);

  const snapshotResult = await client.callTool({
    name: 'retake_get_board_snapshot',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
    },
  });
  const snapshot = readStructuredContent<{
    blocks: unknown[];
    edges: unknown[];
    assets: unknown[];
    executions: Array<{ status: string; adapter: string; agentHost?: string; triggerMode?: string }>;
  }>(snapshotResult.structuredContent);

  await client.close();

  console.log(
    JSON.stringify(
      {
        tools: toolNames.length,
        projectId: binding.project.projectId,
        boardId: binding.board.boardId,
        bindingValidated: validation.ok,
        bindingPromptIncludesProject: bindingPrompt.prompt.includes(binding.project.projectId),
        bindingPromptIncludesBoard: bindingPrompt.prompt.includes(binding.board.boardId),
        bindingPromptUsesSnapshotConfirm: bindingPrompt.prompt.includes('retake_get_board_snapshot'),
        executionId: execution.executionId,
        assetId: asset.assetId,
        completeStatus: completed.execution.status,
        summary: completed.snapshotSummary,
        snapshot: {
          blocks: snapshot.blocks.length,
          edges: snapshot.edges.length,
          assets: snapshot.assets.length,
          executions: snapshot.executions.length,
          latestExecutionStatus: snapshot.executions[0]?.status,
          latestExecutionAdapter: snapshot.executions[0]?.adapter,
          latestAgentHost: snapshot.executions[0]?.agentHost,
          latestTriggerMode: snapshot.executions[0]?.triggerMode,
        },
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
