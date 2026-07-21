import { createBlockRecord } from '../src/core/blockFactory';
import {
  disabledExecutionInputRolesFor,
  executionInputRoleOptionsFor,
  operationReadinessFor,
} from '../src/core/capabilities';
import {
  createDraftImageToImageOperation,
  createDraftTextToImageOperation,
  executeExistingImageOperationBlock,
  type ImageGenerationParams,
} from '../src/core/imageOperations';
import { createFlowNodes } from '../src/core/flowProjection';
import {
  configurationChanges,
  currentOperationConfiguration,
  executionConfiguration,
  assignExecutionVersion,
} from '../src/core/executionConfiguration';
import { inputRoleDefinition } from '../src/core/inputRoles';
import { attachImportedImageAsset } from '../src/core/imageBlockAsset';
import { restoreExecutionConfiguration } from '../src/core/restoreExecutionConfiguration';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { AssetRecord, BoardSnapshot, ExecutionInputRole } from '../src/core/types';

const snapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
const migratedPromptBlock = snapshot.blocks.find((block) => block.blockId === 'block_brief');
if (migratedPromptBlock?.data.promptRole !== 'operation_prompt') {
  throw new Error('Expected every text input connected to an operation to migrate as an operation prompt');
}
const migratedPromptNode = createFlowNodes(snapshot, {
  selectedOperationBlockId: 'block_operation',
}).find((node) => node.id === 'block_brief');
if (migratedPromptNode?.data.operationInputRolePending) {
  throw new Error('Expected text operation inputs to remain outside the image role workflow');
}
const emptyPromptSnapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
const emptyPromptBlock = emptyPromptSnapshot.blocks.find((block) => block.blockId === 'block_brief');
if (!emptyPromptBlock) throw new Error('Expected default prompt block');
emptyPromptBlock.data.title = '提示词';
emptyPromptBlock.data.body = '';
const emptyPromptOperation = emptyPromptSnapshot.blocks.find((block) => block.blockId === 'block_operation');
if (!emptyPromptOperation) throw new Error('Expected default operation block');
const emptyPromptReadiness = operationReadinessFor(emptyPromptSnapshot, emptyPromptOperation);
if (emptyPromptReadiness.canRun || !emptyPromptReadiness.issues.includes('prompt_empty')) {
  throw new Error('Expected readiness to report an empty prompt before execution');
}
const emptyPromptOperationNode = createFlowNodes(emptyPromptSnapshot).find(
  (node) => node.id === emptyPromptOperation.blockId,
);
if (emptyPromptOperationNode?.data.operationCanRun !== false) {
  throw new Error('Expected empty prompt readiness to project onto the operation node');
}
const draftReadyOperationNode = createFlowNodes(emptyPromptSnapshot, {
  textBlockDrafts: new Map([[emptyPromptBlock.blockId, 'A live prompt draft.']]),
}).find((node) => node.id === emptyPromptOperation.blockId);
if (draftReadyOperationNode?.data.operationCanRun !== true) {
  throw new Error('Expected a live Text Block draft to update operation readiness before persistence');
}
if (emptyPromptBlock.data.body !== '') {
  throw new Error('Expected readiness projection to leave the persisted Text Block body unchanged');
}
let emptyPromptBlocked = false;
try {
  executeExistingImageOperationBlock(emptyPromptSnapshot, {
    operationBlockId: 'block_operation',
    operation: 'text_to_image',
    instruction: '',
  });
} catch (error) {
  emptyPromptBlocked = error instanceof Error && error.message.includes('Enter a prompt');
}
if (!emptyPromptBlocked) throw new Error('Expected an empty prompt body to block execution instead of using its title');

const textDefaultSnapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
const textDefaultDraft = createDraftTextToImageOperation(textDefaultSnapshot, {
  operationTitle: 'Text to image',
  textBlockBody: 'A vertical cinematic frame.',
  textBlockTitle: 'Prompt',
});
const textDefaultParams = textDefaultDraft.operationBlock.data.generationParams as ImageGenerationParams | undefined;
if (
  textDefaultParams?.aspectRatioPreset !== '9:16' ||
  Math.abs((textDefaultParams.targetAspectRatio ?? 0) - 9 / 16) > 0.001
) {
  throw new Error('Expected text-to-image drafts to default to the vertical 9:16 video ratio');
}

const missingImageSnapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
const missingImagePrompt = missingImageSnapshot.blocks.find((block) => block.blockId === 'block_brief');
const missingImageOperation = missingImageSnapshot.blocks.find((block) => block.blockId === 'block_operation');
if (!missingImagePrompt || !missingImageOperation) throw new Error('Expected default workflow blocks');
missingImagePrompt.data.body = 'Edit the source image.';
missingImageOperation.data.capabilityId = 'image.image_to_image';
missingImageOperation.data.operationMode = 'image_to_image';
const missingImageReadiness = operationReadinessFor(missingImageSnapshot, missingImageOperation);
if (!missingImageReadiness.issues.includes('image_input_missing')) {
  throw new Error('Expected image-to-image readiness to require an Image Block');
}
const emptyImageBlock = createBlockRecord(missingImageSnapshot, 'image');
missingImageSnapshot.blocks.push(emptyImageBlock);
missingImageSnapshot.edges.push({
  edgeId: 'edge_empty_source',
  sourceBlockId: emptyImageBlock.blockId,
  targetBlockId: missingImageOperation.blockId,
  kind: 'execution_input',
  inputRole: 'source',
});
const missingAssetReadiness = operationReadinessFor(missingImageSnapshot, missingImageOperation);
if (!missingAssetReadiness.issues.includes('image_asset_missing')) {
  throw new Error('Expected image-to-image readiness to require an imported image asset');
}
emptyImageBlock.data.assetId = 'asset_imported_source';
const importedImageOperationNode = createFlowNodes(missingImageSnapshot).find(
  (node) => node.id === missingImageOperation.blockId,
);
if (importedImageOperationNode?.data.operationCanRun !== true) {
  throw new Error('Expected importing an image asset to immediately make the operation executable');
}
const sourceInputEdge = missingImageSnapshot.edges.find((edge) => edge.edgeId === 'edge_empty_source');
if (!sourceInputEdge) throw new Error('Expected source image input edge');
delete sourceInputEdge.inputRole;
const missingRoleOperationNode = createFlowNodes(missingImageSnapshot).find(
  (node) => node.id === missingImageOperation.blockId,
);
if (
  missingRoleOperationNode?.data.operationCanRun !== false ||
  !missingRoleOperationNode.data.operationReadinessIssues?.includes('source_image_missing')
) {
  throw new Error('Expected clearing the source role to immediately block the operation');
}
sourceInputEdge.inputRole = 'source';
missingImageSnapshot.edges = missingImageSnapshot.edges.filter((edge) => edge.edgeId !== sourceInputEdge.edgeId);
const disconnectedImageOperationNode = createFlowNodes(missingImageSnapshot).find(
  (node) => node.id === missingImageOperation.blockId,
);
if (
  disconnectedImageOperationNode?.data.operationCanRun !== false ||
  !disconnectedImageOperationNode.data.operationReadinessIssues?.includes('image_input_missing')
) {
  throw new Error('Expected removing the image input edge to immediately block the operation');
}
missingImageOperation.data.capabilityId = 'image.text_to_image';
missingImageOperation.data.operationMode = 'text_to_image';
const switchedTextOperationNode = createFlowNodes(missingImageSnapshot).find(
  (node) => node.id === missingImageOperation.blockId,
);
if (switchedTextOperationNode?.data.operationCanRun !== true) {
  throw new Error('Expected switching to text-to-image to immediately apply its input contract');
}

