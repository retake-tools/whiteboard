import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  completeExecution,
  createExecution,
  createImageResultBlock,
  createMockGeneratedAsset,
  createCodexBindingPrompt,
  failExecution,
  getBoardSnapshot,
  getExecution,
  importAssetFromPath,
  resetWorkspace,
  setCodexProjectBinding,
  updateImageResultBlock,
  validateCodexProjectBinding,
} from './local-store';

const server = new McpServer({
  name: 'retake-whiteboard',
  version: '0.1.0',
});

server.registerTool(
  'retake_resolve_current_project',
  {
    title: 'Resolve Retake Project',
    description: 'Return the current/default Retake Project and Board binding for this workspace.',
    inputSchema: {},
  },
  async () => {
    const snapshot = await getBoardSnapshot();
    const structuredContent = {
      project: snapshot.project,
      board: snapshot.board,
      layer: snapshot.layers[0],
    };

    return toJsonToolResult(structuredContent);
  },
);

server.registerTool(
  'retake_get_board_snapshot',
  {
    title: 'Get Retake Board Snapshot',
    description: 'Read a Retake BoardSnapshot. Defaults to the current/default project and board.',
    inputSchema: {
      projectId: z.string().optional(),
      boardId: z.string().optional(),
    },
  },
  async ({ projectId, boardId }) => {
    const snapshot = await getBoardSnapshot({ projectId, boardId });
    return toJsonToolResult(snapshot);
  },
);

server.registerTool(
  'retake_set_project_binding',
  {
    title: 'Set Retake Codex Binding',
    description: 'Bind a Codex project path to a Retake Project and Board.',
    inputSchema: {
      projectId: z.string(),
      boardId: z.string(),
      codexProjectPath: z.string(),
      note: z.string().optional(),
    },
  },
  async (input) => {
    const result = await setCodexProjectBinding(input);
    return toJsonToolResult({
      binding: result.binding,
      project: result.snapshot.project,
      board: result.snapshot.board,
    });
  },
);

server.registerTool(
  'retake_validate_project_binding',
  {
    title: 'Validate Retake Codex Binding',
    description: 'Validate that the current Codex project path matches the Retake Project and Board binding.',
    inputSchema: {
      projectId: z.string().optional(),
      boardId: z.string().optional(),
      codexProjectPath: z.string().optional(),
    },
  },
  async (input) => {
    const result = await validateCodexProjectBinding(input);
    return toJsonToolResult(result);
  },
);

server.registerTool(
  'retake_get_binding_prompt',
  {
    title: 'Get Retake Binding Prompt',
    description: 'Return a short prompt users can paste into Codex to bind the current Retake Project and Board.',
    inputSchema: {
      projectId: z.string().optional(),
      boardId: z.string().optional(),
      codexProjectPath: z.string().optional(),
    },
  },
  async (input) => {
    const result = await createCodexBindingPrompt(input);
    return toJsonToolResult(result);
  },
);

server.registerTool(
  'retake_create_execution',
  {
    title: 'Create Retake Execution',
    description: 'Create a running ExecutionRecord for an agent/API capability call.',
    inputSchema: {
      projectId: z.string(),
      boardId: z.string(),
      capabilityId: z.string(),
      adapter: z.enum(['direct_api', 'mcp_agent', 'cli_agent', 'manual_import', 'mock']),
      inputBlockIds: z.array(z.string()).default([]),
      agentHost: z.enum(['codex', 'claude', 'cursor', 'other']).optional(),
      triggerMode: z
        .enum([
          'manual_agent_session',
          'agent_bridge',
          'codex_cli',
          'acp',
          'server_worker',
          'manual_import',
          'local_mock',
        ])
        .optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      skillId: z.string().optional(),
      prompt: z.string().optional(),
    },
  },
  async (input) => {
    if (input.adapter === 'mcp_agent') {
      const validation = await validateCodexProjectBinding({
        projectId: input.projectId,
        boardId: input.boardId,
        codexProjectPath: process.cwd(),
      });

      if (!validation.ok) {
        return toJsonErrorToolResult({
          error: 'Retake Codex binding validation failed.',
          validation,
          nextStep:
            'Call retake_set_project_binding with the current Codex project path before creating an mcp_agent execution.',
        });
      }
    }

    const execution = await createExecution(input);
    return toJsonToolResult(execution);
  },
);

server.registerTool(
  'retake_import_asset',
  {
    title: 'Import Retake Asset',
    description: 'Copy a local generated file into the Retake AssetStore and return its AssetRecord.',
    inputSchema: {
      projectId: z.string(),
      sourcePath: z.string(),
      sourceExecutionId: z.string().optional(),
      kind: z.enum(['image', 'video', 'audio', 'document', 'other']).optional(),
      mimeType: z.string().optional(),
    },
  },
  async (input) => {
    const asset = await importAssetFromPath(input);
    return toJsonToolResult(asset);
  },
);

