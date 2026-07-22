import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  listPackageComposerMentionOptions,
  resolvePackageComposerInvocation,
  type PackageComposerInvocation,
} from '../src/core/packageComposer';
import { createDraftSkillOperation, type TextGenerationLabels } from '../src/core/textOperations';
import { skillUiDefinitionFor } from '../src/core/skillRegistry';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { resetWorkspace } from './local-store/snapshot-store';

const [composerSource, toolbarSource, controllerSource] = await Promise.all([
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/FloatingToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/usePackageEntryPointController.ts', import.meta.url), 'utf8'),
]);
assert.match(toolbarSource, /SkillQuickInputComposer/);
assert.match(composerSource, /trailingTriggerQuery\(value, '\/'\)/);
assert.match(composerSource, /trailingTriggerQuery\(value, '@'\)/);
assert.match(composerSource, /data-mention-id/);
assert.match(composerSource, /selectEntryPoint\(registration\)/);
assert.match(composerSource, /onInvokeEntryPoint\(invocation\)/);
assert.match(controllerSource, /resolvePackageComposerInvocation/);
assert.equal(composerSource.includes('AgentRun'), false);
assert.equal(
  skillUiDefinitionFor('retake.screenplay.normalize').inputSlots?.find((slot) => slot.slotId === 'normalization_instruction')?.inputKey,
  'skill.normalizeScreenplay.instructionInput',
);

const snapshot = await emptySnapshot();
const brief = textBlock(snapshot, 'block_brief', 'Creative Brief', 'A courier cat must cross the city before sunrise.');
const screenplay = documentBlock(snapshot, 'block_screenplay', 'Screenplay', 'screenplay_master', 'asset_screenplay');
const character = documentBlock(snapshot, 'block_character', 'Character Bible', 'character_bible', 'asset_character');
const scene = documentBlock(snapshot, 'block_scene', 'Scene Bible', 'scene_bible', 'asset_scene');
snapshot.blocks.push(brief, screenplay, character, scene);
snapshot.assets.push(documentAsset(snapshot, 'asset_screenplay'), documentAsset(snapshot, 'asset_character'), documentAsset(snapshot, 'asset_scene'));

const normalizeOptions = listPackageComposerMentionOptions(snapshot, 'skill:retake.screenplay.normalize');
assert.equal(normalizeOptions.some((option) => option.kind === 'block' && option.blockId === screenplay.blockId && option.slotId === 'source_screenplay'), true);
const storyboardOptions = listPackageComposerMentionOptions(snapshot, 'skill:retake.storyboard-plan.from-production-design');
assert.equal(storyboardOptions.some((option) => option.kind === 'block' && option.blockId === character.blockId && option.slotId === 'character_bible'), true);
assert.equal(storyboardOptions.some((option) => option.kind === 'block' && option.blockId === scene.blockId && option.slotId === 'scene_bible'), true);

const generateInvocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: 'skill:retake.screenplay.from-brief',
  instruction: 'A cat must deliver the final reel before sunrise.',
  mentions: [],
});
assert.equal(generateInvocation.target.kind, 'skill');
assert.equal(generateInvocation.instructionSlotId, 'brief');

const normalizeInvocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: 'skill:retake.screenplay.normalize',
  instruction: 'Keep every event, but organize the scene headings.',
  mentions: [{ kind: 'block', blockId: screenplay.blockId, slotId: 'source_screenplay' }],
});
assert.equal(normalizeInvocation.target.kind, 'skill');
assert.equal(normalizeInvocation.instructionSlotId, 'normalization_instruction');
assert.ok(normalizeInvocation.target.kind === 'skill');
const normalizeDraft = createDraftSkillOperation(snapshot, {
  ...labelsForSkill('retake.screenplay.normalize'),
  skillId: normalizeInvocation.target.entrypoint.ref.skillId,
  explicitInputBindings: normalizeInvocation.invocation.mentions.map((mention) => mention.kind === 'block'
    ? { kind: 'block' as const, blockId: mention.blockId, inputSlotId: mention.slotId }
    : { kind: 'asset' as const, assetId: mention.assetId, inputSlotId: mention.slotId }),
  initialText: normalizeInvocation.instructionSlotId
    ? { body: normalizeInvocation.invocation.instruction, inputSlotId: normalizeInvocation.instructionSlotId }
    : undefined,
});
const normalizeEdges = snapshot.edges.filter((edge) => edge.targetBlockId === normalizeDraft.operationBlock.blockId);
assert.deepEqual(normalizeEdges.map((edge) => edge.inputSlotId).sort(), ['normalization_instruction', 'source_screenplay']);
assert.equal(normalizeDraft.inputBlocks.some((block) => block.data.body === 'Keep every event, but organize the scene headings.'), true);

const assetInvocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: 'skill:retake.character-bible.from-screenplay',
  instruction: '',
  mentions: [{ kind: 'asset', assetId: 'asset_screenplay', slotId: 'screenplay' }],
});
assert.ok(assetInvocation.target.kind === 'skill');
const assetDraft = createDraftSkillOperation(snapshot, {
  ...labelsForSkill('retake.character-bible.from-screenplay'),
  skillId: assetInvocation.target.entrypoint.ref.skillId,
  explicitInputBindings: [{ kind: 'asset', assetId: 'asset_screenplay', inputSlotId: 'screenplay' }],
});
assert.equal(assetDraft.inputBlocks.some((block) => block.type === 'document' && block.data.assetId === 'asset_screenplay'), true);

const workflowInvocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  instruction: 'A detective cat solves the case before the last train.',
  mentions: [],
});
assert.ok(workflowInvocation.target.kind === 'workflow');
const workflowSnapshot = await emptySnapshot();
const textProjection = projectWorkflowDraft(workflowSnapshot, {
  workflowId: workflowInvocation.target.entrypoint.ref.workflowDefinitionId,
  workflowTitle: 'Story to storyboard plan',
  outputPlaceholder: 'Waiting.',
  labelsForSkill,
  connectionIdForCapability: () => 'codex-app-server',
  composerInput: {
    mentions: [],
    instruction: workflowInvocation.instructionSlotId
      ? { body: workflowInvocation.invocation.instruction, slotId: workflowInvocation.instructionSlotId }
      : undefined,
  },
});
const projectedBrief = workflowSnapshot.blocks.find((block) => block.blockId === textProjection.workflowInputBlockIds[0]);
assert.equal(projectedBrief?.data.body, 'A detective cat solves the case before the last train.');

const mentionWorkflowSnapshot = await emptySnapshot();
const sourceBrief = textBlock(mentionWorkflowSnapshot, 'block_source_brief', 'Source Brief', 'A rescue cat reaches the lighthouse.');
mentionWorkflowSnapshot.blocks.push(sourceBrief);
const mentionProjection = projectWorkflowDraft(mentionWorkflowSnapshot, {
  workflowId: 'retake.workflow.story-to-storyboard',
  workflowTitle: 'Story to storyboard plan',
  outputPlaceholder: 'Waiting.',
  labelsForSkill,
  connectionIdForCapability: () => 'codex-app-server',
  composerInput: {
    instruction: undefined,
    mentions: [{ kind: 'block', blockId: sourceBrief.blockId, slotId: 'brief' }],
  },
});
const projectedMention = mentionWorkflowSnapshot.blocks.find((block) => block.blockId === mentionProjection.workflowInputBlockIds[0]);
assert.equal(projectedMention?.data.body, sourceBrief.data.body);
assert.equal(projectedMention?.data.composerSourceBlockId, sourceBrief.blockId);
assert.equal(mentionWorkflowSnapshot.executions.length, 0);

