import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import {
  createDraftTextGenerationOperation,
  createDraftSkillOperation,
  executeExistingTextGenerationOperation,
} from '../src/core/textOperations';
import { operationReadinessFor } from '../src/core/capabilities';
import {
  checkExecutionConnection,
  createExecutionConnection,
} from './local-store/execution-provider-store';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { startTextGeneration } from './text-generation-service';

const initial = await resetWorkspace();
let settings = await createExecutionConnection({
  templateId: 'custom-openai-compatible',
  displayName: 'Text API test',
  baseUrl: 'https://text.example/v1',
  modelId: 'text-test-model',
  apiKey: 'text-test-secret',
});
const openAIConnection = settings.connections.find((connection) => connection.displayName === 'Text API test');
assert.ok(openAIConnection);
settings = await checkExecutionConnection(openAIConnection.connectionId, undefined, {
  probeOpenAICompatible: async () => undefined,
});
const readyOpenAIConnection = settings.connections.find((connection) => connection.connectionId === openAIConnection.connectionId);
assert.equal(readyOpenAIConnection?.status, 'ready');
assert.deepEqual(readyOpenAIConnection?.supportedCapabilityIds, textDocumentCapabilityIds);

const labels = {
  operationTitle: 'Generate text',
  promptPlaceholder: 'Write a short scene.',
  promptTitle: 'Prompt',
  resultTitle: 'Generated text',
  waitingBody: 'Waiting for text generation.',
};
const draft = createDraftTextGenerationOperation(initial, {
  ...labels,
  connectionId: readyOpenAIConnection!.connectionId,
});
assert.equal(initial.blocks.some((block) => block.type === 'document'), false, 'Draft creation must not pre-create an output block.');
draft.promptBlock.data.body = 'Write a short Markdown scene about a cat director.';
const firstRun = executeExistingTextGenerationOperation(initial, {
  connection: readyOpenAIConnection!,
  labels,
  operationBlockId: draft.operationBlock.blockId,
});
await saveSnapshot(initial);
const firstStarted = await startTextGeneration({
  projectId: initial.project.projectId,
  boardId: initial.board.boardId,
  executionId: firstRun.execution.executionId,
  connectionId: readyOpenAIConnection!.connectionId,
}, {
  generateOpenAICompatible: async (config, input) => {
    assert.equal(config.apiKey, 'text-test-secret');
    assert.equal(config.model, 'text-test-model');
    assert.match(input.prompt, /cat director/);
    assert.match(input.prompt, /Return only the requested Markdown document/);
    assert.match(input.prompt, /Do not call tools and do not add process commentary/);
    return {
      text: '# Cat Director\n\nA concise first draft.',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 9 },
    };
  },
});
await firstStarted.completion;

let completed = await loadSnapshot(initial.project.projectId, initial.board.boardId);
const completedFirstExecution = completed.executions.find((execution) => execution.executionId === firstRun.execution.executionId);
const firstResultBlock = completed.blocks.find((block) => block.blockId === firstRun.resultBlock.blockId);
assert.equal(completedFirstExecution?.status, 'succeeded');
assert.equal(completedFirstExecution?.skillId, undefined, 'Generic text generation must not pretend that a Retake Skill ran.');
assert.equal(completedFirstExecution?.requestPrompts?.length, 1);
assert.equal(completedFirstExecution?.requestPrompts?.[0]?.outputBlockId, firstRun.resultBlock.blockId);
assert.match(completedFirstExecution?.requestPrompts?.[0]?.prompt ?? '', /Return only the requested Markdown document/);
assert.equal(firstResultBlock?.type, 'document');
assert.equal(firstResultBlock?.data.body, undefined, 'Full Markdown must not be copied into BoardSnapshot.');
assert.equal(firstResultBlock?.data.title, 'Cat Director');
assert.equal(firstResultBlock?.data.documentExcerpt, 'Cat Director\n\nA concise first draft.');
assert.deepEqual(firstResultBlock?.data.documentOutline, ['Cat Director']);
assert.equal(firstResultBlock?.data.contentFormat, 'markdown');
assert.equal(firstResultBlock?.data.status, 'succeeded');
assert.ok(firstResultBlock?.data.assetId);
const firstAsset = completed.assets.find((asset) => asset.assetId === firstResultBlock.data.assetId);
assert.equal(firstAsset?.kind, 'document');
assert.equal(firstAsset?.mimeType, 'text/markdown');
assert.equal(
  await readFile(await resolveAssetStoragePath(initial.project.projectId, firstAsset!.assetId), 'utf8'),
  '# Cat Director\n\nA concise first draft.',
);

