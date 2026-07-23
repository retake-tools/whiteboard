import { capabilityDefinitionFor } from './capabilityRegistry';
import type { CapabilityBindingValue } from './capabilityContracts';
import { createBlockRecord, touchBoard } from './blockFactory';
import { createGroupAroundBlocks } from './grouping';
import { createId } from './id';
import type { PackageInvocationContext } from './packageContracts';
import type {
  PackageComposerInlineValue,
  PackageComposerMention,
} from './packageComposer';
import { createDraftSkillOperation, type TextGenerationLabels } from './textOperations';
import type { BlockRecord, BoardSnapshot } from './types';
import { createDraftStoryboardSheetOperation } from './storyboardSheetOperations';
import {
  validateWorkflowDefinition,
  workflowDefinitionFor,
  type WorkflowDefinition,
} from './workflowRegistry';
import {
  createDraftGenerationPreparationOperation,
} from './generationPreparationOperations';
import { generationPreparationCapabilityId } from './generationPreparationContracts';
import {
  domainVideoGenerationCapabilityId,
} from './domainVideoGenerationContracts';
import { createDraftDomainVideoGenerationOperation } from './domainVideoGenerationOperations';

export interface WorkflowDraftProjectionLabels {
  labelsForSkill: (skillId: string) => TextGenerationLabels;
  outputPlaceholder: string;
  workflowTitle: string;
}

export interface WorkflowDraftProjection {
  blockIds: string[];
  groupBlock: BlockRecord;
  operationBlockIds: string[];
  projectionId: string;
  resultBlockIds: string[];
  workflowInputBlockIds: string[];
}

