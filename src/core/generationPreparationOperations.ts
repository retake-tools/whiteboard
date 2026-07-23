import type { ProjectArtifactLibrarySnapshot } from './artifactContracts';
import {
  assetIdsForBindingValue,
  capabilityBindingValueForBlock,
} from './artifactLibrary';
import {
  capabilityDefinitionFor,
  codexAppServerTextAdapterDefinition,
} from './capabilityRegistry';
import type {
  CapabilityBindingValue,
  CapabilityInputBinding,
} from './capabilityContracts';
import { createBlockRecord, maxZIndex, touchBoard } from './blockFactory';
import {
  currentOperationConfiguration,
  recordExecutionConfiguration,
} from './executionConfiguration';
import type { ExecutionConnectionSummary } from './executionProviders';
import {
  generationPreparationCapabilityId,
  generationPreparationSkillId,
  GenerationPreparationContractError,
  normalizeGenerationPreparationParameters,
  normalizeGenerationReferenceManifest,
  type GenerationReferenceManifest,
} from './generationPreparationContracts';
import { createId, nowIso } from './id';
import type { PackageInvocationContext } from './packageContracts';
import { skillDefinitionFor, snapshotSkill } from './skillRegistry';
import { isStoryboardSheetArtifactRevisionMetadata } from './storyboardSheetContracts';
import type { SkillDraftInputBinding, TextGenerationLabels } from './textOperations';
import type {
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionRecord,
} from './types';
import { attachWorkflowExecution } from './workflowRuntime';

export interface GenerationPreparationDraftInput {
  connectionId?: string;
  explicitInputBindings?: SkillDraftInputBinding[];
  labels: TextGenerationLabels;
  packageContext?: PackageInvocationContext;
  parameters?: Record<string, unknown>;
  referenceManifest?: unknown;
  selectedBlockIds?: string[];
  unitId?: string;
}

export function createDraftGenerationPreparationOperation(
  snapshot: BoardSnapshot,
  input: GenerationPreparationDraftInput,
): { inputBlocks: BlockRecord[]; operationBlock: BlockRecord } {
  const createdBlocks: BlockRecord[] = [];
  const inputBlocks: BlockRecord[] = [];
  const assignedSlots = new Map<string, string>();
  const selected = new Set(input.selectedBlockIds ?? []);

  for (const binding of input.explicitInputBindings ?? []) {
    const block = binding.kind === 'block'
      ? snapshot.blocks.find((candidate) => candidate.blockId === binding.blockId)
      : projectAssetInput(snapshot, binding, input.labels, createdBlocks.length);
    if (!block || !isSupportedInputBlock(block)) {
      throw new Error(
        `Generation Preparation input is incompatible: ${binding.kind === 'block' ? binding.blockId : binding.assetId}`,
      );
    }
    if (binding.kind === 'asset') createdBlocks.push(block);
    inputBlocks.push(block);
    assignedSlots.set(block.blockId, binding.inputSlotId);
  }

  for (const block of snapshot.blocks) {
    if (!selected.has(block.blockId) || !isSupportedInputBlock(block) || inputBlocks.includes(block)) continue;
    const slotId = inferSelectedSlot(block, assignedSlots);
    if (!slotId) continue;
    inputBlocks.push(block);
    assignedSlots.set(block.blockId, slotId);
  }

  ensureRequiredInputPlaceholder(
    snapshot,
    input,
    'storyboard_plan',
    'document',
    inputBlocks,
    createdBlocks,
    assignedSlots,
  );
  ensureRequiredInputPlaceholder(
    snapshot,
    input,
    'storyboard_sheet',
    'image',
    inputBlocks,
    createdBlocks,
    assignedSlots,
  );

  const parameters = normalizeGenerationPreparationParameters(input.parameters);
  const referenceManifest = input.referenceManifest === undefined
    ? emptyReferenceManifest()
    : normalizeGenerationReferenceManifest(input.referenceManifest);
  const operationBlock = createBlockRecord(snapshot, 'operation');
  operationBlock.data = {
    ...operationBlock.data,
    title: input.unitId?.trim()
      ? `${input.labels.operationTitle} · ${input.unitId.trim()}`
      : input.labels.operationTitle,
    body: input.labels.promptPlaceholder,
    capabilityId: generationPreparationCapabilityId,
    skillId: generationPreparationSkillId,
    adapter: 'codex_app_server',
    agentHost: 'codex',
    triggerMode: 'agent_bridge',
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.packageContext ? packageInvocationMetadata(input.packageContext) : {}),
    generationPreparationParameters: parameters,
    generationReferenceManifest: referenceManifest,
    generationUnitId: input.unitId?.trim() ?? '',
    workflowParameters: parameters,
  };
  const anchor = inputBlocks[0];
  operationBlock.position = {
    x: Math.max(...inputBlocks.map((block) => block.position.x + block.size.width)) + 90,
    y: anchor?.position.y ?? 80,
  };
  operationBlock.zIndex = Math.max(maxZIndex(snapshot.blocks), ...inputBlocks.map((block) => block.zIndex)) + 1;
  snapshot.blocks.push(...createdBlocks, operationBlock);
  for (const block of inputBlocks) {
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: block.blockId,
      targetBlockId: operationBlock.blockId,
      kind: 'execution_input',
      inputSlotId: assignedSlots.get(block.blockId),
    });
  }
  touchBoard(snapshot);
  return { inputBlocks, operationBlock };
}

