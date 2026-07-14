import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({
  name: 'retake-whiteboard-binding-guard-test',
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

  const blockedExecutionResult = await client.callTool({
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

  if (!blockedExecutionResult.isError) {
    throw new Error('Expected mcp_agent execution to be blocked before Codex binding is set');
  }

  await client.callTool({
    name: 'retake_set_project_binding',
    arguments: {
      projectId: binding.project.projectId,
      boardId: binding.board.boardId,
      codexProjectPath: process.cwd(),
      note: 'MCP binding guard test',
    },
  });

  const allowedExecutionResult = await client.callTool({
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

  if (allowedExecutionResult.isError) {
    throw new Error('Expected mcp_agent execution to succeed after Codex binding is set');
  }

  const allowedExecution = readStructuredContent<{
    executionId: string;
    adapter: string;
    agentHost?: string;
    triggerMode?: string;
  }>(
    allowedExecutionResult.structuredContent,
  );

  await client.close();

  console.log(
    JSON.stringify(
      {
        blockedBeforeBinding: true,
        allowedAfterBinding: true,
        executionId: allowedExecution.executionId,
        adapter: allowedExecution.adapter,
        agentHost: allowedExecution.agentHost,
        triggerMode: allowedExecution.triggerMode,
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