export function projectWorkflowDraft(
  snapshot: BoardSnapshot,
  input: WorkflowDraftProjectionLabels & {
    connectionIdForCapability: (capabilityId: string) => string | undefined;
    composerInput?: {
      inlineValues?: PackageComposerInlineValue[];
      instruction?: { body: string; slotId: string };
      mentions: PackageComposerMention[];
      parameters?: Record<string, unknown>;
    };
    packageContext?: PackageInvocationContext;
    workflowId: string;
  },
): WorkflowDraftProjection {
  const workflow = workflowDefinitionFor(input.workflowId);
  const validationIssues = validateWorkflowDefinition(workflow);
  if (validationIssues.length > 0) throw new Error(validationIssues.join('\n'));
  const projectionId = createId('workflow_projection');
  const metadata = workflowMetadata(workflow, projectionId, input.packageContext);
  const workflowInputs = new Map<string, BlockRecord[]>();
  const workflowInputBindings = new Map<string, CapabilityBindingValue[]>();
  const stepOutputs = new Map<string, BlockRecord>();
  const operationBlocks = new Map<string, BlockRecord>();
  const createdBlocks: BlockRecord[] = [];

  for (const slot of workflow.inputSlots) {
    const consumer = workflow.steps.find((step) => step.inputBindings.some(
      (binding) => binding.source.kind === 'workflow_input' && binding.source.slotId === slot.slotId,
    ));
    if (!consumer) throw new Error(`Workflow input is not consumed: ${workflow.workflowId}.${slot.slotId}`);
    const labels = input.labelsForSkill(consumer.skillLock.skillId);
    const slotLabels = labels.inputSlots?.find((candidate) => candidate.slotId === slot.slotId);
    const mentions = input.composerInput?.mentions.filter((candidate) => candidate.slotId === slot.slotId) ?? [];
    const inlineValues = input.composerInput?.inlineValues?.filter(
      (candidate) => candidate.slotId === slot.slotId,
    ) ?? [];
    const instruction = input.composerInput?.instruction?.slotId === slot.slotId
      ? input.composerInput.instruction.body.trim()
      : undefined;
    const blocks = [
      ...mentions.map((mention) => createWorkflowInputBlock(snapshot, {
        artifactType: slot.artifactTypes[0],
        dataType: slot.dataTypes[0],
        mention,
        promptPlaceholder: slotLabels?.promptPlaceholder ?? labels.promptPlaceholder,
        promptTitle: slotLabels?.promptTitle ?? labels.promptTitle,
      })),
      ...(instruction ? [createWorkflowInputBlock(snapshot, {
        artifactType: slot.artifactTypes[0],
        dataType: 'text',
        instruction,
        promptPlaceholder: slotLabels?.promptPlaceholder ?? labels.promptPlaceholder,
        promptTitle: slotLabels?.promptTitle ?? labels.promptTitle,
      })] : []),
    ];
    if (
      blocks.length === 0
      && inlineValues.length === 0
      && slot.required
      && !slot.dataTypes.includes('structured_data')
      && !(slot.dataTypes.includes('text') && slot.artifactTypes.length === 0)
    ) {
      blocks.push(createWorkflowInputBlock(snapshot, {
        artifactType: slot.artifactTypes[0],
        dataType: slot.dataTypes[0],
        promptPlaceholder: slotLabels?.promptPlaceholder ?? labels.promptPlaceholder,
        promptTitle: slotLabels?.promptTitle ?? labels.promptTitle,
      }));
    }
    for (const block of blocks) {
      block.data = {
        ...block.data,
        ...metadata,
        workflowInputSlotId: slot.slotId,
      };
      snapshot.blocks.push(block);
      createdBlocks.push(block);
    }
    workflowInputs.set(slot.slotId, blocks);
    workflowInputBindings.set(slot.slotId, [
      ...blocks.map((block): CapabilityBindingValue => ({ kind: 'block', blockId: block.blockId })),
      ...inlineValues.map((value): CapabilityBindingValue => ({ kind: 'inline', value: value.value })),
    ]);
  }

  for (const step of topologicalSteps(workflow)) {
    const selectedBlockIds = step.inputBindings.flatMap((binding) => {
      if (binding.source.kind === 'workflow_input') {
        return (workflowInputs.get(binding.source.slotId) ?? []).map((block) => block.blockId);
      }
      const block = stepOutputs.get(stepOutputKey(binding.source.stepId, binding.source.outputSlotId));
      if (!block) {
        throw new Error(`Workflow step output projection not found: ${binding.source.stepId}.${binding.source.outputSlotId}`);
      }
      return [block.blockId];
    });
    const labels = input.labelsForSkill(step.skillLock.skillId);
    const capability = capabilityDefinitionFor(step.capabilityLock.capabilityId);
    const mediaOutput = capability.outputSlots.some(
      (slot) => slot.dataType === 'image' || slot.dataType === 'video',
    );
    const unitValue = workflowInputBindings.get('unit_id')?.find(
      (value): value is Extract<CapabilityBindingValue, { kind: 'inline' }> => value.kind === 'inline',
    );
    const generationPreparation = step.capabilityLock.capabilityId === generationPreparationCapabilityId;
    const manifestValue = workflowInputBindings.get('reference_manifest')?.find(
      (value): value is Extract<CapabilityBindingValue, { kind: 'inline' }> => value.kind === 'inline',
    );
    const explicitGenerationInputs = step.inputBindings.flatMap((binding) => (
      binding.source.kind === 'workflow_input'
        ? (workflowInputs.get(binding.source.slotId) ?? []).map((block) => ({
            blockId: block.blockId,
            inputSlotId: binding.inputSlotId,
            kind: 'block' as const,
          }))
        : []
    ));
    const domainVideoGeneration = step.capabilityLock.capabilityId === domainVideoGenerationCapabilityId;
    const draft = generationPreparation
      ? createDraftGenerationPreparationOperation(snapshot, {
          connectionId: input.connectionIdForCapability(step.capabilityLock.capabilityId),
          explicitInputBindings: explicitGenerationInputs,
          labels,
          parameters: input.composerInput?.parameters,
          referenceManifest: manifestValue?.value,
          unitId: typeof unitValue?.value === 'string' ? unitValue.value : undefined,
        })
      : domainVideoGeneration
        ? createDraftDomainVideoGenerationOperation(snapshot, {
            connectionId: input.connectionIdForCapability(step.capabilityLock.capabilityId),
            explicitInputBindings: explicitGenerationInputs,
            labels,
            parameters: input.composerInput?.parameters,
          })
      : mediaOutput
      ? createDraftStoryboardSheetOperation(snapshot, {
          connectionId: input.connectionIdForCapability(step.capabilityLock.capabilityId),
          labels,
          parameters: input.composerInput?.parameters,
          selectedBlockIds,
          unitId: typeof unitValue?.value === 'string' ? unitValue.value : undefined,
        })
      : createDraftSkillOperation(snapshot, {
          ...labels,
          connectionId: input.connectionIdForCapability(step.capabilityLock.capabilityId),
          selectedBlockIds,
          skillId: step.skillLock.skillId,
        });
    draft.operationBlock.data = {
      ...draft.operationBlock.data,
      ...metadata,
      workflowInputBindings: structuredClone(
        step.inputBindings.map((binding) => ({
          inputSlotId: binding.inputSlotId,
          source: binding.source,
          values: binding.source.kind === 'workflow_input'
            ? workflowInputBindings.get(binding.source.slotId) ?? []
            : [{
                kind: 'block',
                blockId: stepOutputs.get(
                  stepOutputKey(binding.source.stepId, binding.source.outputSlotId),
                )?.blockId,
              }].filter((value): value is Extract<CapabilityBindingValue, { kind: 'block' }> => Boolean(value.blockId)),
        })),
      ),
      workflowParameters: structuredClone(input.composerInput?.parameters ?? {}),
      workflowStepId: step.stepId,
    };
    operationBlocks.set(step.stepId, draft.operationBlock);
    createdBlocks.push(...draft.inputBlocks.filter((block) => !createdBlocks.includes(block)), draft.operationBlock);

    for (const outputSlotId of step.outputSlots) {
      const outputSlot = capability.outputSlots.find((candidate) => candidate.slotId === outputSlotId);
      if (!outputSlot) throw new Error(`Capability output slot not found: ${capability.capabilityId}.${outputSlotId}`);
      if (
        outputSlot.dataType !== 'document'
        && outputSlot.dataType !== 'image'
        && outputSlot.dataType !== 'video'
      ) {
        throw new Error(`Workflow Draft Projection does not support output: ${capability.capabilityId}.${outputSlotId}`);
      }
      const resultBlock = createBlockRecord(snapshot, outputSlot.dataType);
      resultBlock.data = {
        ...resultBlock.data,
        ...metadata,
        title: labels.resultTitle,
        placeholder: input.outputPlaceholder,
        ...(outputSlot.dataType === 'document' ? {
          documentKind: outputSlot.artifactType ?? 'general',
          managedDocumentResult: true,
        } : outputSlot.dataType === 'image' ? {
          storyboardUnitId: typeof unitValue?.value === 'string' ? unitValue.value : undefined,
        } : {}),
        operationBlockId: draft.operationBlock.blockId,
        workflowOutputSlotId: outputSlotId,
        workflowStepId: step.stepId,
      };
      snapshot.blocks.push(resultBlock);
      snapshot.edges.push({
        edgeId: createId('edge'),
        sourceBlockId: draft.operationBlock.blockId,
        targetBlockId: resultBlock.blockId,
        kind: 'execution_output',
      });
      stepOutputs.set(stepOutputKey(step.stepId, outputSlotId), resultBlock);
      createdBlocks.push(resultBlock);
    }
  }

  layoutWorkflowProjection(workflow, workflowInputs, operationBlocks, stepOutputs);
  const groupBlock = createGroupAroundBlocks(snapshot, createdBlocks.map((block) => block.blockId), {
    color: 'blue',
    kind: 'workflow',
    title: input.workflowTitle,
  });
  if (!groupBlock) throw new Error(`Workflow draft group could not be created: ${workflow.workflowId}`);
  groupBlock.data = {
    ...groupBlock.data,
    ...metadata,
    workflowInputBindings: [...workflowInputBindings].map(([workflowInputSlotId, values]) => ({
      workflowInputSlotId,
      values: structuredClone(values),
    })),
  };
  touchBoard(snapshot);

  return {
    projectionId,
    groupBlock,
    blockIds: [groupBlock.blockId, ...createdBlocks.map((block) => block.blockId)],
    workflowInputBlockIds: [...workflowInputs.values()].flat().map((block) => block.blockId),
    operationBlockIds: [...operationBlocks.values()].map((block) => block.blockId),
    resultBlockIds: [...stepOutputs.values()].map((block) => block.blockId),
  };
}