export function executeExistingGenerationPreparationOperation(
  snapshot: BoardSnapshot,
  input: {
    artifactLibrary: ProjectArtifactLibrarySnapshot;
    connection: ExecutionConnectionSummary;
    labels: Pick<TextGenerationLabels, 'resultTitle' | 'waitingBody'>;
    operationBlockId: string;
  },
): {
  execution: ExecutionRecord;
  operationBlock: BlockRecord;
  resultBlock: BlockRecord;
} {
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === input.operationBlockId && block.type === 'operation',
  );
  if (!operationBlock || operationBlock.data.capabilityId !== generationPreparationCapabilityId) {
    throw new Error(`Generation Preparation operation not found: ${input.operationBlockId}`);
  }
  if (
    input.connection.connectorId !== 'codex-app-server'
    || input.connection.status !== 'ready'
    || !input.connection.supportedCapabilityIds.includes(generationPreparationCapabilityId)
  ) {
    throw new GenerationPreparationContractError(
      'generation_package_adapter_unavailable',
      `Connection cannot prepare a Generation Package: ${input.connection.connectionId}`,
    );
  }

  const unitId = requiredOperationText(
    operationBlock.data.generationUnitId,
    'generation_package_unit_not_found',
    'Enter an exact Storyboard Unit ID before preparing the package.',
  );
  const parameters = normalizeGenerationPreparationParameters(
    objectValue(operationBlock.data.generationPreparationParameters),
  );
  const manifest = normalizeGenerationReferenceManifest(operationBlock.data.generationReferenceManifest);
  const edges = snapshot.edges.filter(
    (edge) => edge.kind === 'execution_input' && edge.targetBlockId === operationBlock.blockId,
  );
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const blocksForSlot = (slotId: string) => edges
    .filter((edge) => edge.inputSlotId === slotId)
    .flatMap((edge) => {
      const block = blockById.get(edge.sourceBlockId);
      return block ? [block] : [];
    });

  const planBlocks = blocksForSlot('storyboard_plan').filter((block) => block.type === 'document');
  if (planBlocks.length !== 1 || typeof planBlocks[0]?.data.assetId !== 'string') {
    throw new GenerationPreparationContractError(
      'generation_package_storyboard_plan_missing',
      'Connect exactly one asset-backed Storyboard Plan.',
    );
  }
  const sheetBlocks = blocksForSlot('storyboard_sheet').filter((block) => block.type === 'image');
  if (sheetBlocks.length !== 1 || typeof sheetBlocks[0]?.data.artifactRevisionId !== 'string') {
    throw new GenerationPreparationContractError(
      'generation_package_sheet_revision_required',
      'Connect exactly one Storyboard Sheet ArtifactRevision from the Project Asset Library.',
    );
  }
  const sheetBlock = sheetBlocks[0];
  const sheetRevisionId = String(sheetBlock.data.artifactRevisionId);
  const sheetItem = input.artifactLibrary.items.find(
    (item) => item.currentRevision.artifactRevisionId === sheetRevisionId,
  );
  if (!sheetItem || sheetItem.artifact.artifactType !== 'storyboard_sheet') {
    throw new GenerationPreparationContractError(
      'generation_package_sheet_revision_required',
      'The connected Storyboard Sheet must still be the current Project Artifact revision.',
    );
  }
  if (!isStoryboardSheetArtifactRevisionMetadata(sheetItem.currentRevision.metadata)) {
    throw new GenerationPreparationContractError(
      'generation_package_sheet_revision_required',
      'The connected Storyboard Sheet revision has no valid typed metadata.',
    );
  }
  if (sheetItem.currentRevision.metadata.unitId !== unitId) {
    throw new GenerationPreparationContractError(
      'generation_package_unit_mismatch',
      `Storyboard Sheet belongs to ${sheetItem.currentRevision.metadata.unitId}, not ${unitId}.`,
    );
  }
  assertCurrentPassedStoryboardSheetGate(snapshot, sheetRevisionId);

  const referenceBlocks = blocksForSlot('references');
  if (referenceBlocks.some((block) => block.type !== 'image' || typeof block.data.assetId !== 'string')) {
    throw new GenerationPreparationContractError(
      'generation_package_reference_unsupported',
      'Generation Preparation V0 supports attached image references only.',
    );
  }
  const referenceIdentities = new Set(referenceBlocks.flatMap(bindingIdentitiesForBlock));
  for (const requirement of manifest.items) {
    if (requirement.required && !requirement.bindingIdentity) {
      throw new GenerationPreparationContractError(
        'generation_package_required_reference_missing',
        `Required reference has no binding: ${requirement.requirementId}`,
      );
    }
    if (requirement.bindingIdentity && !referenceIdentities.has(requirement.bindingIdentity)) {
      throw new GenerationPreparationContractError(
        'generation_package_required_reference_missing',
        `Declared reference binding is not connected: ${requirement.requirementId}`,
      );
    }
  }
  const declaredIdentities = new Set<string>(manifest.items.flatMap((item) =>
    item.bindingIdentity ? [item.bindingIdentity] : [],
  ));
  const undeclared = [...referenceIdentities].filter((identity) => !declaredIdentities.has(identity));
  if (undeclared.length > 0) {
    throw new GenerationPreparationContractError(
      'generation_package_reference_manifest_invalid',
      `Connected reference is not declared in the Reference Manifest: ${undeclared[0]}`,
    );
  }

  const instructionBlocks = blocksForSlot('instruction').filter(
    (block) => block.type === 'text' || block.type === 'document',
  );
  const bindings: CapabilityInputBinding[] = [
    { slotId: 'storyboard_plan', values: [capabilityBindingValueForBlock(planBlocks[0])] },
    {
      slotId: 'storyboard_sheet',
      values: [{ kind: 'artifact_revision', artifactRevisionId: sheetRevisionId, blockId: sheetBlock.blockId }],
    },
    { slotId: 'unit_id', values: [{ kind: 'inline', value: unitId }] },
    ...(referenceBlocks.length > 0 ? [{
      slotId: 'references',
      values: referenceBlocks.map(capabilityBindingValueForBlock),
    }] : []),
    { slotId: 'reference_manifest', values: [{ kind: 'inline', value: manifest }] },
    ...(instructionBlocks.length > 0 ? [{
      slotId: 'instruction',
      values: instructionBlocks.map(capabilityBindingValueForBlock),
    }] : []),
  ];

  const executionId = createId('exec');
  const createdAt = nowIso();
  const resultBlock = reusableDraftResult(snapshot, operationBlock) ?? createResultBlock(
    snapshot,
    operationBlock,
    input.labels,
    executionId,
    createdAt,
  );
  resultBlock.data = {
    ...resultBlock.data,
    title: input.labels.resultTitle,
    placeholder: input.labels.waitingBody,
    documentKind: 'video_generation_package',
    managedDocumentResult: true,
    status: 'queued',
    operationBlockId: operationBlock.blockId,
    sourceExecutionId: executionId,
    generationUnitId: unitId,
  };
  delete resultBlock.data.assetId;
  delete resultBlock.data.documentExcerpt;
  delete resultBlock.data.documentOutline;
  resultBlock.data.documentCharacterCount = 0;
  resultBlock.updatedAt = createdAt;

  const prompt = `Prepare the provider-neutral video Generation Package for locked Storyboard Unit ${unitId}.`;
  operationBlock.data = {
    ...operationBlock.data,
    title: `Prepare video generation package · ${unitId}`,
    body: prompt,
    status: 'queued',
    adapter: 'codex_app_server',
    agentHost: 'codex',
    triggerMode: 'agent_bridge',
    connectionId: input.connection.connectionId,
    sourceExecutionId: executionId,
    generationPreparationParameters: parameters,
    generationReferenceManifest: manifest,
    generationUnitId: unitId,
  };
  operationBlock.updatedAt = createdAt;
  const configurationPrompt = currentOperationConfiguration(snapshot, operationBlock).prompt;

  const definition = capabilityDefinitionFor(generationPreparationCapabilityId);
  const skill = skillDefinitionFor(generationPreparationSkillId);
  const previousExecution = snapshot.executions.find(
    (candidate) => candidate.params?.operationBlockId === operationBlock.blockId,
  );
  const execution: ExecutionRecord = {
    executionId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId: generationPreparationCapabilityId,
    adapter: 'codex_app_server',
    status: 'queued',
    inputBlockIds: [...planBlocks, sheetBlock, ...referenceBlocks, ...instructionBlocks]
      .map((block) => block.blockId),
    inputAssetIds: [...new Set(bindings.flatMap((binding) =>
      binding.values.flatMap((value) => assetIdsForBindingValue(snapshot, value)),
    ))],
    outputBlockIds: [resultBlock.blockId],
    outputAssetIds: [],
    agentHost: 'codex',
    triggerMode: 'agent_bridge',
    provider: input.connection.providerLabel,
    model: input.connection.modelId,
    connectionId: input.connection.connectionId,
    skillId: generationPreparationSkillId,
    prompt: configurationPrompt,
    params: {
      generationPreparation: parameters,
      generationReferenceManifest: manifest,
      operationBlockId: operationBlock.blockId,
      storyboardSheetArtifactRevisionId: sheetRevisionId,
      storyboardSheetMetadata: structuredClone(sheetItem.currentRevision.metadata),
      unitId,
      maxOutputTokens: 6_144,
    },
    ...(previousExecution ? { previousExecutionId: previousExecution.executionId } : {}),
    capabilityLock: {
      capabilityId: definition.capabilityId,
      definitionHash: definition.definitionHash,
      version: definition.version,
    },
    skillSnapshot: snapshotSkill(skill, bindings),
    inputBindingsSnapshot: structuredClone(bindings),
    outputSlotResults: [{ slotId: 'generation_package', assetIds: [] }],
    adapterSnapshot: {
      adapterId: codexAppServerTextAdapterDefinition.adapterId,
      version: codexAppServerTextAdapterDefinition.version,
      definitionHash: codexAppServerTextAdapterDefinition.definitionHash,
      adapterClass: codexAppServerTextAdapterDefinition.adapterClass,
      routeKind: codexAppServerTextAdapterDefinition.routeKind,
      provider: input.connection.providerLabel,
      model: input.connection.modelId,
    },
    startedAt: createdAt,
  };
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  execution.inputBindingsSnapshot = structuredClone(bindings);
  execution.skillSnapshot = snapshotSkill(skill, bindings);
  attachWorkflowExecution(snapshot, operationBlock, execution);
  snapshot.executions.unshift(execution);
  snapshot.historyEvents = [
    operationHistory(execution, operationBlock, resultBlock, unitId),
    ...(snapshot.historyEvents ?? []),
  ].slice(0, 200);
  touchBoard(snapshot);
  return { execution, operationBlock, resultBlock };
}

