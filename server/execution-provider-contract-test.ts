import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBlockRecord } from '../src/core/blockFactory';
import { cacheExecutionProviderSettings } from '../src/core/executionProviderPreferences';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { BoardSnapshot } from '../src/core/types';
import { generateNativeText } from './ai-sdk-native-text-client';
import { generateOpenAICompatibleText } from './openai-compatible-client';
import { probeSeedanceModelArkConnection } from './seedance-modelark-client';
import { probeVolcengineArkImageConnection, VolcengineArkImageClient } from './volcengine-ark-image-client';
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
  await checkExecutionConnection('byteplus-modelark', undefined, {
    probeModelArk: async (config) => {
      assert.equal(config.apiKey, 'environment-test-key');
      assert.equal(config.baseUrl, 'https://environment.example/api/v3');
      assert.equal(config.model, 'environment-seedance-model');
    },
  });
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

const anthropicGenerated = await generateNativeText('anthropic-native', {
  apiKey: 'anthropic-test-key',
  baseUrl: 'https://anthropic.example/v1',
  model: 'claude-test',
}, { prompt: 'Return OK', maxOutputTokens: 4 }, async (input, init) => {
  capturedUrl = String(input);
  capturedAuthorization = new Headers(init?.headers).get('x-api-key') ?? '';
  return new Response(JSON.stringify({
    id: 'msg_retake_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'OK' }],
    model: 'claude-test',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 1 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
assert.equal(anthropicGenerated.text, 'OK');
assert.equal(capturedUrl, 'https://anthropic.example/v1/messages');
assert.equal(capturedAuthorization, 'anthropic-test-key');

const googleGenerated = await generateNativeText('google-native', {
  apiKey: 'google-test-key',
  baseUrl: 'https://google.example/v1beta',
  model: 'gemini-test',
}, { prompt: 'Return OK', maxOutputTokens: 4 }, async (input) => {
  capturedUrl = String(input);
  return new Response(JSON.stringify({
    candidates: [{
      content: { role: 'model', parts: [{ text: 'OK' }] },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
    modelVersion: 'gemini-test',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
assert.equal(googleGenerated.text, 'OK');
assert.match(capturedUrl, /\/models\/gemini-test:generateContent$/);

let capturedArkBody: Record<string, unknown> = {};
const arkGenerated = await new VolcengineArkImageClient({
  apiKey: 'ark-test-key',
  baseUrl: 'https://ark.example/api/v3/',
  model: 'seedream-test',
}, async (input, init) => {
  capturedUrl = String(input);
  capturedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
  capturedArkBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return new Response(JSON.stringify({
    model: 'seedream-test',
    data: [{ b64_json: Buffer.from('image-bytes').toString('base64'), size: '2048x2048' }],
    usage: { generated_images: 1 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}).generateImage({ prompt: 'Generate an image', images: ['data:image/png;base64,aW1hZ2U='], size: '2K' });
assert.equal(capturedUrl, 'https://ark.example/api/v3/images/generations');
assert.equal(capturedAuthorization, 'Bearer ark-test-key');
assert.equal(capturedArkBody.model, 'seedream-test');
assert.deepEqual(capturedArkBody.image, ['data:image/png;base64,aW1hZ2U=']);
assert.equal(arkGenerated.images[0]?.width, 2048);

await probeVolcengineArkImageConnection({
  apiKey: 'ark-test-key',
  baseUrl: 'https://ark.example/api/v3/',
  model: 'seedream-test',
}, async (input, init) => {
  capturedUrl = String(input);
  capturedArkBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return new Response(JSON.stringify({ error: { message: 'The prompt field is required.' } }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
assert.equal(capturedUrl, 'https://ark.example/api/v3/images/generations');
assert.deepEqual(capturedArkBody, { model: 'seedream-test' });

let capturedModelArkMethod = '';
await probeSeedanceModelArkConnection({
  apiKey: 'modelark-test-key',
  baseUrl: 'https://ark.example/api/v3/',
  model: 'seedance-test-model',
}, async (input, init) => {
  capturedUrl = String(input);
  capturedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
  capturedModelArkMethod = init?.method ?? '';
  return new Response(JSON.stringify({ items: [], total: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
assert.equal(capturedUrl, 'https://ark.example/api/v3/contents/generations/tasks?model=seedance-test-model&page_size=1');
assert.equal(capturedAuthorization, 'Bearer modelark-test-key');
assert.equal(capturedModelArkMethod, 'GET');

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
settings = await createExecutionConnection({
  templateId: 'anthropic-native',
  displayName: 'Claude Writing',
  modelId: 'claude-sonnet-4-6',
  apiKey: 'anthropic-native-secret',
});
settings = await createExecutionConnection({
  templateId: 'google-native',
  displayName: 'Gemini Writing',
  modelId: 'gemini-2.5-flash',
  apiKey: 'google-native-secret',
});
settings = await createExecutionConnection({
  templateId: 'volcengine-ark-seedream',
  displayName: 'Seedream Production',
  modelId: 'doubao-seedream-5-0-260128',
  apiKey: 'volcengine-ark-secret',
});

const openAiCompatibleConnections = settings.connections.filter((connection) => connection.connectorId === 'openai-compatible');
assert.equal(openAiCompatibleConnections.length, 3, 'One connector must support multiple single-model connections.');
assert.notEqual(openAiCompatibleConnections[0]?.connectionId, openAiCompatibleConnections[1]?.connectionId);
assert.equal(openAiCompatibleConnections.find((connection) => connection.displayName === 'Personal OpenRouter')?.modelId, 'provider/model-a');
assert.equal(openAiCompatibleConnections.find((connection) => connection.displayName === 'OpenRouter Claude')?.modelId, 'anthropic/claude-sonnet');
assert.equal(settings.connectionTemplates.some((template) => template.templateId === 'openrouter'), true);
assert.equal(settings.connectionTemplates.some((template) => template.templateId === 'anthropic-native'), true);
assert.equal(settings.connectionTemplates.some((template) => template.templateId === 'google-native'), true);
assert.equal(settings.connectionTemplates.some((template) => template.templateId === 'volcengine-ark-seedream'), true);
assert.equal(JSON.stringify(settings).includes('secret'), false, 'Settings API must never return credentials.');

const internal = openAiCompatibleConnections.find((connection) => connection.displayName === 'Internal Gateway');
assert.ok(internal);
assert.equal(internal.status, 'untested');
const resolvedInternal = await resolveExecutionConnection(internal.connectionId);
assert.equal(resolvedInternal?.apiKey, 'internal-gateway-secret');
assert.equal(resolvedInternal?.baseUrl, 'https://ai.studio.example/v1');
assert.equal(resolvedInternal?.model, 'script-v2');
settings = await checkExecutionConnection(internal.connectionId, undefined, {
  probeOpenAICompatible: async (config) => {
    assert.equal(config.apiKey, 'internal-gateway-secret');
    assert.equal(config.model, 'script-v2');
  },
});
assert.equal(settings.connections.find((connection) => connection.connectionId === internal.connectionId)?.status, 'ready');
await saveExecutionDefault({ capabilityClass: 'text', connectionId: internal.connectionId });

const claudeConnection = settings.connections.find((connection) => connection.displayName === 'Claude Writing');
const geminiConnection = settings.connections.find((connection) => connection.displayName === 'Gemini Writing');
const seedreamConnection = settings.connections.find((connection) => connection.displayName === 'Seedream Production');
assert.ok(claudeConnection && geminiConnection && seedreamConnection);
assert.equal(seedreamConnection.status, 'untested');
assert.deepEqual(seedreamConnection.supportedCapabilityIds, ['image.image_to_image', 'image.text_to_image']);
settings = await checkExecutionConnection(claudeConnection.connectionId, undefined, {
  probeNativeText: async (providerId, config) => {
    assert.equal(providerId, 'anthropic-native');
    assert.equal(config.apiKey, 'anthropic-native-secret');
  },
});
settings = await checkExecutionConnection(geminiConnection.connectionId, undefined, {
  probeNativeText: async (providerId, config) => {
    assert.equal(providerId, 'google-native');
    assert.equal(config.apiKey, 'google-native-secret');
  },
});
settings = await checkExecutionConnection(seedreamConnection.connectionId, undefined, {
  probeVolcengineArkImage: async (config) => {
    assert.equal(config.apiKey, 'volcengine-ark-secret');
    assert.equal(config.model, 'doubao-seedream-5-0-260128');
  },
});
assert.equal(settings.connections.find((connection) => connection.connectionId === claudeConnection.connectionId)?.status, 'ready');
assert.equal(settings.connections.find((connection) => connection.connectionId === geminiConnection.connectionId)?.status, 'ready');
assert.equal(settings.connections.find((connection) => connection.connectionId === seedreamConnection.connectionId)?.status, 'ready');
await saveExecutionDefault({ capabilityClass: 'image', connectionId: seedreamConnection.connectionId });

const previewConnection = settings.connections.find((connection) => connection.displayName === 'BytePlus Preview Account');
assert.ok(previewConnection);
assert.equal(previewConnection.status, 'untested');
settings = await checkExecutionConnection(previewConnection.connectionId, undefined, {
  probeModelArk: async (config) => {
    assert.equal(config.apiKey, 'byteplus-preview-secret');
    assert.equal(config.model, 'seedance-preview-model');
  },
});
assert.equal(settings.connections.find((connection) => connection.connectionId === previewConnection.connectionId)?.status, 'ready');
assert.match(
  settings.connections.find((connection) => connection.connectionId === previewConnection.connectionId)?.lastCheckMessage ?? '',
  /without creating a generation task/,
);
const codexAppServer = settings.connections.find((connection) => connection.connectionId === 'codex-app-server');
assert.ok(codexAppServer, 'Codex App Server must be present as a fixed Agent Host connection.');
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
assert.equal(
  workspaceSaveResponse.workspaceDefaults.find((selection) => selection.capabilityClass === 'video')?.connectionId,
  previewConnection.connectionId,
);

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
settings = await deleteExecutionConnection(seedreamConnection.connectionId, 'project_provider_test');
assert.equal(settings.connections.some((connection) => connection.connectionId === seedreamConnection.connectionId), false);
assert.equal(
  settings.workspaceDefaults.some((selection) => selection.connectionId === seedreamConnection.connectionId),
  false,
  'Deleting a connection must remove defaults that point to it.',
);
const credentialsAfterDelete = JSON.parse(
  await readFile(path.join(retakeRoot, 'settings', 'credentials.json'), 'utf8'),
) as { credentials: Record<string, unknown> };
assert.equal(personal.connectionId in credentialsAfterDelete.credentials, false, 'Deleting a connection must hard-delete its credential.');
assert.equal(seedreamConnection.connectionId in credentialsAfterDelete.credentials, false, 'Deleting a selected connection must hard-delete its credential.');

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