function createWorkflowInputBlock(
  snapshot: BoardSnapshot,
  input: {
    artifactType?: string;
    dataType?: 'document' | 'image' | 'text' | 'structured_data' | 'video' | 'audio';
    instruction?: string;
    mention?: PackageComposerMention;
    promptPlaceholder: string;
    promptTitle: string;
  },
): BlockRecord {
  const mention = input.mention;
  if (mention?.kind === 'asset') {
    const asset = snapshot.assets.find((candidate) => (
      candidate.assetId === mention.assetId
      && (candidate.kind === 'document' || candidate.kind === 'image')
    ));
    if (!asset) throw new Error(`Workflow Composer Asset not found: ${mention.assetId}`);
    const block = createBlockRecord(snapshot, asset.kind === 'image' ? 'image' : 'document');
    block.data = {
      ...block.data,
      title: input.promptTitle,
      assetId: asset.assetId,
      composerSourceAssetId: asset.assetId,
      ...(asset.kind === 'document'
        ? { documentKind: input.artifactType ?? 'markdown_document' }
        : { previewUrl: asset.previewUrl }),
    };
    return block;
  }
  if (mention?.kind === 'block') {
    const source = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
    if (!source || (source.type !== 'text' && source.type !== 'document' && source.type !== 'image')) {
      throw new Error(`Workflow Composer input Block not found: ${mention.blockId}`);
    }
    const assetId = typeof source.data.assetId === 'string' ? source.data.assetId : undefined;
    const block = createBlockRecord(snapshot, source.type === 'image' ? 'image' : assetId ? 'document' : 'text');
    block.data = {
      ...block.data,
      title: input.promptTitle,
      ...(source.type === 'image' ? {
        artifactId: source.data.artifactId,
        artifactRevisionId: source.data.artifactRevisionId,
        artifactType: source.data.artifactType,
        assetId,
        previewUrl: source.data.previewUrl,
      } : assetId ? {
        artifactId: source.data.artifactId,
        artifactRevisionId: source.data.artifactRevisionId,
        artifactType: source.data.artifactType,
        assetId,
        documentKind: typeof source.data.documentKind === 'string'
          ? source.data.documentKind
          : input.artifactType ?? 'markdown_document',
      } : {
        body: typeof source.data.body === 'string' ? source.data.body : '',
        placeholder: input.promptPlaceholder,
      }),
      composerSourceBlockId: source.blockId,
    };
    return block;
  }
  const block = createBlockRecord(snapshot, input.dataType === 'document' ? 'document' : 'text');
  block.data = {
    ...block.data,
    title: input.promptTitle,
    body: input.instruction ?? '',
    placeholder: input.promptPlaceholder,
    ...(input.dataType === 'document'
      ? { documentKind: input.artifactType ?? 'markdown_document' }
      : {}),
  };
  return block;
}