const sourceBlock = addImageBlock(snapshot, 'asset_role_source', 'Source portrait');
const styleBlock = addImageBlock(snapshot, 'asset_role_style', 'Lighting reference');
const pendingBlock = addImageBlock(snapshot, 'asset_role_pending', 'Pending reference');
const draft = createDraftImageToImageOperation(snapshot, {
  operation: 'quick_edit',
  sourceBlockId: sourceBlock.blockId,
  textBlockTitle: 'Prompt',
  textBlockBody: 'Keep the character and use the referenced lighting.',
  operationTitle: 'Image to image',
});
const draftGenerationParams = draft.operationBlock.data.generationParams as ImageGenerationParams | undefined;
if (
  draftGenerationParams?.aspectRatioPreset !== 'source' ||
  Math.abs((draftGenerationParams.targetAspectRatio ?? 0) - sourceBlock.size.width / sourceBlock.size.height) > 0.001
) {
  throw new Error('Expected image-to-image drafts to default to the source image aspect ratio');
}
if (!operationReadinessFor(snapshot, draft.operationBlock).canRun) {
  throw new Error('Expected a complete image-to-image draft to be executable');
}

const styleRoleOptions = executionInputRoleOptionsFor(styleBlock, draft.operationBlock);
for (const requiredRole of [
  'source',
  'character_reference',
  'style_reference',
  'composition_reference',
  'pose_reference',
  'object_reference',
  'environment_reference',
  'general_reference',
] satisfies ExecutionInputRole[]) {
  if (!styleRoleOptions.includes(requiredRole)) throw new Error(`Missing image-to-image role: ${requiredRole}`);
  const definition = inputRoleDefinition(requiredRole);
  if (!definition.titleKey || !definition.descriptionKey || !definition.promptDirective) {
    throw new Error(`Incomplete role definition: ${requiredRole}`);
  }
}

snapshot.edges.push({
  edgeId: 'edge_style_reference',
  sourceBlockId: styleBlock.blockId,
  targetBlockId: draft.operationBlock.blockId,
  kind: 'execution_input',
  inputRole: 'style_reference',
});
const disabledSourceRoles = disabledExecutionInputRolesFor(
  snapshot,
  styleBlock,
  draft.operationBlock,
  'edge_style_reference',
);
if (!disabledSourceRoles.includes('source')) {
  throw new Error('Expected source role to be disabled after one source image is assigned');
}