function ensureRequiredInputPlaceholder(
  snapshot: BoardSnapshot,
  input: GenerationPreparationDraftInput,
  slotId: 'storyboard_plan' | 'storyboard_sheet',
  blockType: 'document' | 'image',
  inputBlocks: BlockRecord[],
  createdBlocks: BlockRecord[],
  assignedSlots: Map<string, string>,
): void {
  if (inputBlocks.some((block) => assignedSlots.get(block.blockId) === slotId)) return;
  const labels = input.labels.inputSlots?.find((candidate) => candidate.slotId === slotId);
  const block = createBlockRecord(snapshot, blockType);
  block.data = {
    ...block.data,
    title: labels?.promptTitle ?? input.labels.promptTitle,
    placeholder: labels?.promptPlaceholder ?? input.labels.promptPlaceholder,
    ...(blockType === 'document' ? { documentKind: 'storyboard_plan' } : {}),
  };
  block.position = { x: 80, y: 80 + createdBlocks.length * (block.size.height + 36) };
  block.zIndex = maxZIndex(snapshot.blocks) + createdBlocks.length + 1;
  createdBlocks.push(block);
  inputBlocks.push(block);
  assignedSlots.set(block.blockId, slotId);
}

function projectAssetInput(
  snapshot: BoardSnapshot,
  binding: Extract<SkillDraftInputBinding, { kind: 'asset' }>,
  labels: TextGenerationLabels,
  index: number,
): BlockRecord {
  const asset = snapshot.assets.find((candidate) => candidate.assetId === binding.assetId);
  if (!asset || (asset.kind !== 'document' && asset.kind !== 'image')) {
    throw new Error(`Generation Preparation Asset not found: ${binding.assetId}`);
  }
  const block = createBlockRecord(snapshot, asset.kind);
  const slotLabels = labels.inputSlots?.find((candidate) => candidate.slotId === binding.inputSlotId);
  block.data = {
    ...block.data,
    title: slotLabels?.promptTitle ?? labels.promptTitle,
    assetId: asset.assetId,
    composerSourceAssetId: asset.assetId,
    ...(asset.kind === 'document'
      ? { documentKind: binding.inputSlotId === 'storyboard_plan' ? 'storyboard_plan' : 'markdown_document' }
      : { previewUrl: asset.previewUrl }),
  };
  block.position = { x: 80, y: 80 + index * (block.size.height + 36) };
  block.zIndex = maxZIndex(snapshot.blocks) + index + 1;
  return block;
}

