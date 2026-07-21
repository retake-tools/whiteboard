import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBlockRecord } from '../src/core/blockFactory';
import { cacheExecutionProviderSettings } from '../src/core/executionProviderPreferences';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { BoardSnapshot } from '../src/core/types';
import { generateOpenAICompatibleText } from './openai-compatible-client';
import {
  listExecutionProviderSettings,
  resolveExecutionConnection,
  saveExecutionDefault,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import { retakeRoot } from './local-store/context';

assert.ok(retakeRoot.endsWith('.retake-test-providers'), 'Provider tests must use the disposable provider workspace.');
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

await updateExecutionConnection({
  providerId: 'openai-compatible',
  baseUrl: 'https://provider.example/v1',
  model: 'test-model',
  apiKey: 'stored-secret-key',
});
await updateExecutionConnection({
  providerId: 'byteplus-modelark',
  apiKey: 'byteplus-secret-key',
});

const settings = await listExecutionProviderSettings('project_provider_test');
const compatible = settings.connections.find((connection) => connection.providerId === 'openai-compatible');
assert.equal(compatible?.status, 'ready');
assert.equal(compatible?.hasCredential, true);
assert.equal(JSON.stringify(settings).includes('stored-secret-key'), false, 'Settings API must never return credentials.');
assert.equal(settings.connections.some((connection) => connection.providerId === 'openai'), true, 'Registry catalog should include addable packages.');
await assert.rejects(
  saveExecutionDefault({ capabilityClass: 'text', connectionId: 'openai-compatible' }),
  /does not support text/,
  'A connection foundation must not become selectable before its Retake execution adapter exists.',
);

const resolved = await resolveExecutionConnection('byteplus-modelark');
assert.equal(resolved?.apiKey, 'byteplus-secret-key');
assert.equal(resolved?.baseUrl, 'https://ark.ap-southeast.bytepluses.com/api/v3');

await saveExecutionDefault({ capabilityClass: 'video', connectionId: 'byteplus-modelark' });
await saveExecutionDefault({ capabilityClass: 'video', connectionId: 'retake-mock', projectId: 'project_provider_test' });
const workspaceSaveResponse = await saveExecutionDefault({
  capabilityClass: 'video',
  connectionId: 'byteplus-modelark',
  responseProjectId: 'project_provider_test',
});
assert.equal(workspaceSaveResponse.projectDefaults[0]?.connectionId, 'retake-mock');
assert.equal(workspaceSaveResponse.workspaceDefaults.some((value) => value.connectionId === 'byteplus-modelark'), true);
const withDefaults = await listExecutionProviderSettings('project_provider_test');
assert.equal(withDefaults.workspaceDefaults[0]?.connectionId, 'byteplus-modelark');
assert.equal(withDefaults.projectDefaults[0]?.connectionId, 'retake-mock');
const board = structuredClone(defaultSnapshot) as BoardSnapshot;
board.project.projectId = 'project_provider_test';
cacheExecutionProviderSettings(board.project.projectId, withDefaults);
assert.equal(createBlockRecord(board, 'video').data.executionDraft?.executionProfileId, 'video-mock');
await saveExecutionDefault({ capabilityClass: 'video', projectId: 'project_provider_test' });
const inheritedDefaults = await listExecutionProviderSettings('project_provider_test');
assert.equal(inheritedDefaults.projectDefaults.length, 0);
cacheExecutionProviderSettings(board.project.projectId, inheritedDefaults);
assert.equal(createBlockRecord(board, 'video').data.executionDraft?.executionProfileId, 'video-seedance-modelark');

const metadataText = await readFile(path.join(retakeRoot, 'settings', 'execution-connections.json'), 'utf8');
assert.equal(metadataText.includes('secret-key'), false, 'Connection metadata must not contain API keys.');
const credentialStat = await stat(path.join(retakeRoot, 'settings', 'credentials.json'));
assert.equal(credentialStat.mode & 0o777, 0o600, 'Local credential file must be owner-only.');

await rm(retakeRoot, { recursive: true, force: true });
console.log('execution provider contract passed');