const execution = executeExistingImageOperationBlock(snapshot, {
  operationBlockId: draft.operationBlock.blockId,
  operation: 'image_to_image',
  instruction: '',
  generationParams: { strength: 0.8, targetAspectRatio: 9 / 16, variationCount: 2 },
});
if (
  execution.resultBlocks.length !== 2 ||
  execution.resultBlocks.some((block) => block.size.width !== 214 || block.size.height !== 380) ||
  execution.resultBlocks[0].position.y !== execution.resultBlocks[1].position.y
) {
  throw new Error('Expected one execution batch to use a uniform 9:16 size and horizontal row layout');
}
const mismatchedSnapshot = structuredClone(snapshot) as BoardSnapshot;
const mismatchedResult = mismatchedSnapshot.blocks.find(
  (block) => block.blockId === execution.resultBlocks[1].blockId,
);
if (!mismatchedResult) throw new Error('Expected second result block');
mismatchedResult.size = { width: 390, height: 558 };
mismatchedResult.position = { ...execution.resultBlocks[0].position };
const repairedSnapshot = migrateBoardSnapshot(mismatchedSnapshot);
const repairedResultBlocks = execution.execution.outputBlockIds.map((blockId) =>
  repairedSnapshot.blocks.find((block) => block.blockId === blockId),
);
if (
  repairedResultBlocks.some((block) => block?.size.width !== 214 || block.size.height !== 380) ||
  repairedResultBlocks[0]?.position.y !== repairedResultBlocks[1]?.position.y
) {
  throw new Error('Expected snapshot migration to repair inconsistent or overlapping execution batches');
}
const inputBindings = execution.execution.params?.inputBindings as Array<{
  blockId: string;
  inputRole: ExecutionInputRole;
}>;
if (
  inputBindings.length !== 2 ||
  !inputBindings.some((binding) => binding.blockId === sourceBlock.blockId && binding.inputRole === 'source') ||
  !inputBindings.some(
    (binding) => binding.blockId === styleBlock.blockId && binding.inputRole === 'style_reference',
  )
) {
  throw new Error('Expected execution input bindings to preserve explicit source and style roles');
}
if (
  execution.prompt.includes('requested edit strength') ||
  !execution.prompt.includes('Authoritative image input contract:') ||
  !execution.prompt.includes('retake_mark_execution_running') ||
  !execution.prompt.includes('[source]') ||
  !execution.prompt.includes('[style_reference]')
) {
  throw new Error('Expected role-aware prompt contract without generic Strength');
}
if (
  execution.execution.operationVersion !== undefined ||
  !execution.execution.configurationFingerprint ||
  execution.execution.configuration?.imageInputs.length !== 2 ||
  execution.execution.configuration.schemaVersion !== 1 ||
  execution.execution.configuration.parameters?.find((parameter) => parameter.key === 'variationCount')?.valueType !== 'integer' ||
  execution.execution.configuration.parameters?.find((parameter) => parameter.key === 'targetAspectRatio')?.semantic !== 'width_height_ratio'
) {
  throw new Error('Expected a queued execution to preserve configuration without consuming a version');
}
if (
  execution.execution.capabilityLock?.capabilityId !== 'image.image_to_image' ||
  execution.execution.capabilityLock.definitionHash !== 'legacy:image.image_to_image:schema-v1' ||
  execution.execution.adapterSnapshot?.adapterId !== 'codex-managed' ||
  execution.execution.adapterSnapshot.routeKind !== 'mcp_manual' ||
  execution.execution.inputBindingsSnapshot?.find((binding) => binding.slotId === 'prompt')?.values[0]?.kind !== 'block' ||
  execution.execution.inputBindingsSnapshot?.find((binding) => binding.slotId === 'source_image')?.values[0]?.kind !== 'asset' ||
  execution.execution.inputBindingsSnapshot?.find((binding) => binding.slotId === 'references')?.values[0]?.kind !== 'asset' ||
  execution.execution.outputSlotResults?.[0]?.slotId !== 'images' ||
  execution.execution.resultSummary?.requested !== 2 ||
  execution.execution.resultSummary.succeeded !== 0
) {
  throw new Error('Expected the queued execution to preserve the V0 named-slot contract snapshot');
}
const queuedGroupNode = createFlowNodes(snapshot).find(
  (node) => node.data.groupExecutionId === execution.execution.executionId,
);
if (queuedGroupNode?.data.executionVersion !== undefined || queuedGroupNode?.data.executionStatus !== 'queued') {
  throw new Error('Expected queued result Groups to remain unversioned until execution starts');
}
const initialPrompt = draft.textBlock.data.body;
draft.textBlock.data.body = 'Change the first prompt before Codex starts.';
const initialQueuedEditNode = createFlowNodes(snapshot).find(
  (node) => node.id === draft.operationBlock.blockId,
);
if (
  initialQueuedEditNode?.data.operationChangeCount !== 0 ||
  initialQueuedEditNode.data.operationQueuedConfigurationStale !== true
) {
  throw new Error('Expected first-run queued edits to invalidate the prompt without creating version changes');
}
draft.textBlock.data.body = initialPrompt;
const refreshedInitialQueuedNode = createFlowNodes(snapshot).find(
  (node) => node.id === draft.operationBlock.blockId,
);
if (refreshedInitialQueuedNode?.data.operationQueuedConfigurationStale) {
  throw new Error('Expected restoring the queued configuration to clear prompt invalidation');
}
assignExecutionVersion(snapshot, execution.execution);
execution.execution.status = 'running';
if (execution.execution.operationVersion !== 1 || execution.execution.previousExecutionId !== undefined) {
  throw new Error('Expected the first running execution to receive V1');
}
const upgradedParameterConfiguration = structuredClone(execution.execution.configuration);
const upgradedAspectRatio = upgradedParameterConfiguration.parameters?.find(
  (parameter) => parameter.key === 'targetAspectRatio',
);
if (!upgradedAspectRatio) throw new Error('Expected target aspect ratio parameter metadata');
upgradedAspectRatio.schemaVersion = 2;
upgradedAspectRatio.valueType = 'string';
const parameterSchemaChanges = configurationChanges(
  executionConfiguration(execution.execution),
  upgradedParameterConfiguration,
);
const parameterSchemaChange = parameterSchemaChanges.find(
  (change) => change.kind === 'parameter' && change.key === 'targetAspectRatio',
);
if (
  parameterSchemaChange?.previousParameter?.schemaVersion !== 1 ||
  parameterSchemaChange.currentParameter?.schemaVersion !== 2 ||
  parameterSchemaChange.currentParameter.valueType !== 'string'
) {
  throw new Error('Expected parameter schema and value-type upgrades to remain visible in configuration diffs');
}

