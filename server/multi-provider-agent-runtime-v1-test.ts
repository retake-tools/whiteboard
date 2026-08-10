import assert from 'node:assert/strict';
import './studio-domain-test-fixtures';
import {
  appendAgentUserMessage,
  createAgentSession,
} from '../src/core/agentSession';
import { resolveAgentRuntimeConnectionPreference } from '../src/core/executionProviderPreferences';
import {
  checkExecutionConnection,
  createExecutionConnection,
  deleteExecutionConnection,
  listExecutionProviderSettings,
  saveAgentRuntimeDefault,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { runAgentRuntimeTurn } from './agent-runtime-port';

const snapshot = await resetWorkspace();
let settings = await createExecutionConnection({
  templateId: 'deepseek',
  displayName: 'DeepSeek Agent',
  baseUrl: 'https://api.deepseek.example/v1',
  modelId: 'deepseek-chat',
  apiKey: 'deepseek-agent-secret',
  enabledUseCases: ['text'],
}, snapshot.project.projectId);
const connection = settings.connections.find(
  (candidate) => candidate.displayName === 'DeepSeek Agent',
);
assert.ok(connection);
settings = await checkExecutionConnection(
  connection.connectionId,
  snapshot.project.projectId,
  { probeOpenAICompatible: async () => undefined },
);
settings = await saveAgentRuntimeDefault({
  connectionId: connection.connectionId,
  projectId: snapshot.project.projectId,
});
assert.equal(settings.projectAgentRuntimeConnectionId, connection.connectionId);
assert.equal(settings.projectDefaults.some((selection) => selection.useCase === 'text'), false);

const preference = resolveAgentRuntimeConnectionPreference({
  projectId: snapshot.project.projectId,
  settings,
});
assert.equal(preference.connectionId, connection.connectionId);
assert.equal(preference.isUsable, true);
assert.equal(preference.source, 'project_default');

const created = createAgentSession(snapshot, {
  connectionId: connection.connectionId,
  model: 'deepseek-chat',
  runtimeKind: 'direct_api',
  title: 'DeepSeek conversation',
});
const message = appendAgentUserMessage(snapshot, created.session.agentSessionId, {
  content: '请只回复当前画板中可以看到什么。',
});
await saveSnapshot(snapshot);

const originalFetch = globalThis.fetch;
let requestedModel = '';
let requestedStructuredPayload = '';
let directRequestCount = 0;
globalThis.fetch = async (_input, init) => {
  directRequestCount += 1;
  const body = JSON.parse(String(init?.body)) as {
    model?: string;
  };
  requestedModel = body.model ?? '';
  requestedStructuredPayload = JSON.stringify(body);
  if (directRequestCount === 1) {
    return new Response(JSON.stringify({
      id: 'chatcmpl-agent-runtime-empty',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-chat',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: '' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    id: 'chatcmpl-agent-runtime',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-chat',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({
          kind: 'reply',
          reply: '当前画板事实已读取。',
          capabilityId: null,
          imageInputs: [],
          operationBlockId: null,
          operationPrompt: null,
          aspectRatioPreset: null,
          targetResolution: null,
          variationCount: null,
          action: null,
          agentRunId: null,
          proposalKind: null,
          proposedCommand: null,
          summary: null,
          workflowEntryPointId: null,
          coverage: null,
          limitations: [],
          suggestions: [],
        }),
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  const result = await runAgentRuntimeTurn({
    agentSessionId: created.session.agentSessionId,
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    sourceMessageId: message.agentMessageId,
  });
  assert.equal(result.decision.kind, 'reply');
  assert.equal(result.decision.message, '当前画板事实已读取。');
  assert.equal(result.model, 'deepseek-chat');
  assert.equal(result.externalThreadId, `direct:${created.session.agentSessionId}`);
  assert.equal(requestedModel, 'deepseek-chat');
  assert.equal(directRequestCount, 2);
  assert.match(requestedStructuredPayload, /capabilityId/);
  const requestedBody = JSON.parse(requestedStructuredPayload) as {
    messages?: Array<{ content?: string; role?: string }>;
    thinking?: { type?: string };
  };
  assert.deepEqual(requestedBody.thinking, { type: 'disabled' });
  assert.match(requestedBody.messages?.[0]?.content ?? '', /JSON Schema exactly/);
  assert.match(requestedBody.messages?.[0]?.content ?? '', /Example JSON output/);
  assert.match(requestedBody.messages?.[0]?.content ?? '', /"required":\["kind","message"/);
} finally {
  globalThis.fetch = originalFetch;
}

await updateExecutionConnection(connection.connectionId, { enabled: false }, snapshot.project.projectId);
const unavailableSettings = await listExecutionProviderSettings(snapshot.project.projectId);
const unavailablePreference = resolveAgentRuntimeConnectionPreference({
  projectId: snapshot.project.projectId,
  settings: unavailableSettings,
});
assert.equal(unavailablePreference.connectionId, connection.connectionId);
assert.equal(unavailablePreference.isUsable, false);
assert.equal(unavailablePreference.source, 'project_default');

await updateExecutionConnection(connection.connectionId, { enabled: true }, snapshot.project.projectId);
await deleteExecutionConnection(connection.connectionId, snapshot.project.projectId);
const deletedSettings = await listExecutionProviderSettings(snapshot.project.projectId);
assert.equal(deletedSettings.projectAgentRuntimeConnectionId, undefined);

console.log(JSON.stringify({
  ok: true,
  directApiRuntime: true,
  deepSeekNonThinkingJsonMode: true,
  deepSeekParseRetryBounded: true,
  explicitCompatibleSchemaPrompt: true,
  frozenSessionModel: true,
  independentAgentDefault: true,
  unavailableDefaultDoesNotFallback: true,
  deletingConnectionClearsAgentDefault: true,
}));
