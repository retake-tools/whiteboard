import assert from 'node:assert/strict';
import {
  projectAgentCallableCapabilities,
} from '../src/core/agentCallableCapabilities';
import type { CapabilityDefinition } from '../src/core/capabilityContracts';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import { stageAgentOperationExecution } from '../src/core/agentOperationExecution';
import { createBlockRecord } from '../src/core/blockFactory';
import { operationReadinessFor } from '../src/core/capabilities';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import { imageGenerateCapabilityId } from '../src/core/imageGenerateContracts';
import { executeExistingImageOperationBlock } from '../src/core/imageOperations';
import {
  replacePluginCapabilityDefinitions,
} from '../src/core/pluginCapabilityDefinitions';
import type { BoardSnapshot } from '../src/core/types';
import { resetWorkspace } from './local-store/snapshot-store';
import {
  agentRuntimeDecisionSchemaFor,
  parseAgentRuntimeDecision,
} from './agent-runtime-port';
import { loadAgentCallableCapabilities } from './agent-callable-capability-catalog';

const referenceEditDefinition = imageCapability({
  capabilityId: 'image.reference_edit_fixture',
  displayName: 'Reference image edit fixture',
  inputSlots: [
    imageSlot('source_image', 'source', true),
    imageSlot('guidance_image', 'guidance', false),
    promptSlot(),
  ],
});
const maskedEditDefinition = imageCapability({
  capabilityId: 'image.masked_edit',
  displayName: 'Masked image edit',
  inputSlots: [
    imageSlot('source_image', 'source', true),
    imageSlot('inpaint_mask', 'inpaint_mask', true),
    promptSlot(),
  ],
});
const localCropDefinition = imageCapability({
  capabilityId: 'image.local_crop',
  displayName: 'Local image crop',
  inputSlots: [imageSlot('source_image', 'source', true)],
  supportedAdapterClasses: ['local_canvas'],
});

const catalog = projectAgentCallableCapabilities([
  capabilityDefinitionFor(imageGenerateCapabilityId),
  referenceEditDefinition,
  maskedEditDefinition,
  localCropDefinition,
]);
assert.deepEqual(
  catalog.map((capability) => capability.capabilityId),
  ['image.generate', 'image.reference_edit_fixture'],
);
assert.equal(
  catalog.find((capability) => capability.capabilityId === imageGenerateCapabilityId)?.authoringKind,
  'image_generate',
);
assert.equal(
  catalog.find((capability) => capability.capabilityId === 'image.reference_edit_fixture')?.authoringKind,
  'source_image_edit',
);
assert.deepEqual(
  agentRuntimeDecisionSchemaFor(catalog).properties.capabilityId.enum,
  ['image.generate', 'image.reference_edit_fixture', null],
);
const installedCatalog = await loadAgentCallableCapabilities();
assert.equal(
  installedCatalog.some((capability) => capability.capabilityId === imageGenerateCapabilityId),
  true,
);
assert.equal(
  installedCatalog.some((capability) => (
    capability.capabilityId === 'image.text_to_image'
    || capability.capabilityId === 'image.image_to_image'
  )),
  false,
);
assert.equal(
  installedCatalog.some((capability) => capability.capabilityId === 'image.guided_edit'),
  false,
);
assert.equal(
  installedCatalog.some((capability) => capability.capabilityId === 'image.masked_edit'),
  false,
);