function inferSelectedSlot(
  block: BlockRecord,
  assignedSlots: Map<string, string>,
): string | undefined {
  if (block.type === 'document') {
    return [...assignedSlots.values()].includes('storyboard_plan') ? 'instruction' : 'storyboard_plan';
  }
  if (block.type === 'text') return 'instruction';
  if (
    block.type === 'image'
    && block.data.artifactType === 'storyboard_sheet'
    && ![...assignedSlots.values()].includes('storyboard_sheet')
  ) return 'storyboard_sheet';
  return block.type === 'image' ? 'references' : undefined;
}

function assertCurrentPassedStoryboardSheetGate(
  snapshot: BoardSnapshot,
  artifactRevisionId: string,
): void {
  const evaluations = (snapshot.workflowGateEvaluations ?? []).filter(
    (evaluation) => (
      evaluation.gateId === 'storyboard_sheet_review'
      && evaluation.subjectArtifactRevisionId === artifactRevisionId
    ),
  );
  const passed = evaluations.find(
    (evaluation) => evaluation.status === 'passed' && evaluation.freshness === 'current',
  );
  if (passed) return;
  if (evaluations.some((evaluation) => evaluation.status === 'passed')) {
    throw new GenerationPreparationContractError(
      'generation_package_sheet_gate_outdated',
      'The Storyboard Sheet approval is outdated.',
    );
  }
  throw new GenerationPreparationContractError(
    'generation_package_sheet_gate_required',
    'The Storyboard Sheet revision must pass storyboard_sheet_review before package preparation.',
  );
}