settings = await createExecutionConnection({
  templateId: 'google-native',
  displayName: 'Gemini text test',
  modelId: 'gemini-test-model',
  apiKey: 'gemini-test-secret',
});
const googleConnection = settings.connections.find((connection) => connection.displayName === 'Gemini text test');
assert.ok(googleConnection);
settings = await checkExecutionConnection(googleConnection.connectionId, undefined, {
  probeNativeText: async () => undefined,
});
const readyGoogleConnection = settings.connections.find((connection) => connection.connectionId === googleConnection.connectionId);
assert.equal(readyGoogleConnection?.status, 'ready');

const operationBlock = completed.blocks.find((block) => block.blockId === draft.operationBlock.blockId);
assert.ok(operationBlock);
operationBlock.data.connectionId = readyGoogleConnection!.connectionId;
const secondRun = executeExistingTextGenerationOperation(completed, {
  connection: readyGoogleConnection!,
  labels,
  operationBlockId: operationBlock.blockId,
});
await saveSnapshot(completed);
const secondStarted = await startTextGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: secondRun.execution.executionId,
  connectionId: readyGoogleConnection!.connectionId,
}, {
  generateNative: async (providerId, config, input) => {
    assert.equal(providerId, 'google-native');
    assert.equal(config.apiKey, 'gemini-test-secret');
    assert.match(input.prompt, /Return only the requested Markdown document/);
    assert.match(input.prompt, /Do not call tools and do not add process commentary/);
    return {
      text: '# Cat Director\n\nA revised second draft.',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 10 },
    };
  },
});
await secondStarted.completion;

completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const completedSecondExecution = completed.executions.find((execution) => execution.executionId === secondRun.execution.executionId);
const secondResultBlock = completed.blocks.find((block) => block.blockId === secondRun.resultBlock.blockId);
assert.equal(completedSecondExecution?.status, 'succeeded');
assert.notEqual(secondResultBlock?.blockId, firstResultBlock.blockId, 'A paid prior result must not be overwritten.');
assert.notEqual(secondResultBlock?.data.assetId, firstResultBlock.data.assetId);
assert.equal(completed.assets.some((asset) => asset.assetId === firstAsset!.assetId), true);
assert.equal(completed.assets.filter((asset) => asset.sourceExecutionId === firstRun.execution.executionId || asset.sourceExecutionId === secondRun.execution.executionId).length, 2);