server.registerTool(
  'retake_get_execution',
  {
    title: 'Get Retake Execution',
    description: 'Read a Retake ExecutionRecord by id.',
    inputSchema: {
      projectId: z.string(),
      boardId: z.string(),
      executionId: z.string(),
    },
  },
  async (input) => {
    const execution = await getExecution(input);
    return toJsonToolResult(execution);
  },
);

server.registerTool(
  'retake_complete_execution',
  {
    title: 'Complete Retake Execution',
    description: 'Mark an ExecutionRecord as succeeded without forcing creation of a result block.',
    inputSchema: {
      projectId: z.string(),
      boardId: z.string(),
      executionId: z.string(),
      outputBlockIds: z.array(z.string()).optional(),
      outputAssetIds: z.array(z.string()).optional(),
    },
  },
  async (input) => {
    const result = await completeExecution(input);
    return toJsonToolResult({
      execution: result.execution,
      snapshotSummary: {
        projectId: result.snapshot.project.projectId,
        boardId: result.snapshot.board.boardId,
        blocks: result.snapshot.blocks.length,
        edges: result.snapshot.edges.length,
        assets: result.snapshot.assets.length,
        executions: result.snapshot.executions.length,
      },
    });
  },
);

server.registerTool(
  'retake_fail_execution',
  {
    title: 'Fail Retake Execution',
    description: 'Mark an ExecutionRecord as failed and persist the failure reason.',
    inputSchema: {
      projectId: z.string(),
      boardId: z.string(),
      executionId: z.string(),
      errorMessage: z.string(),
    },
  },
  async (input) => {
    const result = await failExecution(input);
    return toJsonToolResult({
      execution: result.execution,
      snapshotSummary: {
        projectId: result.snapshot.project.projectId,
        boardId: result.snapshot.board.boardId,
        blocks: result.snapshot.blocks.length,
        edges: result.snapshot.edges.length,
        assets: result.snapshot.assets.length,
        executions: result.snapshot.executions.length,
      },
    });
  },
);

server.registerTool(
  'retake_create_mock_generated_asset',
  {
    title: 'Create Mock Retake Asset',
    description: 'Create a deterministic mock image asset in the local Retake AssetStore for smoke tests.',
    inputSchema: {
      projectId: z.string(),
      sourceExecutionId: z.string(),
    },
  },
  async (input) => {
    const asset = await createMockGeneratedAsset(input);
    return toJsonToolResult(asset);
  },
);

server.registerTool(
  'retake_create_image_result_block',
  {
    title: 'Create Retake Image Result Block',
    description: 'Create an Image Block from an existing AssetRecord and mark its ExecutionRecord as succeeded.',
    inputSchema: {
      projectId: z.string(),
      boardId: z.string(),
      executionId: z.string(),
      assetId: z.string(),
      sourceBlockIds: z.array(z.string()).optional(),
      displayWidth: z.number().positive().optional(),
      displayHeight: z.number().positive().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
    },
  },
  async (input) => {
    const result = await createImageResultBlock(input);
    return toJsonToolResult({
      block: result.block,
      execution: result.execution,
      snapshotSummary: {
        projectId: result.snapshot.project.projectId,
        boardId: result.snapshot.board.boardId,
        blocks: result.snapshot.blocks.length,
        edges: result.snapshot.edges.length,
        assets: result.snapshot.assets.length,
        executions: result.snapshot.executions.length,
      },
    });
  },
);

server.registerTool(
  'retake_update_image_result_block',
  {
    title: 'Update Retake Image Result Block',
    description: 'Attach an imported AssetRecord to an existing Image Result Block and mark its ExecutionRecord as succeeded.',
    inputSchema: {
      projectId: z.string(),
      boardId: z.string(),
      executionId: z.string(),
      assetId: z.string(),
      resultBlockId: z.string().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
    },
  },
  async (input) => {
    const result = await updateImageResultBlock(input);
    return toJsonToolResult({
      block: result.block,
      execution: result.execution,
      snapshotSummary: {
        projectId: result.snapshot.project.projectId,
        boardId: result.snapshot.board.boardId,
        blocks: result.snapshot.blocks.length,
        edges: result.snapshot.edges.length,
        assets: result.snapshot.assets.length,
        executions: result.snapshot.executions.length,
      },
    });
  },
);

server.registerTool(
  'retake_reset_workspace',
  {
    title: 'Reset Retake Workspace',
    description: 'Reset the local Retake .retake workspace to the demo Project and Board.',
    inputSchema: {},
  },
  async () => {
    const snapshot = await resetWorkspace();
    return toJsonToolResult({
      project: snapshot.project,
      board: snapshot.board,
      blocks: snapshot.blocks.length,
      edges: snapshot.edges.length,
    });
  },
);

function toJsonToolResult(structuredContent: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function toJsonErrorToolResult(structuredContent: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
    isError: true,
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error('Retake MCP server error:', error);
  process.exit(1);
});
