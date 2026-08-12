import { domainVideoGenerationCapabilityId } from '../../core/domainVideoGenerationContracts';
import { createDraftDomainVideoGenerationOperation } from '../../core/domainVideoGenerationOperations';
import { resolveExecutionConnectionPreference } from '../../core/executionProviderPreferences';
import { generationPreparationCapabilityId } from '../../core/generationPreparationContracts';
import { createDraftGenerationPreparationOperation } from '../../core/generationPreparationOperations';
import { nowIso } from '../../core/id';
import type { PackageInvocationContext } from '../../core/packageContracts';
import { storyboardSheetCapabilityId } from '../../core/storyboardSheetContracts';
import { createDraftStoryboardSheetOperation } from '../../core/storyboardSheetOperations';
import {
  createDraftSkillOperation,
  createDraftTextGenerationOperation,
  type SkillDraftInputBinding,
  type TextGenerationLabels,
} from '../../core/textOperations';
import type { BlockRecord, BoardSnapshot } from '../../core/types';
import { moveBlockGroupToNearestFreeArea } from '../../core/workflowPlacement';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardOperationDraftCommandsV1 {
  createSkill(input: WhiteboardSkillDraftInputV1): Promise<{ blockIds: string[] }>;
  createText(input: {
    labels: TextGenerationLabels;
    placementCenter: { x: number; y: number };
  }): Promise<{ blockIds: string[] }>;
}

export interface WhiteboardSkillDraftInputV1 {
  capabilityId: string;
  explicitInputBindings?: SkillDraftInputBinding[];
  initialText?: { body: string; inputSlotId: string };
  labels: TextGenerationLabels;
  packageContext: PackageInvocationContext;
  parameters?: Record<string, unknown>;
  placementCenter: { x: number; y: number };
  referenceManifest?: unknown;
  selectedBlockIds: string[];
  skillId: string;
  unitId?: string;
}

export function createWhiteboardOperationDraftCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardOperationDraftCommandsV1 {
  return Object.freeze({
    async createSkill(input: WhiteboardSkillDraftInputV1) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const blockIds = createSkillDraft(snapshot, input);
        centerDraftBlocks(snapshot, blockIds, input.placementCenter);
        return { blockIds };
      });
      return transaction.result;
    },
    async createText(
      input: Parameters<WhiteboardOperationDraftCommandsV1['createText']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const draft = createDraftTextGenerationOperation(snapshot, {
          ...input.labels,
          connectionId: preferredConnection(snapshot, 'text.generate', 'text'),
        });
        const blockIds = [draft.promptBlock.blockId, draft.operationBlock.blockId];
        centerDraftBlocks(snapshot, blockIds, input.placementCenter);
        return { blockIds };
      });
      return transaction.result;
    },
  });
}

function createSkillDraft(
  snapshot: BoardSnapshot,
  input: WhiteboardSkillDraftInputV1,
): string[] {
  const common = {
    explicitInputBindings: input.explicitInputBindings,
    labels: input.labels,
    packageContext: input.packageContext,
    parameters: input.parameters,
    selectedBlockIds: input.selectedBlockIds,
  };
  if (input.capabilityId === storyboardSheetCapabilityId) {
    const draft = createDraftStoryboardSheetOperation(snapshot, {
      ...common,
      connectionId: preferredConnection(snapshot, input.capabilityId, 'image'),
      unitId: input.unitId,
    });
    return [...draft.inputBlocks.map((block) => block.blockId), draft.operationBlock.blockId];
  }
  if (input.capabilityId === generationPreparationCapabilityId) {
    const draft = createDraftGenerationPreparationOperation(snapshot, {
      ...common,
      connectionId: preferredConnection(snapshot, input.capabilityId, 'text'),
      referenceManifest: input.referenceManifest,
      unitId: input.unitId,
    });
    return [...draft.inputBlocks.map((block) => block.blockId), draft.operationBlock.blockId];
  }
  if (input.capabilityId === domainVideoGenerationCapabilityId) {
    const draft = createDraftDomainVideoGenerationOperation(snapshot, {
      ...common,
      connectionId: preferredConnection(snapshot, input.capabilityId, 'video'),
    });
    return [...draft.inputBlocks.map((block) => block.blockId), draft.operationBlock.blockId];
  }
  const draft = createDraftSkillOperation(snapshot, {
    ...input.labels,
    connectionId: preferredConnection(snapshot, input.capabilityId, 'text'),
    explicitInputBindings: input.explicitInputBindings,
    initialText: input.initialText,
    packageContext: input.packageContext,
    selectedBlockIds: input.selectedBlockIds,
    skillId: input.skillId,
  });
  return [...draft.inputBlocks.map((block) => block.blockId), draft.operationBlock.blockId];
}

function preferredConnection(
  snapshot: BoardSnapshot,
  capabilityId: string,
  useCase: 'image' | 'text' | 'video',
): string | undefined {
  return resolveExecutionConnectionPreference({
    capabilityId,
    initialConnectionId: useCase === 'video' ? 'retake-mock' : 'codex-app-server',
    projectId: snapshot.project.projectId,
    useCase,
  }).connectionId;
}

function centerDraftBlocks(
  snapshot: BoardSnapshot,
  blockIds: readonly string[],
  center: { x: number; y: number },
  gap = 80,
): void {
  const blocks = blockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BlockRecord => Boolean(block));
  if (blocks.length === 0) return;
  const totalWidth = blocks.reduce((sum, block) => sum + block.size.width, 0)
    + Math.max(0, blocks.length - 1) * gap;
  const maxHeight = blocks.reduce((max, block) => Math.max(max, block.size.height), 0);
  let nextX = center.x - totalWidth / 2;
  const nextY = center.y - maxHeight / 2;
  const updatedAt = nowIso();
  for (const block of blocks) {
    block.position = {
      x: nextX,
      y: nextY + (maxHeight - block.size.height) / 2,
    };
    block.updatedAt = updatedAt;
    nextX += block.size.width + gap;
  }
  moveBlockGroupToNearestFreeArea(snapshot, blocks, center);
}