const normalizeLabels = {
  operationTitle: 'Organize screenplay',
  promptPlaceholder: 'Select a screenplay.',
  promptTitle: 'Source screenplay',
  resultTitle: 'Organized screenplay',
  waitingBody: 'Waiting for normalization.',
};
const skillDraft = createDraftSkillOperation(completed, {
  ...normalizeLabels,
  connectionId: readyOpenAIConnection!.connectionId,
  selectedBlockIds: [firstResultBlock.blockId],
  skillId: 'retake.screenplay.normalize',
});
assert.deepEqual(skillDraft.inputBlocks.map((block) => block.blockId), [firstResultBlock.blockId]);
assert.equal(skillDraft.operationBlock.data.capabilityId, 'story.screenplay.normalize');
assert.equal(operationReadinessFor(completed, skillDraft.operationBlock).canRun, true, 'An asset-backed Document must satisfy screenplay input readiness.');
const skillRun = executeExistingTextGenerationOperation(completed, {
  connection: readyOpenAIConnection!,
  labels: normalizeLabels,
  operationBlockId: skillDraft.operationBlock.blockId,
});
assert.equal(skillRun.execution.skillId, 'retake.screenplay.normalize');
assert.equal(skillRun.execution.inputBindingsSnapshot?.[0]?.slotId, 'source_screenplay');
assert.equal('instructionTemplate' in (skillRun.execution.skillSnapshot ?? {}), true);
await saveSnapshot(completed);
const skillStarted = await startTextGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: skillRun.execution.executionId,
  connectionId: readyOpenAIConnection!.connectionId,
}, {
  generateOpenAICompatible: async (_config, input) => {
    assert.match(input.prompt, /source screenplay is authoritative/i);
    assert.match(input.prompt, /# Cat Director/);
    assert.match(input.prompt, /# Output requirements/);
    return {
      text: '# Cat Director\n\nA faithfully normalized first draft.',
      finishReason: 'stop',
      usage: { inputTokens: 200, outputTokens: 12 },
    };
  },
});
await skillStarted.completion;
completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const completedSkillExecution = completed.executions.find((execution) => execution.executionId === skillRun.execution.executionId);
assert.equal(completedSkillExecution?.status, 'succeeded');
assert.equal(completedSkillExecution?.capabilityId, 'story.screenplay.normalize');
assert.equal(completedSkillExecution?.skillId, 'retake.screenplay.normalize');
assert.match(completedSkillExecution?.requestPrompts?.[0]?.prompt ?? '', /The source screenplay is authoritative/);

const productionDesignCases = [
  {
    capabilityId: 'design.character.define',
    skillId: 'retake.character-bible.from-screenplay',
    operationTitle: 'Define characters',
    resultTitle: 'Character Bible',
    instructionPattern: /Character Designer/,
    output: '# Character Bible\n\n## cat_director\n\nStable silhouette and continuity rules.',
    outputPattern: /future reference assets/i,
  },
  {
    capabilityId: 'design.scene.define',
    skillId: 'retake.scene-bible.from-screenplay',
    operationTitle: 'Define scenes',
    resultTitle: 'Scene Bible',
    instructionPattern: /Scene Designer/,
    output: '# Scene Bible\n\n## studio_floor\n\nStable zones, lighting, and blocking rules.',
    outputPattern: /spatial logic/i,
  },
] as const;

for (const productionDesignCase of productionDesignCases) {
  const productionLabels = {
    operationTitle: productionDesignCase.operationTitle,
    promptPlaceholder: 'Select a screenplay.',
    promptTitle: 'Source screenplay',
    resultTitle: productionDesignCase.resultTitle,
    waitingBody: 'Waiting for production design.',
  };
  const productionDraft = createDraftSkillOperation(completed, {
    ...productionLabels,
    connectionId: readyOpenAIConnection!.connectionId,
    selectedBlockIds: [firstResultBlock.blockId],
    skillId: productionDesignCase.skillId,
  });
  assert.equal(productionDraft.operationBlock.data.capabilityId, productionDesignCase.capabilityId);
  assert.equal(operationReadinessFor(completed, productionDraft.operationBlock).canRun, true);
  const productionRun = executeExistingTextGenerationOperation(completed, {
    connection: readyOpenAIConnection!,
    labels: productionLabels,
    operationBlockId: productionDraft.operationBlock.blockId,
  });
  assert.equal(productionRun.execution.inputBindingsSnapshot?.[0]?.slotId, 'screenplay');
  assert.equal(productionRun.execution.inputBindingsSnapshot?.[0]?.values[0]?.kind, 'asset');
  await saveSnapshot(completed);
  const productionStarted = await startTextGeneration({
    projectId: completed.project.projectId,
    boardId: completed.board.boardId,
    executionId: productionRun.execution.executionId,
    connectionId: readyOpenAIConnection!.connectionId,
  }, {
    generateOpenAICompatible: async (_config, input) => {
      assert.match(input.prompt, productionDesignCase.instructionPattern);
      assert.match(input.prompt, /# Cat Director/);
      assert.match(input.prompt, productionDesignCase.outputPattern);
      assert.match(input.prompt, /must not mutate shared design files/i);
      return {
        text: productionDesignCase.output,
        finishReason: 'stop',
        usage: { inputTokens: 240, outputTokens: 24 },
      };
    },
  });
  await productionStarted.completion;
  completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
  const completedProductionExecution = completed.executions.find(
    (execution) => execution.executionId === productionRun.execution.executionId,
  );
  const productionResultBlock = completed.blocks.find((block) => block.blockId === productionRun.resultBlock.blockId);
  assert.equal(completedProductionExecution?.status, 'succeeded');
  assert.equal(completedProductionExecution?.capabilityId, productionDesignCase.capabilityId);
  assert.equal(completedProductionExecution?.skillId, productionDesignCase.skillId);
  assert.ok(productionResultBlock?.data.assetId);
}

console.log(JSON.stringify({
  ok: true,
  capabilityId: completedSkillExecution?.capabilityId,
  frozenSkillSnapshot: true,
  preservedMarkdownAssets: 2,
  productionDesignSkills: productionDesignCases.length,
  providerRoutes: ['openai-compatible', 'google-native'],
}));
