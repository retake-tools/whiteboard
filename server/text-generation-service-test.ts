import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import {
  createDraftTextGenerationOperation,
  createDraftSkillOperation,
  executeExistingTextGenerationOperation,
  suggestedTextInputSlotId,
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
    outputArtifactType: 'character_bible',
  },
  {
    capabilityId: 'design.scene.define',
    skillId: 'retake.scene-bible.from-screenplay',
    operationTitle: 'Define scenes',
    resultTitle: 'Scene Bible',
    instructionPattern: /Scene Designer/,
    output: '# Scene Bible\n\n## studio_floor\n\nStable zones, lighting, and blocking rules.',
    outputPattern: /spatial logic/i,
    outputArtifactType: 'scene_bible',
  },
] as const;

const productionResultBlockIds = new Map<string, string>();

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
  assert.equal(productionResultBlock?.data.documentKind, productionDesignCase.outputArtifactType);
  productionResultBlockIds.set(productionDesignCase.capabilityId, productionRun.resultBlock.blockId);
}

const screenplayResultBlock = completed.blocks.find((block) => block.blockId === skillRun.resultBlock.blockId);
const characterResultBlockId = productionResultBlockIds.get('design.character.define');
const sceneResultBlockId = productionResultBlockIds.get('design.scene.define');
assert.equal(screenplayResultBlock?.data.documentKind, 'screenplay_master');
assert.ok(characterResultBlockId);
assert.ok(sceneResultBlockId);

const storyboardLabels = {
  operationTitle: 'Generate storyboard plan',
  promptPlaceholder: 'Connect the required production documents.',
  promptTitle: 'Screenplay',
  resultTitle: 'Storyboard Plan',
  waitingBody: 'Waiting for storyboard planning.',
  inputSlots: [
    { slotId: 'screenplay', promptTitle: 'Screenplay', promptPlaceholder: 'Connect the screenplay.' },
    { slotId: 'character_bible', promptTitle: 'Character Bible', promptPlaceholder: 'Connect the Character Bible.' },
    { slotId: 'scene_bible', promptTitle: 'Scene Bible', promptPlaceholder: 'Connect the Scene Bible.' },
  ],
};
const incompleteStoryboardDraft = createDraftSkillOperation(completed, {
  ...storyboardLabels,
  connectionId: readyOpenAIConnection!.connectionId,
  selectedBlockIds: [skillRun.resultBlock.blockId],
  skillId: 'retake.storyboard-plan.from-production-design',
});
assert.deepEqual(
  incompleteStoryboardDraft.inputBlocks.map((block) => block.data.title),
  ['Cat Director', 'Character Bible', 'Scene Bible'],
);
assert.equal(operationReadinessFor(completed, incompleteStoryboardDraft.operationBlock).canRun, false);
assert.deepEqual(
  completed.edges
    .filter((edge) => edge.targetBlockId === incompleteStoryboardDraft.operationBlock.blockId)
    .map((edge) => edge.inputSlotId),
  ['screenplay', 'character_bible', 'scene_bible'],
);

const storyboardDraft = createDraftSkillOperation(completed, {
  ...storyboardLabels,
  connectionId: readyOpenAIConnection!.connectionId,
  selectedBlockIds: [sceneResultBlockId!, skillRun.resultBlock.blockId, characterResultBlockId!],
  skillId: 'retake.storyboard-plan.from-production-design',
});
assert.equal(storyboardDraft.inputBlocks.length, 3);
assert.equal(storyboardDraft.operationBlock.data.capabilityId, 'previs.storyboard.plan');
assert.equal(operationReadinessFor(completed, storyboardDraft.operationBlock).canRun, true);
assert.deepEqual(
  completed.edges
    .filter((edge) => edge.targetBlockId === storyboardDraft.operationBlock.blockId)
    .map((edge) => edge.inputSlotId),
  ['screenplay', 'character_bible', 'scene_bible'],
  'Typed document lineage must win over scrambled canvas selection order.',
);
const reconnectSnapshot = structuredClone(completed);
reconnectSnapshot.edges = reconnectSnapshot.edges.filter((edge) => !(
  edge.sourceBlockId === sceneResultBlockId && edge.targetBlockId === storyboardDraft.operationBlock.blockId
));
const sceneResultBlock = reconnectSnapshot.blocks.find((block) => block.blockId === sceneResultBlockId);
assert.ok(sceneResultBlock);
assert.equal(
  suggestedTextInputSlotId(reconnectSnapshot, storyboardDraft.operationBlock, sceneResultBlock),
  'scene_bible',
  'Manual reconnection must recover the typed slot from artifact lineage.',
);
const storyboardRun = executeExistingTextGenerationOperation(completed, {
  connection: readyOpenAIConnection!,
  labels: storyboardLabels,
  operationBlockId: storyboardDraft.operationBlock.blockId,
});
assert.deepEqual(
  storyboardRun.execution.inputBindingsSnapshot?.map((binding) => binding.slotId),
  ['screenplay', 'character_bible', 'scene_bible'],
);
await saveSnapshot(completed);
const storyboardStarted = await startTextGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: storyboardRun.execution.executionId,
  connectionId: readyOpenAIConnection!.connectionId,
}, {
  generateOpenAICompatible: async (_config, input) => {
    assert.match(input.prompt, /Storyboard Director/);
    assert.match(input.prompt, /## screenplay\n# Cat Director/);
    assert.match(input.prompt, /## character_bible\n# Character Bible/);
    assert.match(input.prompt, /## scene_bible\n# Scene Bible/);
    assert.match(input.prompt, /must not execute units, generate media/i);
    return {
      text: '# Storyboard Plan\n\n## Unit U01\n\n### Shot S01\n\nA traceable opening beat.',
      finishReason: 'stop',
      usage: { inputTokens: 500, outputTokens: 40 },
    };
  },
});
await storyboardStarted.completion;
completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const completedStoryboardExecution = completed.executions.find(
  (execution) => execution.executionId === storyboardRun.execution.executionId,
);
const storyboardResultBlock = completed.blocks.find((block) => block.blockId === storyboardRun.resultBlock.blockId);
assert.equal(completedStoryboardExecution?.status, 'succeeded');
assert.equal(completedStoryboardExecution?.capabilityId, 'previs.storyboard.plan');
assert.equal(completedStoryboardExecution?.skillId, 'retake.storyboard-plan.from-production-design');
assert.equal(storyboardResultBlock?.data.documentKind, 'storyboard_plan');

console.log(JSON.stringify({
  ok: true,
  capabilityId: completedSkillExecution?.capabilityId,
  frozenSkillSnapshot: true,
  preservedMarkdownAssets: 2,
  productionDesignSkills: productionDesignCases.length,
  storyboardPlanSkill: true,
  providerRoutes: ['openai-compatible', 'google-native'],
}));
