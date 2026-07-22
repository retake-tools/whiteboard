import { capabilityDefinitionFor } from './capabilityRegistry';
import { createBlockRecord, touchBoard } from './blockFactory';
import { createGroupAroundBlocks } from './grouping';
import { createId } from './id';
import type { PackageInvocationContext } from './packageContracts';
import type { PackageComposerMention } from './packageComposer';
import { createDraftSkillOperation, type TextGenerationLabels } from './textOperations';
import type { BlockRecord, BoardSnapshot } from './types';
import {
  validateWorkflowDefinition,
  workflowDefinitionFor,
  type WorkflowDefinition,
} from './workflowRegistry';

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
      instruction?: { body: string; slotId: string };
      mentions: PackageComposerMention[];
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
  const workflowInputs = new Map<string, BlockRecord>();
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
    const mention = input.composerInput?.mentions.find((candidate) => candidate.slotId === slot.slotId);
    const instruction = input.composerInput?.instruction?.slotId === slot.slotId
      ? input.composerInput.instruction.body.trim()
      : undefined;
    const block = createWorkflowInputBlock(snapshot, {
      artifactType: slot.artifactTypes[0],
      instruction,
      mention,
      promptPlaceholder: slotLabels?.promptPlaceholder ?? labels.promptPlaceholder,
      promptTitle: slotLabels?.promptTitle ?? labels.promptTitle,
    });
    block.data = {
      ...block.data,
      ...metadata,
      workflowInputSlotId: slot.slotId,
    };
    snapshot.blocks.push(block);
    workflowInputs.set(slot.slotId, block);
    createdBlocks.push(block);
  }

  for (const step of topologicalSteps(workflow)) {
    const selectedBlockIds = step.inputBindings.map((binding) => {
      if (binding.source.kind === 'workflow_input') {
        const block = workflowInputs.get(binding.source.slotId);
        if (!block) throw new Error(`Workflow input projection not found: ${binding.source.slotId}`);
        return block.blockId;
      }
      const block = stepOutputs.get(stepOutputKey(binding.source.stepId, binding.source.outputSlotId));
      if (!block) {
        throw new Error(`Workflow step output projection not found: ${binding.source.stepId}.${binding.source.outputSlotId}`);
      }
      return block.blockId;
    });
    const labels = input.labelsForSkill(step.skillLock.skillId);
    const draft = createDraftSkillOperation(snapshot, {
      ...labels,
      connectionId: input.connectionIdForCapability(step.capabilityLock.capabilityId),
      selectedBlockIds,
      skillId: step.skillLock.skillId,
    });
    draft.operationBlock.data = {
      ...draft.operationBlock.data,
      ...metadata,
      workflowStepId: step.stepId,
    };
    operationBlocks.set(step.stepId, draft.operationBlock);
    createdBlocks.push(...draft.inputBlocks.filter((block) => !createdBlocks.includes(block)), draft.operationBlock);

    const capability = capabilityDefinitionFor(step.capabilityLock.capabilityId);
    for (const outputSlotId of step.outputSlots) {
      const outputSlot = capability.outputSlots.find((candidate) => candidate.slotId === outputSlotId);
      if (!outputSlot) throw new Error(`Capability output slot not found: ${capability.capabilityId}.${outputSlotId}`);
      if (outputSlot.dataType !== 'document') {
        throw new Error(`Workflow Draft Projection V0 only supports Document outputs: ${capability.capabilityId}.${outputSlotId}`);
      }
      const resultBlock = createBlockRecord(snapshot, 'document');
      resultBlock.data = {
        ...resultBlock.data,
        ...metadata,
        title: labels.resultTitle,
        placeholder: input.outputPlaceholder,
        documentKind: outputSlot.artifactType ?? 'general',
        managedDocumentResult: true,
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
  groupBlock.data = { ...groupBlock.data, ...metadata };
  touchBoard(snapshot);

  return {
    projectionId,
    groupBlock,
    blockIds: [groupBlock.blockId, ...createdBlocks.map((block) => block.blockId)],
    workflowInputBlockIds: [...workflowInputs.values()].map((block) => block.blockId),
    operationBlockIds: [...operationBlocks.values()].map((block) => block.blockId),
    resultBlockIds: [...stepOutputs.values()].map((block) => block.blockId),
  };
}

function createWorkflowInputBlock(
  snapshot: BoardSnapshot,
  input: {
    artifactType?: string;
    instruction?: string;
    mention?: PackageComposerMention;
    promptPlaceholder: string;
    promptTitle: string;
  },
): BlockRecord {
  const mention = input.mention;
  if (mention?.kind === 'asset') {
    const asset = snapshot.assets.find((candidate) => candidate.assetId === mention.assetId && candidate.kind === 'document');
    if (!asset) throw new Error(`Workflow Composer Document Asset not found: ${mention.assetId}`);
    const block = createBlockRecord(snapshot, 'document');
    block.data = {
      ...block.data,
      title: input.promptTitle,
      assetId: asset.assetId,
      composerSourceAssetId: asset.assetId,
      documentKind: input.artifactType ?? 'markdown_document',
    };
    return block;
  }
  if (mention?.kind === 'block') {
    const source = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
    if (!source || (source.type !== 'text' && source.type !== 'document')) {
      throw new Error(`Workflow Composer input Block not found: ${mention.blockId}`);
    }
    const assetId = typeof source.data.assetId === 'string' ? source.data.assetId : undefined;
    const block = createBlockRecord(snapshot, assetId ? 'document' : 'text');
    block.data = {
      ...block.data,
      title: input.promptTitle,
      ...(assetId ? {
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
  const block = createBlockRecord(snapshot, 'text');
  block.data = {
    ...block.data,
    title: input.promptTitle,
    body: input.instruction ?? '',
    placeholder: input.promptPlaceholder,
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
  workflowInputs: Map<string, BlockRecord>,
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
  [...workflowInputs.values()].forEach((block, index) => {
    block.position = { x: 40, y: 270 + index * (block.size.height + 36) };
  });
}