replacePluginCapabilityDefinitions([referenceEditDefinition]);
try {
  const snapshot = await emptySnapshot();
  const sourceImage = addTestImageBlock(snapshot);
  const session = createAgentSession(snapshot, { model: 'test-model' }).session;
  const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
    content: '保留主体和构图，只把窗外改成月色。',
    contextRefs: [{
      imageBlockIds: [sourceImage.blockId],
      kind: 'canvas_image_selection',
    }],
  });
  const context = {
    agentRun: undefined,
    availableAgentRuns: [],
    boardId: snapshot.board.boardId,
    boardReadModel: {
      blocks: [{
        blockId: sourceImage.blockId,
        media: { kind: 'image' as const },
        type: 'image' as const,
      }],
    },
    entrypointId: undefined,
    explicitOperationBlockIds: [],
    goalPlanOptions: [],
    history: [],
    inlineValues: [],
    mentions: [],
    parameters: {},
    projectId: snapshot.project.projectId,
    selectedImageBlockIds: [sourceImage.blockId],
    userMessage: sourceMessage.content,
    workingOperation: undefined,
    workingOutputImageBlockIds: [],
  } as Parameters<typeof parseAgentRuntimeDecision>[1];
  const decision = parseAgentRuntimeDecision(JSON.stringify({
    capabilityId: 'image.reference_edit_fixture',
    kind: 'operation_create_execute',
    message: '正在创建参考图编辑。',
    operationPrompt: '保留主体和构图，只把窗外改成月色。',
    sourceImageBlockId: sourceImage.blockId,
  }), context, catalog);
  assert.equal(decision.kind, 'operation_create_execute');
  if (decision.kind !== 'operation_create_execute') {
    throw new Error('Expected a create-and-execute decision.');
  }
  const turn = applyAgentRuntimeTurn(snapshot, {
    agentSessionId: session.agentSessionId,
    decision,
    externalThreadId: 'thread_reference_edit_fixture',
    runtimeModel: 'test-model',
    runtimeTurnId: 'turn_reference_edit_fixture',
    sourceMessageId: sourceMessage.agentMessageId,
  });
  const staged = stageAgentOperationExecution(snapshot, turn.operationExecution!, {
    connectionIdForCapability: () => 'codex-app-server',
    operationTitle: 'Generate image',
    operationTitleForCapability: () => 'Reference image edit fixture',
    promptTitle: 'Prompt',
  }).stagedSnapshot;
  const operation = staged.blocks.find(
    (block) => block.type === 'operation' && block.data.capabilityId === 'image.reference_edit_fixture',
  );
  assert.ok(operation);
  assert.equal(operationReadinessFor(staged, operation).canRun, true);
  assert.ok(staged.edges.some((edge) => (
    edge.targetBlockId === operation.blockId
    && edge.sourceBlockId === sourceImage.blockId
    && edge.inputSlotId === 'source_image'
    && edge.inputSlotId === 'source_image'
  )));
  assert.ok(staged.edges.some((edge) => (
    edge.targetBlockId === operation.blockId
    && edge.inputSlotId === 'prompt'
  )));

  const execution = executeExistingImageOperationBlock(staged, {
    capabilityId: 'image.reference_edit_fixture',
    generationParams: operation.data.generationParams,
    instruction: '',
    operation: 'image_to_image',
    operationBlockId: operation.blockId,
  });
  assert.equal(execution.execution.capabilityId, 'image.reference_edit_fixture');
  assert.equal(execution.operationBlock.data.capabilityId, 'image.reference_edit_fixture');
} finally {
  replacePluginCapabilityDefinitions([]);
}

console.log(JSON.stringify({
  ok: true,
  dynamicCatalog: true,
  enabledInstalledCapabilityFilter: true,
  pluginImageEditAgentAuthoring: true,
  requiredInteractiveInputsExcluded: true,
}));

function imageCapability(input: {
  capabilityId: string;
  displayName: string;
  inputSlots: CapabilityDefinition['inputSlots'];
  supportedAdapterClasses?: string[];
}): CapabilityDefinition {
  return {
    capabilityId: input.capabilityId,
    category: 'image_editing',
    definitionHash: `sha256:${'a'.repeat(64)}`,
    displayName: input.displayName,
    inputSlots: input.inputSlots,
    outputSlots: [{
      artifactType: 'image',
      cardinality: 'many',
      dataType: 'image',
      projectionBlockTypes: ['image'],
      semanticRole: 'edited_images',
      slotId: 'edited_images',
    }],
    runtimeRequirements: ['image_generation'],
    schemaVersion: 1,
    supportedAdapterClasses: input.supportedAdapterClasses ?? ['agent_runtime.media'],
    version: '0.1.0',
  };
}

function imageSlot(
  slotId: string,
  semanticRole: string,
  required: boolean,
): CapabilityDefinition['inputSlots'][number] {
  return {
    artifactTypes: ['image'],
    bindingKinds: ['block', 'asset', 'artifact_revision'],
    cardinality: required ? 'one' : 'optional',
    dataTypes: ['image'],
    required,
    semanticRole,
    slotId,
  };
}

function promptSlot(): CapabilityDefinition['inputSlots'][number] {
  return {
    artifactTypes: [],
    bindingKinds: ['inline', 'block'],
    cardinality: 'one',
    dataTypes: ['text'],
    required: true,
    semanticRole: 'prompt',
    slotId: 'prompt',
  };
}

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.agentRuns = [];
  snapshot.agentSessions = [];
  snapshot.agentMessages = [];
  snapshot.agentRuntimeBindings = [];
  snapshot.agentRuntimeEvents = [];
  snapshot.changeProposals = [];
  snapshot.changeDecisions = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  return snapshot;
}

function addTestImageBlock(snapshot: BoardSnapshot) {
  const block = createBlockRecord(snapshot, 'image');
  const assetId = `asset_${block.blockId}`;
  block.data = { ...block.data, assetId, title: 'Source image' };
  snapshot.blocks.push(block);
  snapshot.assets.push({
    assetId,
    createdAt: block.createdAt,
    fileName: 'source.png',
    height: 1024,
    kind: 'image',
    mimeType: 'image/png',
    projectId: snapshot.project.projectId,
    source: { type: 'import' },
    storage: { type: 'local', relativePath: `assets/${assetId}/source.png` },
    updatedAt: block.updatedAt,
    width: 1024,
  });
  return block;
}