assert.throws(() => resolvePackageComposerInvocation(snapshot, {
  entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  instruction: 'This cannot silently become a second Workflow input.',
  mentions: [{ kind: 'block', blockId: brief.blockId, slotId: 'brief' }],
}), /instruction has no compatible input slot/);
assert.throws(() => resolvePackageComposerInvocation(snapshot, {
  entrypointId: 'skill:retake.screenplay.normalize',
  instruction: '',
  mentions: [
    { kind: 'block', blockId: brief.blockId, slotId: 'source_screenplay' },
    { kind: 'block', blockId: brief.blockId, slotId: 'normalization_instruction' },
  ],
}), /source cannot bind multiple input slots/);

console.log(JSON.stringify({
  ok: true,
  slashSelectsTypedEntryPoint: true,
  mentionBindingsAreSlotExplicit: true,
  documentAssetMentionProjected: true,
  instructionPopulatesSkillInput: true,
  instructionPopulatesWorkflowInput: true,
  workflowDoesNotCreateExecution: true,
  workflowInputConflictRejected: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const value = await resetWorkspace();
  value.blocks = [];
  value.edges = [];
  value.assets = [];
  value.executions = [];
  value.workflowRuns = [];
  value.workflowStepRuns = [];
  value.historyEvents = [];
  return value;
}

function textBlock(snapshot: BoardSnapshot, blockId: string, title: string, body: string): BlockRecord {
  return {
    blockId,
    boardId: snapshot.board.boardId,
    type: 'text',
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { width: 260, height: 170 },
    zIndex: 1,
    data: { title, body },
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function documentBlock(
  snapshot: BoardSnapshot,
  blockId: string,
  title: string,
  documentKind: string,
  assetId: string,
): BlockRecord {
  return {
    ...textBlock(snapshot, blockId, title, ''),
    type: 'document',
    data: { title, documentKind, assetId },
  };
}

function documentAsset(snapshot: BoardSnapshot, assetId: string): AssetRecord {
  return {
    assetId,
    projectId: snapshot.project.projectId,
    kind: 'document',
    mimeType: 'text/markdown',
    storageProvider: 'local',
    storageKey: `assets/${assetId}/document.md`,
    previewUrl: `/api/local/assets/${snapshot.project.projectId}/${assetId}/document.md`,
    createdAt: '2026-07-22T00:00:00.000Z',
  };
}

function labelsForSkill(skillId: string): TextGenerationLabels {
  const slotLabels: Record<string, TextGenerationLabels['inputSlots']> = {
    'retake.screenplay.from-brief': [{ slotId: 'brief', promptTitle: 'Brief', promptPlaceholder: 'Enter brief.' }],
    'retake.screenplay.normalize': [
      { slotId: 'source_screenplay', promptTitle: 'Source screenplay', promptPlaceholder: 'Connect screenplay.' },
      { slotId: 'normalization_instruction', promptTitle: 'Instruction', promptPlaceholder: 'Describe organization.' },
    ],
    'retake.character-bible.from-screenplay': [{ slotId: 'screenplay', promptTitle: 'Screenplay', promptPlaceholder: 'Connect screenplay.' }],
    'retake.scene-bible.from-screenplay': [{ slotId: 'screenplay', promptTitle: 'Screenplay', promptPlaceholder: 'Connect screenplay.' }],
    'retake.storyboard-plan.from-production-design': [
      { slotId: 'screenplay', promptTitle: 'Screenplay', promptPlaceholder: 'Connect screenplay.' },
      { slotId: 'character_bible', promptTitle: 'Character Bible', promptPlaceholder: 'Connect Character Bible.' },
      { slotId: 'scene_bible', promptTitle: 'Scene Bible', promptPlaceholder: 'Connect Scene Bible.' },
    ],
  };
  return {
    inputSlots: slotLabels[skillId],
    operationTitle: skillId,
    promptTitle: 'Input',
    promptPlaceholder: 'Enter input.',
    resultTitle: 'Result',
    waitingBody: 'Waiting.',
  };
}
