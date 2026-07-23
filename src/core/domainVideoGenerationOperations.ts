import { createBlockRecord, maxZIndex, touchBoard } from './blockFactory';
import {
  domainVideoGenerationCapabilityId,
  domainVideoGenerationSkillId,
  normalizeDomainVideoGenerationParameters,
} from './domainVideoGenerationContracts';
import { createId } from './id';
import type { PackageInvocationContext } from './packageContracts';
import type { SkillDraftInputBinding, TextGenerationLabels } from './textOperations';
import type { BlockRecord, BoardSnapshot } from './types';

export interface DomainVideoGenerationDraftInput {
  connectionId?: string;
  explicitInputBindings?: SkillDraftInputBinding[];
  labels: TextGenerationLabels;
  packageContext?: PackageInvocationContext;
  parameters?: Record<string, unknown>;
  selectedBlockIds?: string[];
}

export interface DomainVideoGenerationDraft {
  inputBlocks: BlockRecord[];
  operationBlock: BlockRecord;
}

export function createDraftDomainVideoGenerationOperation(
  snapshot: BoardSnapshot,
  input: DomainVideoGenerationDraftInput,
): DomainVideoGenerationDraft {
  const explicit = input.explicitInputBindings ?? [];
  const selected = new Set(input.selectedBlockIds ?? []);
  const inputBlocks: BlockRecord[] = [];
  for (const binding of explicit) {
    if (binding.kind !== 'block' || binding.inputSlotId !== 'generation_package') {
      throw new Error('Domain Video Generation requires a Generation Package ArtifactRevision Block.');
    }
    const block = snapshot.blocks.find((candidate) => candidate.blockId === binding.blockId);
    if (!isGenerationPackageBlock(block)) {
      throw new Error(`Domain Video Generation Package Block is incompatible: ${binding.blockId}`);
    }
    inputBlocks.push(block);
  }
  for (const block of snapshot.blocks) {
    if (selected.has(block.blockId) && isGenerationPackageBlock(block) && !inputBlocks.includes(block)) {
      inputBlocks.push(block);
    }
  }
  if (inputBlocks.length > 1) {
    throw new Error('Domain Video Generation accepts exactly one Generation Package Revision.');
  }
  if (inputBlocks.length === 0) {
    const placeholder = createBlockRecord(snapshot, 'document');
    placeholder.data = {
      ...placeholder.data,
      documentKind: 'video_generation_package',
      title: input.labels.promptTitle,
      placeholder: input.labels.promptPlaceholder,
    };
    placeholder.position = { x: 80, y: 80 };
    placeholder.zIndex = maxZIndex(snapshot.blocks) + 1;
    snapshot.blocks.push(placeholder);
    inputBlocks.push(placeholder);
  }

  const parameters = normalizeDomainVideoGenerationParameters(input.parameters);
  const operationBlock = createBlockRecord(snapshot, 'operation');
  operationBlock.data = {
    ...operationBlock.data,
    title: input.labels.operationTitle,
    body: 'Check the approved Generation Package and review Provider submission conditions.',
    capabilityId: domainVideoGenerationCapabilityId,
    skillId: domainVideoGenerationSkillId,
    adapter: 'direct_api',
    triggerMode: 'manual',
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.packageContext ? {
      packageEntrypointId: input.packageContext.entrypointId,
      packageId: input.packageContext.packageLock.packageId,
      packageVersion: input.packageContext.packageLock.version,
      packageDigest: input.packageContext.packageLock.digest,
    } : {}),
    domainVideoGenerationParameters: parameters,
    workflowParameters: parameters,
  };
  const packageBlock = inputBlocks[0]!;
  operationBlock.position = {
    x: packageBlock.position.x + packageBlock.size.width + 90,
    y: packageBlock.position.y,
  };
  operationBlock.zIndex = Math.max(maxZIndex(snapshot.blocks), packageBlock.zIndex) + 1;
  snapshot.blocks.push(operationBlock);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: packageBlock.blockId,
    targetBlockId: operationBlock.blockId,
    kind: 'execution_input',
    inputSlotId: 'generation_package',
  });
  touchBoard(snapshot);
  return { inputBlocks, operationBlock };
}

function isGenerationPackageBlock(block: BlockRecord | undefined): block is BlockRecord {
  return Boolean(
    block
    && block.type === 'document'
    && block.data.artifactType === 'video_generation_package'
    && typeof block.data.artifactRevisionId === 'string'
    && typeof block.data.assetId === 'string',
  );
}
