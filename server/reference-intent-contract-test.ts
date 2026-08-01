import { strict as assert } from 'node:assert';
import { createBlockRecord } from '../src/core/blockFactory';
import { getExecutionDetailContextForExecution } from '../src/components/ExecutionDetailContent';
import { toggleReferenceSuggestion } from '../src/components/ReferenceIntentEditor';
import { operationReadinessFor } from '../src/core/capabilities';
import {
  configurationChanges,
  currentOperationConfiguration,
  executionConfiguration,
} from '../src/core/executionConfiguration';
import { createFlowNodes } from '../src/core/flowProjection';
import {
  createDraftImageToImageOperation,
  executeExistingImageOperationBlock,
} from '../src/core/imageOperations';
import { createReferenceIntent } from '../src/core/referenceIntent';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { BoardSnapshot } from '../src/core/types';

const snapshot = migrateBoardSnapshot(
  structuredClone(defaultSnapshot) as BoardSnapshot,
);
const source = addImage(snapshot, 'asset_reference_source', 'Source');
const reference = addImage(snapshot, 'asset_reference_light', 'Light reference');
const draft = createDraftImageToImageOperation(snapshot, {
  operation: 'quick_edit',
  operationTitle: 'Image edit',
  sourceBlockId: source.blockId,
  textBlockBody: 'Keep the subject and use the reference lighting.',
  textBlockTitle: 'Prompt',
});
const sourceEdge = snapshot.edges.find(
  (edge) => edge.sourceBlockId === source.blockId
    && edge.targetBlockId === draft.operationBlock.blockId,
);
assert.equal(sourceEdge?.inputSlotId, 'source_image');

const lightIntent = createReferenceIntent(
  '参考色彩、光线与氛围',
  'preset',
  '色彩光影',
);
assert.ok(lightIntent);
snapshot.edges.push({
  edgeId: 'edge_reference_light',
  inputSlotId: 'references',
  kind: 'execution_input',
  referenceIntent: lightIntent,
  sourceBlockId: reference.blockId,
  targetBlockId: draft.operationBlock.blockId,
});
assert.equal(operationReadinessFor(snapshot, draft.operationBlock).canRun, true);

const operationNode = createFlowNodes(snapshot).find(
  (node) => node.id === draft.operationBlock.blockId,
);
assert.deepEqual(
  operationNode?.data.operationReferenceInputs?.map((input) => ({
    bindingKind: input.bindingKind,
    label: input.referenceIntent?.label,
    slot: input.inputSlotId,
  })),
  [
    { bindingKind: 'source', label: undefined, slot: 'source_image' },
    { bindingKind: 'reference', label: '色彩光影', slot: 'references' },
  ],
);

const before = currentOperationConfiguration(snapshot, draft.operationBlock);
snapshot.edges.find(
  (edge) => edge.edgeId === 'edge_reference_light',
)!.referenceIntent = createReferenceIntent(
  '只参考冷暖对比，不参考构图',
  'user',
  '冷暖对比',
);
const after = currentOperationConfiguration(snapshot, draft.operationBlock);
assert.ok(
  configurationChanges(before, after).some(
    (change) => change.kind === 'input' && change.blockId === reference.blockId,
  ),
);

const execution = executeExistingImageOperationBlock(snapshot, {
  instruction: '',
  operation: 'image_to_image',
  operationBlockId: draft.operationBlock.blockId,
});
const bindings = execution.execution.params?.inputBindings as Array<{
  inputSlotId?: string;
  referenceIntent?: { label?: string };
}>;
assert.deepEqual(
  bindings.map((binding) => binding.inputSlotId),
  ['source_image', 'references'],
);
assert.equal(bindings[1]?.referenceIntent?.label, '冷暖对比');
assert.deepEqual(
  execution.execution.inputBindingsSnapshot?.map((binding) => binding.slotId),
  ['prompt', 'source_image', 'references'],
);
assert.equal(
  execution.execution.inputBindingsSnapshot?.find((binding) => binding.slotId === 'references')
    ?.values[0]?.referenceIntent?.label,
  '冷暖对比',
);
assert.equal(
  createFlowNodes(snapshot).find(
    (node) => node.id === draft.operationBlock.blockId,
  )?.data.operationReferenceInputs?.every((input) => !input.editable),
  true,
);
draft.operationBlock.data.status = 'succeeded';
assert.equal(
  createFlowNodes(snapshot).find(
    (node) => node.id === draft.operationBlock.blockId,
  )?.data.operationReferenceInputs?.every((input) => input.editable),
  true,
);
assert.deepEqual(
  executionConfiguration(execution.execution).imageInputs.map(
    (input) => input.inputSlotId,
  ).sort(),
  ['references', 'source_image'],
);
assert.equal(
  getExecutionDetailContextForExecution(
    snapshot,
    execution.execution,
  ).inputImages.find((input) => input.inputSlotId === 'references')
    ?.referenceIntent?.instruction,
  '只参考冷暖对比，不参考构图',
);

const presetSetting = toggleReferenceSuggestion(
  { instruction: '保留自定义要求', mode: 'reference' },
  '参考色彩、光线与氛围',
);
assert.equal(presetSetting.instruction, '保留自定义要求；参考色彩、光线与氛围');
assert.deepEqual(
  toggleReferenceSuggestion(presetSetting, '参考色彩、光线与氛围'),
  { instruction: '保留自定义要求', mode: 'reference' },
);
assert.deepEqual(
  toggleReferenceSuggestion(
    { instruction: '参考色彩、光线与氛围', mode: 'reference' },
    '参考色彩、光线与氛围',
  ),
  { instruction: '', mode: 'auto' },
);

console.log('reference intent contract: ok');

function addImage(
  target: BoardSnapshot,
  assetId: string,
  title: string,
) {
  const block = createBlockRecord(target, 'image');
  block.data.assetId = assetId;
  block.data.title = title;
  target.blocks.push(block);
  target.assets.push({
    assetId,
    createdAt: new Date().toISOString(),
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: `data:image/png;base64,${assetId}`,
    projectId: target.project.projectId,
    storageKey: `${assetId}.png`,
    storageProvider: 'local',
  });
  return block;
}
