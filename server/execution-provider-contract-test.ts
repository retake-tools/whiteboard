import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBlockRecord } from '../src/core/blockFactory';
import { cacheExecutionProviderSettings } from '../src/core/executionProviderPreferences';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { BoardSnapshot } from '../src/core/types';
import { generateOpenAICompatibleText } from './openai-compatible-client';
import {
  checkExecutionConnection,
  createExecutionConnection,
  deleteExecutionConnection,
  duplicateExecutionConnection,
  listExecutionProviderSettings,
  resolveExecutionConnection,
  saveExecutionDefault,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import { retakeRoot } from './local-store/context';

assert.ok(retakeRoot.endsWith('.retake-test-providers'), 'Provider tests must use the disposable provider workspace.');
await rm(retakeRoot, { recursive: true, force: true });

const settingsRoot = path.join(retakeRoot, 'settings');
await mkdir(settingsRoot, { recursive: true });
await writeFile(path.join(settingsRoot, 'execution-connections.json'), JSON.stringify({
  schemaVersion: 1,
  connections: [{
    connectionId: 'openai-compatible',
    providerId: 'openai-compatible',
    displayName: 'Legacy compatible connection',
    enabled: true,
    baseUrl: 'https://legacy.example/v1',
    model: 'legacy-model',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }],
}));
const migrated = await listExecutionProviderSettings();
assert.equal(migrated.connections.find((connection) => connection.connectionId === 'openai-compatible')?.connectorId, 'openai-compatible');
assert.equal(migrated.connections.find((connection) => connection.connectionId === 'openai-compatible')?.modelId, 'legacy-model');
await writeFile(path.join(settingsRoot, 'execution-connections.json'), JSON.stringify({
  schemaVersion: 2,
  connections: [{
    connectionId: 'connection_v2',
    connectorId: 'openai-compatible',
    templateId: 'openrouter',
    displayName: 'V2 multi-model connection',
    enabled: true,
    models: [{ modelId: 'model-a' }, { modelId: 'model-b' }],
    defaultModelId: 'model-b',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }],
}));
await writeFile(path.join(settingsRoot, 'execution-defaults.json'), JSON.stringify({
  schemaVersion: 1,
  workspace: [{ capabilityClass: 'text', connectionId: 'connection_v2', model: 'model-b' }],
  projects: {},
}));
const migratedV2 = await listExecutionProviderSettings();
assert.equal(migratedV2.connections.find((connection) => connection.connectionId === 'connection_v2')?.modelId, 'model-b');
assert.deepEqual(migratedV2.workspaceDefaults, [{ capabilityClass: 'text', connectionId: 'connection_v2' }]);
await rm(retakeRoot, { recursive: true, force: true });

const previousModelArkEnvironment = {
  apiKey: process.env.SEEDANCE_MODELARK_API_KEY,
  baseUrl: process.env.SEEDANCE_MODELARK_BASE_URL,
  model: process.env.SEEDANCE_MODELARK_MODEL,
};
try {
  process.env.SEEDANCE_MODELARK_API_KEY = 'environment-test-key';
  process.env.SEEDANCE_MODELARK_BASE_URL = 'https://environment.example/api/v3';
  process.env.SEEDANCE_MODELARK_MODEL = 'environment-seedance-model';
  const environmentSettings = await listExecutionProviderSettings();
  const environmentConnection = environmentSettings.connections.find(
    (connection) => connection.connectionId === 'byteplus-modelark',
  );
  assert.equal(environmentConnection?.baseUrl, 'https://environment.example/api/v3');
  assert.equal(environmentConnection?.modelId, 'environment-seedance-model');
  assert.equal((await resolveExecutionConnection('byteplus-modelark'))?.model, 'environment-seedance-model');
  await checkExecutionConnection('byteplus-modelark');
  assert.equal((await resolveExecutionConnection('byteplus-modelark'))?.model, 'environment-seedance-model');
} finally {
  restoreEnvironment('SEEDANCE_MODELARK_API_KEY', previousModelArkEnvironment.apiKey);
  restoreEnvironment('SEEDANCE_MODELARK_BASE_URL', previousModelArkEnvironment.baseUrl);
  restoreEnvironment('SEEDANCE_MODELARK_MODEL', previousModelArkEnvironment.model);
}
await rm(retakeRoot, { recursive: true, force: true });

let capturedUrl = '';
let capturedAuthorization = '';
const fakeFetch: typeof fetch = async (input, init) => {
  capturedUrl = String(input);
  capturedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
  return new Response(JSON.stringify({
    id: 'chatcmpl_retake_test',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'OK' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const generated = await generateOpenAICompatibleText({
  apiKey: 'test-secret-key',
  baseUrl: 'https://provider.example/v1/',
  model: 'test-model',
}, { prompt: 'Return OK', maxOutputTokens: 4 }, fakeFetch);
assert.equal(generated.text, 'OK');
assert.equal(generated.finishReason, 'stop');
assert.equal(capturedUrl, 'https://provider.example/v1/chat/completions');
assert.equal(capturedAuthorization, 'Bearer test-secret-key');

await updateExecutionConnection('byteplus-modelark', {
  modelId: 'dreamina-seedance-2-0-260128',
  apiKey: 'byteplus-secret-key',
});
let settings = await createExecutionConnection({
  templateId: 'openrouter',
  displayName: 'Personal OpenRouter',
  modelId: 'provider/model-a',
  apiKey: 'openrouter-personal-secret',
});
const personalBeforeDuplicate = settings.connections.find((connection) => connection.displayName === 'Personal OpenRouter');
assert.ok(personalBeforeDuplicate);
const duplicatedResult = await duplicateExecutionConnection(personalBeforeDuplicate.connectionId);
const duplicatedBeforeEdit = duplicatedResult.snapshot.connections.find(
  (connection) => connection.connectionId === duplicatedResult.duplicatedConnectionId,
);
assert.equal(duplicatedBeforeEdit?.modelId, 'provider/model-a');
assert.equal((await resolveExecutionConnection(duplicatedResult.duplicatedConnectionId))?.apiKey, 'openrouter-personal-secret');
settings = await updateExecutionConnection(duplicatedResult.duplicatedConnectionId, {
  displayName: 'OpenRouter Claude',
  providerLabel: 'Anthropic',
  modelId: 'anthropic/claude-sonnet',
});
settings = await createExecutionConnection({
  templateId: 'custom-openai-compatible',
  displayName: 'Internal Gateway',
  providerLabel: 'Studio AI',
  baseUrl: 'https://ai.studio.example/v1',
  modelId: 'script-v2',
  apiKey: 'internal-gateway-secret',
});
settings = await createExecutionConnection({
  templateId: 'byteplus-modelark',
  displayName: 'BytePlus Preview Account',
  modelId: 'seedance-preview-model',
  apiKey: 'byteplus-preview-secret',
});

const openAiCompatibleConnections = settings.connections.filter((connection) => connection.connectorId === 'openai-compatible');
assert.equal(openAiCompatibleConnections.length, 3, 'One connector must support multiple single-model connections.');
assert.notEqual(openAiCompatibleConnections[0]?.connectionId, openAiCompatibleConnections[1]?.connectionId);
assert.equal(openAiCompatibleConnections.find((connection) => connection.displayName === 'Personal OpenRouter')?.modelId, 'provider/model-a');
assert.equal(openAiCompatibleConnections.find((connection) => connection.displayName === 'OpenRouter Claude')?.modelId, 'anthropic/claude-sonnet');
assert.equal(settings.connectionTemplates.some((template) => template.templateId === 'openrouter'), true);
assert.equal(JSON.stringify(settings).includes('secret'), false, 'Settings API must never return credentials.');

const internal = openAiCompatibleConnections.find((connection) => connection.displayName === 'Internal Gateway');
assert.ok(internal);
const resolvedInternal = await resolveExecutionConnection(internal.connectionId);
assert.equal(resolvedInternal?.apiKey, 'internal-gateway-secret');
assert.equal(resolvedInternal?.baseUrl, 'https://ai.studio.example/v1');
assert.equal(resolvedInternal?.model, 'script-v2');
await assert.rejects(
  saveExecutionDefault({ capabilityClass: 'text', connectionId: internal.connectionId }),
  /does not support text/,
  'A connection foundation must not become selectable before its Retake execution adapter exists.',
);

const previewConnection = settings.connections.find((connection) => connection.displayName === 'BytePlus Preview Account');
assert.ok(previewConnection);
await saveExecutionDefault({
  capabilityClass: 'video',
  connectionId: previewConnection.connectionId,
});
await saveExecutionDefault({ capabilityClass: 'video', connectionId: 'retake-mock', projectId: 'project_provider_test' });
const workspaceSaveResponse = await saveExecutionDefault({
  capabilityClass: 'video',
  connectionId: previewConnection.connectionId,
  responseProjectId: 'project_provider_test',
});
assert.equal(workspaceSaveResponse.projectDefaults[0]?.connectionId, 'retake-mock');
assert.equal(workspaceSaveResponse.workspaceDefaults[0]?.connectionId, previewConnection.connectionId);

const board = structuredClone(defaultSnapshot) as BoardSnapshot;
board.project.projectId = 'project_provider_test';
cacheExecutionProviderSettings(board.project.projectId, workspaceSaveResponse);
assert.equal(createBlockRecord(board, 'video').data.executionDraft?.executionProfileId, 'video-mock');
await saveExecutionDefault({ capabilityClass: 'video', projectId: 'project_provider_test' });
const inheritedDefaults = await listExecutionProviderSettings('project_provider_test');
cacheExecutionProviderSettings(board.project.projectId, inheritedDefaults);
const inheritedVideoBlock = createBlockRecord(board, 'video');
assert.equal(inheritedVideoBlock.data.executionDraft?.executionProfileId, 'video-seedance-modelark');
assert.equal(inheritedVideoBlock.data.executionDraft?.connectionId, previewConnection.connectionId);
assert.equal('model' in (inheritedVideoBlock.data.executionDraft ?? {}), false);

const personal = openAiCompatibleConnections.find((connection) => connection.displayName === 'Personal OpenRouter');
assert.ok(personal);
settings = await deleteExecutionConnection(personal.connectionId, 'project_provider_test');
assert.equal(settings.connections.some((connection) => connection.connectionId === personal.connectionId), false);

const metadataText = await readFile(path.join(retakeRoot, 'settings', 'execution-connections.json'), 'utf8');
assert.equal(metadataText.includes('secret'), false, 'Connection metadata must not contain API keys.');
const credentialStat = await stat(path.join(retakeRoot, 'settings', 'credentials.json'));
assert.equal(credentialStat.mode & 0o777, 0o600, 'Local credential file must be owner-only.');

await rm(retakeRoot, { recursive: true, force: true });
console.log('execution provider contract passed');

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