draft.textBlock.data.body = 'Keep the character, but switch to a cinematic night palette.';
const modifiedOperationNode = createFlowNodes(snapshot).find(
  (node) => node.id === draft.operationBlock.blockId,
);
if (
  modifiedOperationNode?.data.operationChangeCount !== 1 ||
  !modifiedOperationNode.data.operationChangeKinds?.includes('prompt') ||
  modifiedOperationNode.data.operationQueuedConfigurationStale
) {
  throw new Error('Expected prompt edits to project as a visible operation configuration change');
}

const rerun = executeExistingImageOperationBlock(snapshot, {
  operationBlockId: draft.operationBlock.blockId,
  operation: 'image_to_image',
  instruction: '',
  generationParams: { targetAspectRatio: 1, variationCount: 2 },
});
if (rerun.execution.operationVersion !== undefined) {
  throw new Error('Expected rerun to remain unversioned while queued');
}
assignExecutionVersion(snapshot, rerun.execution);
rerun.execution.status = 'running';
const firstBatchBottom = Math.max(
  ...execution.resultBlocks.map((block) => block.position.y + block.size.height),
);
if (
  rerun.resultBlocks.some((block) => execution.execution.outputBlockIds.includes(block.blockId)) ||
  rerun.resultBlocks.some((block) => block.position.y <= firstBatchBottom)
) {
  throw new Error('Expected reruns to preserve prior results and start a new execution row');
}
const rerunChanges = configurationChanges(
  executionConfiguration(execution.execution),
  executionConfiguration(rerun.execution),
);
if (
  rerun.execution.operationVersion !== 2 ||
  rerun.execution.previousExecutionId !== execution.execution.executionId ||
  !rerunChanges.some((change) => change.kind === 'prompt') ||
  !rerunChanges.some((change) => change.kind === 'parameter' && change.key === 'targetAspectRatio')
) {
  throw new Error('Expected reruns to link versions and preserve detailed prompt and parameter changes');
}
const rerunGroupNode = createFlowNodes(snapshot).find(
  (node) => node.data.groupExecutionId === rerun.execution.executionId,
);
if (
  rerunGroupNode?.data.executionVersion !== 2 ||
  !rerunGroupNode.data.executionChangeKinds?.includes('prompt') ||
  !rerunGroupNode.data.executionChangeKinds?.includes('parameter')
) {
  throw new Error('Expected the result Group to project its execution version and change summary');
}