function bindingIdentitiesForBlock(block: BlockRecord): string[] {
  const values: string[] = [];
  if (typeof block.data.assetId === 'string') values.push(`asset:${block.data.assetId}`);
  if (typeof block.data.artifactRevisionId === 'string') {
    values.push(`artifact_revision:${block.data.artifactRevisionId}`);
  }
  return values;
}

function reusableDraftResult(snapshot: BoardSnapshot, operationBlock: BlockRecord): BlockRecord | undefined {
  const outputIds = snapshot.edges
    .filter((edge) => edge.kind === 'execution_output' && edge.sourceBlockId === operationBlock.blockId)
    .map((edge) => edge.targetBlockId);
  return snapshot.blocks.find((block) => (
    outputIds.includes(block.blockId)
    && block.type === 'document'
    && block.data.managedDocumentResult === true
    && typeof block.data.assetId !== 'string'
  ));
}

function createResultBlock(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  labels: Pick<TextGenerationLabels, 'resultTitle' | 'waitingBody'>,
  executionId: string,
  createdAt: string,
): BlockRecord {
  const block = createBlockRecord(snapshot, 'document');
  block.position = {
    x: operationBlock.position.x + operationBlock.size.width + 90,
    y: operationBlock.position.y,
  };
  block.zIndex = maxZIndex(snapshot.blocks) + 1;
  block.data = {
    ...block.data,
    title: labels.resultTitle,
    placeholder: labels.waitingBody,
    documentKind: 'video_generation_package',
    managedDocumentResult: true,
    status: 'queued',
    operationBlockId: operationBlock.blockId,
    sourceExecutionId: executionId,
  };
  block.createdAt = createdAt;
  block.updatedAt = createdAt;
  snapshot.blocks.push(block);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: operationBlock.blockId,
    targetBlockId: block.blockId,
    kind: 'execution_output',
  });
  return block;
}