function workflowMetadata(
  workflow: WorkflowDefinition,
  projectionId: string,
  packageContext?: PackageInvocationContext,
): Partial<BlockRecord['data']> {
  return {
    workflowDefinitionId: workflow.workflowId,
    workflowDefinitionVersion: workflow.version,
    workflowDefinitionHash: workflow.definitionHash,
    workflowProjectionId: projectionId,
    ...(packageContext ? {
      packageId: packageContext.packageLock.packageId,
      packageVersion: packageContext.packageLock.version,
      packageDigest: packageContext.packageLock.digest,
      packageEntryPointId: packageContext.entrypointId,
    } : {}),
  };
}

function stepOutputKey(stepId: string, outputSlotId: string): string {
  return `${stepId}:${outputSlotId}`;
}

function topologicalSteps(workflow: WorkflowDefinition): WorkflowDefinition['steps'] {
  const remaining = new Map(workflow.steps.map((step) => [step.stepId, step]));
  const resolved = new Set<string>();
  const ordered: WorkflowDefinition['steps'] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((step) => step.dependsOn.every((stepId) => resolved.has(stepId)));
    if (ready.length === 0) throw new Error(`Workflow must be an acyclic graph: ${workflow.workflowId}`);
    for (const step of ready) {
      ordered.push(step);
      remaining.delete(step.stepId);
      resolved.add(step.stepId);
    }
  }
  return ordered;
}

function layoutWorkflowProjection(
  workflow: WorkflowDefinition,
  workflowInputs: Map<string, BlockRecord[]>,
  operationBlocks: Map<string, BlockRecord>,
  stepOutputs: Map<string, BlockRecord>,
): void {
  const depthByStepId = new Map<string, number>();
  for (const step of topologicalSteps(workflow)) {
    const depth = step.dependsOn.length === 0
      ? 0
      : Math.max(...step.dependsOn.map((stepId) => depthByStepId.get(stepId) ?? 0)) + 1;
    depthByStepId.set(step.stepId, depth);
  }
  const stepsByDepth = new Map<number, WorkflowDefinition['steps']>();
  for (const step of workflow.steps) {
    const depth = depthByStepId.get(step.stepId) ?? 0;
    stepsByDepth.set(depth, [...(stepsByDepth.get(depth) ?? []), step]);
  }
  const maxSiblings = Math.max(...[...stepsByDepth.values()].map((steps) => steps.length));
  for (const [depth, steps] of stepsByDepth) {
    const verticalOffset = (maxSiblings - steps.length) * 180;
    steps.forEach((step, index) => {
      const operation = operationBlocks.get(step.stepId);
      if (!operation) return;
      operation.position = { x: 420 + depth * 760, y: 80 + verticalOffset + index * 360 };
      for (const outputSlotId of step.outputSlots) {
        const output = stepOutputs.get(stepOutputKey(step.stepId, outputSlotId));
        if (output) output.position = { x: operation.position.x + operation.size.width + 80, y: operation.position.y - 24 };
      }
    });
  }
  [...workflowInputs.values()].flat().forEach((block, index) => {
    block.position = { x: 40, y: 270 + index * (block.size.height + 36) };
  });
}
