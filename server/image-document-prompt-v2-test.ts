import assert from 'node:assert/strict';
import { createBlockRecord } from '../src/core/blockFactory';
import type { RetakeSkillSnapshot } from '../src/core/skillRegistry';
import type { ExecutionRecord } from '../src/core/types';
import { imageExecutionInputAssignments } from './image-execution-prompt';
import { resolveImageExecutionPrompt } from './image-skill-prompt-resolver';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { resetWorkspace } from './local-store/snapshot-store';

const snapshot = await resetWorkspace();
const characterBibleMarkdown = [
  '# Character Bible',
  '',
  '- Identity anchor: round orange courier cat',
  '- Palette: warm orange, cream, and navy',
  '- Exclusion: no photorealistic fur',
].join('\n');
const documentAsset = await createAssetFromDataUrl({
  projectId: snapshot.project.projectId,
  dataUrl: `data:text/markdown;base64,${Buffer.from(characterBibleMarkdown).toString('base64')}`,
  fileName: 'character-bible.md',
  kind: 'document',
});
snapshot.assets.push(documentAsset);
const documentBlock = createBlockRecord(snapshot, 'document');
documentBlock.data = {
  ...documentBlock.data,
  artifactRevisionId: 'artrev_character_bible_v1',
  artifactType: 'character_bible',
  assetId: documentAsset.assetId,
  documentKind: 'character_bible',
  title: 'Courier Cat Character Bible',
};
const selectedImageAsset = await createAssetFromDataUrl({
  projectId: snapshot.project.projectId,
  dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>').toString('base64')}`,
  fileName: 'selected-character.svg',
  kind: 'image',
});
snapshot.assets.push(selectedImageAsset);
const selectedImageBlock = createBlockRecord(snapshot, 'image');
selectedImageBlock.data = {
  ...selectedImageBlock.data,
  artifactRevisionId: 'artrev_selected_character_v1',
  artifactType: 'character_reference',
  assetId: selectedImageAsset.assetId,
  previewUrl: selectedImageAsset.previewUrl,
  title: 'Selected character direction',
};
snapshot.blocks.push(documentBlock, selectedImageBlock);

const inputBindings = [{
  slotId: 'prompt',
  values: [{
    kind: 'artifact_revision' as const,
    artifactRevisionId: 'artrev_character_bible_v1',
    blockId: documentBlock.blockId,
  }],
}, {
  slotId: 'source_image',
  values: [{
    kind: 'artifact_revision' as const,
    artifactRevisionId: 'artrev_selected_character_v1',
    blockId: selectedImageBlock.blockId,
  }],
}];
const skillSnapshot: RetakeSkillSnapshot = {
  schemaVersion: 1,
  skillId: 'retake.image.ip-concept-directions',
  version: '0.1.0',
  definitionHash: 'sha256:retake-image-ip-concept-directions-v1',
  name: 'IP concept directions',
  description: 'Generate distinct visual directions.',
  category: 'production_design',
  capabilityBindings: [{
    capabilityId: 'image.generate',
    inputSlots: ['prompt', 'source_image', 'references'],
    outputSlots: ['images'],
  }],
  instructionTemplate: 'Preserve the bound character identity while exploring distinct visual directions.',
  outputRequirements: [
    'Return image candidates only.',
    'Do not select an accepted candidate.',
  ],
  source: { kind: 'package', paths: ['README.md'] },
  inputBindings,
};
const execution: ExecutionRecord = {
  executionId: 'exec_image_document_prompt_v2',
  recordVersion: 1,
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  capabilityId: 'image.generate',
  adapter: 'codex_app_server',
  status: 'queued',
  inputBlockIds: [documentBlock.blockId, selectedImageBlock.blockId],
  inputAssetIds: [selectedImageAsset.assetId],
  outputBlockIds: ['block_image_result'],
  outputAssetIds: [],
  skillId: skillSnapshot.skillId,
  skillSnapshot,
  inputBindingsSnapshot: inputBindings,
  prompt: documentBlock.data.title,
  params: {
    inputBindings: [{
      assetId: selectedImageAsset.assetId,
      blockId: selectedImageBlock.blockId,
      inputSlotId: 'source_image',
    }],
    operationBlockId: 'block_image_operation',
  },
  startedAt: '2026-08-02T00:00:00.000Z',
};

const resolved = await resolveImageExecutionPrompt(execution, snapshot);
assert.match(resolved, /Preserve the bound character identity/);
assert.match(resolved, /round orange courier cat/);
assert.match(resolved, /no photorealistic fur/);
assert.match(resolved, /Attached image Artifact Revision: artrev_selected_character_v1/);
assert.doesNotMatch(resolved, /^Courier Cat Character Bible$/);
assert.deepEqual(
  imageExecutionInputAssignments(execution),
  [{ assetId: selectedImageAsset.assetId, inputSlotId: 'source_image' }],
  'The prompt Document stays textual while the selected image remains an attachment.',
);

console.log(JSON.stringify({
  artifactRevisionPrompt: true,
  fullDocumentContentResolved: true,
  imageArtifactBindingDescribed: true,
  promptDocumentExcludedFromImageAttachments: true,
  skillSnapshotApplied: true,
}));