function operationHistory(
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
  resultBlock: BlockRecord,
  unitId: string,
): BoardHistoryEvent {
  return {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt: execution.startedAt,
    actor: 'user',
    executionId: execution.executionId,
    blockIds: [...execution.inputBlockIds, operationBlock.blockId, resultBlock.blockId],
    assetIds: execution.inputAssetIds,
    summary: `Prepare video generation package · ${unitId}`,
    detail: {
      capabilityId: execution.capabilityId,
      resultBlockIds: [resultBlock.blockId],
      unitId,
    },
  };
}

function emptyReferenceManifest(): GenerationReferenceManifest {
  return {
    schemaRef: 'retake.generation-reference-manifest/v1',
    items: [],
  };
}

function packageInvocationMetadata(context: PackageInvocationContext): Partial<BlockRecord['data']> {
  return {
    packageId: context.packageLock.packageId,
    packageVersion: context.packageLock.version,
    packageDigest: context.packageLock.digest,
    packageEntryPointId: context.entrypointId,
  };
}

function isSupportedInputBlock(block: BlockRecord): boolean {
  return block.type === 'text' || block.type === 'document' || block.type === 'image';
}

function requiredOperationText(
  value: unknown,
  code: 'generation_package_unit_not_found',
  message: string,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GenerationPreparationContractError(code, message);
  }
  return value.trim();
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function generationPreparationReferenceManifest(
  operationBlock: BlockRecord,
): GenerationReferenceManifest {
  return normalizeGenerationReferenceManifest(operationBlock.data.generationReferenceManifest);
}

export function bindingIdentityForValue(value: CapabilityBindingValue): string | undefined {
  if (value.kind === 'asset') return `asset:${value.assetId}`;
  if (value.kind === 'artifact_revision') return `artifact_revision:${value.artifactRevisionId}`;
  return undefined;
}