const restoreSnapshot = structuredClone(snapshot) as BoardSnapshot;
const restoreOperation = restoreSnapshot.blocks.find((block) => block.blockId === draft.operationBlock.blockId);
if (!restoreOperation) throw new Error('Expected operation block for configuration restore');
restoreOperation.data.status = 'succeeded';
restoreSnapshot.blocks = restoreSnapshot.blocks.filter((block) => block.blockId !== styleBlock.blockId);
restoreSnapshot.edges = restoreSnapshot.edges.filter((edge) => edge.sourceBlockId !== styleBlock.blockId);
const restoreResult = restoreExecutionConfiguration(restoreSnapshot, execution.execution.executionId);
const restoredPromptBlock = restoreSnapshot.blocks.find(
  (block) => block.blockId === draft.textBlock.blockId && block.type === 'text',
);
const restoredImageEdges = restoreSnapshot.edges.filter(
  (edge) => edge.targetBlockId === draft.operationBlock.blockId && edge.kind === 'execution_input' && edge.inputRole,
);
if (
  !restoreResult.restored ||
  restoredPromptBlock?.data.body !== execution.execution.prompt ||
  restoredImageEdges.length !== 2 ||
  !restoredImageEdges.some((edge) => edge.inputRole === 'source') ||
  !restoredImageEdges.some((edge) => edge.inputRole === 'style_reference') ||
  restoreOperation.data.generationParams?.targetAspectRatio !== 9 / 16 ||
  restoreSnapshot.historyEvents?.[0]?.type !== 'configuration_restored'
) {
  throw new Error('Expected restoring a version to recover prompt, missing inputs, roles, params, and history');
}
const restoredOperationNode = createFlowNodes(restoreSnapshot).find(
  (node) => node.id === draft.operationBlock.blockId,
);
if (!restoredOperationNode?.data.operationChangeCount) {
  throw new Error('Expected restored historical configuration to remain a visible draft change from the latest execution');
}
const activeRestoreSnapshot = structuredClone(restoreSnapshot) as BoardSnapshot;
const activeRestoreOperation = activeRestoreSnapshot.blocks.find(
  (block) => block.blockId === draft.operationBlock.blockId,
);
if (!activeRestoreOperation) throw new Error('Expected active operation block');
activeRestoreOperation.data.status = 'running';
if (restoreExecutionConfiguration(activeRestoreSnapshot, execution.execution.executionId).restored) {
  throw new Error('Expected active operations to reject configuration restore');
}

snapshot.edges.push({
  edgeId: 'edge_pending_reference',
  sourceBlockId: pendingBlock.blockId,
  targetBlockId: draft.operationBlock.blockId,
  kind: 'execution_input',
});
let pendingRoleBlocked = false;
try {
  executeExistingImageOperationBlock(snapshot, {
    operationBlockId: draft.operationBlock.blockId,
    operation: 'image_to_image',
    instruction: '',
  });
} catch (error) {
  pendingRoleBlocked = error instanceof Error && error.message.includes('Choose an input role');
}
if (!pendingRoleBlocked) throw new Error('Expected an asset-backed pending image role to block execution');
const pendingRoleReadiness = operationReadinessFor(snapshot, draft.operationBlock);
if (!pendingRoleReadiness.issues.includes('image_role_missing')) {
  throw new Error('Expected readiness to report an unassigned image role');
}

const replacementSnapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
const replaceableBlock = createBlockRecord(replacementSnapshot, 'image');
replaceableBlock.data.assetId = 'asset_before_replace';
replaceableBlock.data.title = 'Before.png';
replaceableBlock.data.annotationDraft = {
  schemaVersion: 1,
  sourceAssetId: 'asset_before_replace',
  globalInstruction: '',
  marks: [{
    id: 'M1',
    kind: 'marker',
    color: '#dc2626',
    strokeSize: 'm',
    intent: 'Replace this point.',
    point: { x: 0.5, y: 0.5 },
  }],
  updatedAt: '2026-07-11T00:59:00.000Z',
};
replacementSnapshot.blocks.push(replaceableBlock);
const originalReplacementAsset = createTestAsset(replacementSnapshot, 'asset_before_replace');
const nextReplacementAsset = createTestAsset(replacementSnapshot, 'asset_after_replace');
nextReplacementAsset.width = 800;
nextReplacementAsset.height = 1200;
replacementSnapshot.assets.push(originalReplacementAsset);
const replacementDraft = createDraftImageToImageOperation(replacementSnapshot, {
  operation: 'quick_edit',
  sourceBlockId: replaceableBlock.blockId,
  textBlockTitle: 'Prompt',
  textBlockBody: 'Use the replaced portrait source.',
  operationTitle: 'Image to image',
});
const replacement = attachImportedImageAsset(replacementSnapshot, {
  asset: nextReplacementAsset,
  blockId: replaceableBlock.blockId,
  fileName: 'After.png',
  updatedAt: '2026-07-11T01:00:00.000Z',
});
if (
  !replacement.changed ||
  replacement.previousAssetId !== originalReplacementAsset.assetId ||
  replaceableBlock.data.assetId !== nextReplacementAsset.assetId ||
  replaceableBlock.data.annotationDraft !== undefined ||
  !replacementSnapshot.assets.some((asset) => asset.assetId === originalReplacementAsset.assetId) ||
  replacementSnapshot.historyEvents?.[0]?.type !== 'asset_replaced'
) {
  throw new Error('Expected replacing an input image to preserve the old Asset and append replacement history');
}
const replacementConfiguration = currentOperationConfiguration(
  replacementSnapshot,
  replacementDraft.operationBlock,
);
const replacementOperationNode = createFlowNodes(replacementSnapshot).find(
  (node) => node.id === replacementDraft.operationBlock.blockId,
);
if (
  replacementConfiguration.generationParams.aspectRatioPreset !== 'source' ||
  Math.abs(Number(replacementConfiguration.generationParams.targetAspectRatio) - 2 / 3) > 0.001 ||
  Math.abs(Number(replacementOperationNode?.data.operationSourceAspectRatio) - 2 / 3) > 0.001
) {
  throw new Error('Expected replacing the source image to refresh the effective source aspect ratio');
}
const managedResultBlock = createBlockRecord(replacementSnapshot, 'image');
managedResultBlock.data.sourceExecutionId = 'exec_managed_result';
replacementSnapshot.blocks.push(managedResultBlock);
if (attachImportedImageAsset(replacementSnapshot, {
  asset: nextReplacementAsset,
  blockId: managedResultBlock.blockId,
  fileName: 'Blocked.png',
  updatedAt: '2026-07-11T01:01:00.000Z',
}).changed) {
  throw new Error('Expected managed Result Blocks to reject direct asset replacement');
}

console.log(
  JSON.stringify(
    {
      disabledSourceRole: true,
      emptyPromptBlocked,
      emptyPromptReadiness: true,
      livePromptReadiness: true,
      imageAssetReadiness: true,
      imageInputReadiness: true,
      readinessTransitions: {
        assetImport: true,
        capabilitySwitch: true,
        edgeRemoval: true,
        roleChange: true,
      },
      inputBindings,
      resultBatchLayout: 'horizontal_rows',
      legacyBatchLayoutRepaired: true,
      rerunPreservedPriorBatch: true,
      executionConfigurationVersions: true,
      queuedExecutionUnversioned: true,
      initialQueuedChangesHidden: true,
      parameterSchemaEvolution: true,
      inputImageReplacementHistory: true,
      sourceAspectRatioDefault: true,
      sourceAspectRatioRefresh: true,
      textToImageVerticalDefault: true,
      operationChangeProjection: true,
      configurationRestore: true,
      activeConfigurationRestoreBlocked: true,
      migratedOperationPrompt: true,
      textInputRoleIgnored: true,
      pendingRoleBlocked,
      pendingRoleReadiness: true,
      promptHasReferenceContract: true,
      strengthRemoved: true,
    },
    null,
    2,
  ),
);

function addImageBlock(snapshot: BoardSnapshot, assetId: string, title: string) {
  const block = createBlockRecord(snapshot, 'image');
  block.data.title = title;
  block.data.assetId = assetId;
  snapshot.blocks.push(block);
  const asset: AssetRecord = {
    assetId,
    projectId: snapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local',
    storageKey: `assets/${assetId}/original.png`,
    previewUrl: `/api/local/assets/${snapshot.project.projectId}/${assetId}/original.png`,
    createdAt: new Date().toISOString(),
  };
  snapshot.assets.push(asset);
  return block;
}

function createTestAsset(snapshot: BoardSnapshot, assetId: string): AssetRecord {
  return {
    assetId,
    projectId: snapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local',
    storageKey: `assets/${assetId}/original.png`,
    previewUrl: `/api/local/assets/${snapshot.project.projectId}/${assetId}/original.png`,
    width: 1200,
    height: 800,
    createdAt: '2026-07-11T00:00:00.000Z',
  };
}
