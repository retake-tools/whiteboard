import type {
  AgentMessageRecord,
  ChangeProposalCommand,
  PackageEntryPointDraftAppliedEffect,
  PackageEntryPointInvocationLock,
  PackageEntryPointMentionLock,
} from './agentSessionContracts';
import {
  resolvePackageComposerInvocation,
  type PackageComposerInlineValue,
  type PackageComposerMention,
} from './packageComposer';
import { resolvePackageEntryPoint, type ResolvedPackageEntryPointTarget } from './packageRegistry';
import { skillDefinitionFor } from './skillRegistry';
import { createDraftSkillOperation, type TextGenerationLabels } from './textOperations';
import type { BoardSnapshot } from './types';
import { projectWorkflowDraft } from './workflowDraftProjection';
import { createDraftStoryboardSheetOperation } from './storyboardSheetOperations';
import { storyboardSheetCapabilityId } from './storyboardSheetContracts';

type PackageEntrypointInstantiateCommand = Extract<
  ChangeProposalCommand,
  { kind: 'package_entrypoint.instantiate' }
>;

export interface PackageEntrypointDraftPresentation {
  connectionIdForCapability?: (capabilityId: string, snapshot: BoardSnapshot) => string | undefined;
  labelsForSkill?: (skillId: string) => TextGenerationLabels;
  outputPlaceholder?: string;
  workflowTitleForTarget?: (
    target: Extract<ResolvedPackageEntryPointTarget, { kind: 'workflow' }>,
  ) => string;
}

export function buildPackageEntrypointInstantiationCommand(
  snapshot: BoardSnapshot,
  source: AgentMessageRecord,
  proposalId: string,
): PackageEntrypointInstantiateCommand {
  if (
    source.projectId !== snapshot.project.projectId ||
    source.boardId !== snapshot.board.boardId ||
    source.role !== 'user'
  ) throw new Error('Typed EntryPoint Proposal source message is outside the current Board scope.');
  const entrypoints = source.contextRefs.filter((ref) => ref.kind === 'entrypoint');
  if (entrypoints.length !== 1 || entrypoints[0]?.kind !== 'entrypoint') {
    throw new Error('Typed EntryPoint Proposal requires one explicit EntryPoint.');
  }
  const mentions = source.contextRefs.filter(
    (ref): ref is PackageComposerMention => ref.kind === 'block' || ref.kind === 'asset',
  );
  const inlineValues = source.contextRefs.filter(
    (ref): ref is PackageComposerInlineValue => ref.kind === 'inline',
  );
  const resolved = resolvePackageComposerInvocation(snapshot, {
    entrypointId: entrypoints[0].entrypointId,
    inlineValues,
    instruction: source.content,
    mentions,
  });
  return {
    idempotencyKey: `proposal:${proposalId}:package_entrypoint.instantiate`,
    invocation: {
      instruction: resolved.invocation.instruction,
      ...(resolved.instructionSlotId ? { instructionSlotId: resolved.instructionSlotId } : {}),
      inlineValues: structuredClone(resolved.invocation.inlineValues ?? []),
      mentionLocks: resolved.invocation.mentions.map((mention) => lockMention(snapshot, mention)),
      parameters: structuredClone(resolved.invocation.parameters ?? {}),
      targetLock: invocationLock(resolved.target),
    },
    kind: 'package_entrypoint.instantiate',
    schemaVersion: 1,
  };
}

export function stagePackageEntrypointDraft(
  snapshot: BoardSnapshot,
  command: PackageEntrypointInstantiateCommand,
  presentation: PackageEntrypointDraftPresentation = {},
): { effect: PackageEntryPointDraftAppliedEffect; stagedSnapshot: BoardSnapshot } {
  const priorEffect = (snapshot.changeProposals ?? [])
    .map((proposal) => proposal.appliedEffect)
    .find((effect) => effect?.idempotencyKey === command.idempotencyKey);
  if (priorEffect) {
    if (priorEffect.kind !== 'package_entrypoint_draft') {
      throw new Error('Typed EntryPoint Proposal idempotency key conflicts with another effect.');
    }
    return { effect: structuredClone(priorEffect), stagedSnapshot: structuredClone(snapshot) };
  }

  const stagedSnapshot = structuredClone(snapshot);
  const resolved = validateCommand(stagedSnapshot, command);
  const beforeBlockIds = new Set(stagedSnapshot.blocks.map((block) => block.blockId));
  const packageContext = {
    entrypointId: resolved.target.entrypoint.entrypointId,
    packageLock: resolved.target.packageLock,
  };

  let primaryBlockId: string;
  let workflowGroupId: string | undefined;
  if (resolved.target.kind === 'skill') {
    const labels = presentation.labelsForSkill?.(resolved.target.skillLock.skillId)
      ?? defaultLabelsForSkill(resolved.target.skillLock.skillId);
    const explicitInputBindings = command.invocation.mentionLocks.map((mention) => mention.kind === 'block'
      ? { blockId: mention.blockId, inputSlotId: mention.slotId, kind: 'block' as const }
      : { assetId: mention.assetId, inputSlotId: mention.slotId, kind: 'asset' as const });
    const draft = resolved.target.capabilityLock.capabilityId === storyboardSheetCapabilityId
      ? createDraftStoryboardSheetOperation(stagedSnapshot, {
          connectionId: presentation.connectionIdForCapability?.(
            resolved.target.capabilityLock.capabilityId,
            stagedSnapshot,
          ),
          explicitInputBindings,
          labels,
          packageContext,
          parameters: command.invocation.parameters,
          selectedBlockIds: [],
          unitId: command.invocation.inlineValues.find((value) => value.slotId === 'unit_id')?.value,
        })
      : createDraftSkillOperation(stagedSnapshot, {
          ...labels,
          connectionId: presentation.connectionIdForCapability?.(
            resolved.target.capabilityLock.capabilityId,
            stagedSnapshot,
          ),
          explicitInputBindings,
          initialText: command.invocation.instructionSlotId && command.invocation.instruction
            ? {
                body: command.invocation.instruction,
                inputSlotId: command.invocation.instructionSlotId,
              }
            : undefined,
          packageContext,
          selectedBlockIds: [],
          skillId: resolved.target.skillLock.skillId,
        });
    primaryBlockId = draft.operationBlock.blockId;
  } else {
    const projection = projectWorkflowDraft(stagedSnapshot, {
      composerInput: {
        inlineValues: command.invocation.inlineValues,
        instruction: command.invocation.instructionSlotId && command.invocation.instruction
          ? {
              body: command.invocation.instruction,
              slotId: command.invocation.instructionSlotId,
            }
          : undefined,
        mentions: mentionLocksAsMentions(command.invocation.mentionLocks),
        parameters: command.invocation.parameters,
      },
      connectionIdForCapability: (capabilityId) =>
        presentation.connectionIdForCapability?.(capabilityId, stagedSnapshot),
      labelsForSkill: (skillId) =>
        presentation.labelsForSkill?.(skillId) ?? defaultLabelsForSkill(skillId),
      outputPlaceholder: presentation.outputPlaceholder ?? 'Waiting for execution.',
      packageContext,
      workflowId: resolved.target.workflowDefinitionLock.workflowDefinitionId,
      workflowTitle: presentation.workflowTitleForTarget?.(resolved.target)
        ?? resolved.target.entrypoint.name,
    });
    primaryBlockId = projection.groupBlock.blockId;
    workflowGroupId = projection.groupBlock.blockId;
  }

  const createdBlockIds = stagedSnapshot.blocks
    .filter((block) => !beforeBlockIds.has(block.blockId))
    .map((block) => block.blockId);
  const effect: PackageEntryPointDraftAppliedEffect = {
    createdBlockIds,
    entrypointKind: resolved.target.kind,
    idempotencyKey: command.idempotencyKey,
    kind: 'package_entrypoint_draft',
    primaryBlockId,
    ...(workflowGroupId ? { workflowGroupId } : {}),
  };
  return { effect, stagedSnapshot };
}

export function semanticSourceFingerprint(
  snapshot: BoardSnapshot,
  mention: Extract<PackageComposerMention, { kind: 'block' }>,
): string {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
  if (
    !block ||
    block.boardId !== snapshot.board.boardId ||
    (block.type !== 'text' && block.type !== 'document' && block.type !== 'image')
  ) throw new Error(`Typed EntryPoint source Block not found: ${mention.blockId}`);
  const semanticValue = block.type === 'text'
    ? JSON.stringify({ body: stringValue(block.data.body), type: block.type })
    : JSON.stringify({
        assetId: stringValue(block.data.assetId),
        documentKind: stringValue(block.data.documentKind),
        previewUrl: stringValue(block.data.previewUrl),
        type: block.type,
      });
  return `fnv1a:${fnv1a(semanticValue)}`;
}

function validateCommand(
  snapshot: BoardSnapshot,
  command: PackageEntrypointInstantiateCommand,
) {
  if (command.schemaVersion !== 1) throw new Error('Typed EntryPoint Proposal schema version is unsupported.');
  const targetResolution = resolvePackageEntryPoint({
    entrypointId: command.invocation.targetLock.entrypointId,
  });
  if (targetResolution.status !== 'resolved') {
    throw new Error('Typed EntryPoint Proposal EntryPoint is no longer installed.');
  }
  const currentLock = invocationLock(targetResolution.target);
  if (JSON.stringify(currentLock) !== JSON.stringify(command.invocation.targetLock)) {
    throw new Error('Typed EntryPoint Proposal Registry lock has changed.');
  }
  const mentions = mentionLocksAsMentions(command.invocation.mentionLocks);
  for (const mentionLock of command.invocation.mentionLocks) {
    if (mentionLock.kind === 'block') {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === mentionLock.blockId);
      if (
        !block ||
        block.boardId !== snapshot.board.boardId ||
        block.type !== mentionLock.expectedBlockType
      ) throw new Error(`Typed EntryPoint source Block changed: ${mentionLock.blockId}`);
      if (semanticSourceFingerprint(snapshot, mentionLock) !== mentionLock.expectedSourceFingerprint) {
        throw new Error(`Typed EntryPoint source Block content changed: ${mentionLock.blockId}`);
      }
    } else {
      const asset = snapshot.assets.find((candidate) => candidate.assetId === mentionLock.assetId);
      if (
        !asset ||
        asset.projectId !== snapshot.project.projectId ||
        asset.kind !== mentionLock.expectedAssetKind
      ) throw new Error(`Typed EntryPoint source Asset changed: ${mentionLock.assetId}`);
    }
  }
  const resolved = resolvePackageComposerInvocation(snapshot, {
    entrypointId: command.invocation.targetLock.entrypointId,
    inlineValues: command.invocation.inlineValues,
    instruction: command.invocation.instruction,
    mentions,
    parameters: command.invocation.parameters,
  });
  if (resolved.instructionSlotId !== command.invocation.instructionSlotId) {
    throw new Error('Typed EntryPoint Proposal instruction Slot has changed.');
  }
  if (
    JSON.stringify(resolved.invocation.inlineValues ?? [])
    !== JSON.stringify(command.invocation.inlineValues)
  ) {
    throw new Error('Typed EntryPoint Proposal inline inputs are not canonical.');
  }
  if (
    JSON.stringify(resolved.invocation.parameters ?? {})
    !== JSON.stringify(command.invocation.parameters)
  ) {
    throw new Error('Typed EntryPoint Proposal parameters are not canonical.');
  }
  return resolved;
}

function lockMention(snapshot: BoardSnapshot, mention: PackageComposerMention): PackageEntryPointMentionLock {
  if (mention.kind === 'asset') {
    const asset = snapshot.assets.find((candidate) => candidate.assetId === mention.assetId);
    if (
      !asset ||
      asset.projectId !== snapshot.project.projectId ||
      (asset.kind !== 'document' && asset.kind !== 'image')
    ) throw new Error(`Typed EntryPoint source Asset not found: ${mention.assetId}`);
    return {
      assetId: mention.assetId,
      expectedAssetKind: asset.kind,
      kind: 'asset',
      slotId: mention.slotId,
    };
  }
  const block = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
  if (
    !block ||
    block.boardId !== snapshot.board.boardId ||
    (block.type !== 'text' && block.type !== 'document' && block.type !== 'image')
  ) throw new Error(`Typed EntryPoint source Block not found: ${mention.blockId}`);
  return {
    blockId: mention.blockId,
    expectedBlockType: block.type,
    expectedSourceFingerprint: semanticSourceFingerprint(snapshot, mention),
    kind: 'block',
    slotId: mention.slotId,
  };
}

function invocationLock(target: ResolvedPackageEntryPointTarget): PackageEntryPointInvocationLock {
  return target.kind === 'skill'
    ? {
        capabilityLock: structuredClone(target.capabilityLock),
        entrypointId: target.entrypoint.entrypointId,
        entrypointKind: 'skill',
        packageLock: structuredClone(target.packageLock),
        skillLock: structuredClone(target.skillLock),
      }
    : {
        entrypointId: target.entrypoint.entrypointId,
        entrypointKind: 'workflow',
        packageLock: structuredClone(target.packageLock),
        workflowDefinitionLock: structuredClone(target.workflowDefinitionLock),
      };
}

function mentionLocksAsMentions(locks: PackageEntryPointMentionLock[]): PackageComposerMention[] {
  return locks.map((lock) => lock.kind === 'block'
    ? { blockId: lock.blockId, kind: 'block', slotId: lock.slotId }
    : { assetId: lock.assetId, kind: 'asset', slotId: lock.slotId });
}

function defaultLabelsForSkill(skillId: string): TextGenerationLabels {
  const skill = skillDefinitionFor(skillId);
  return {
    operationTitle: skill.name,
    promptPlaceholder: 'Provide an input.',
    promptTitle: 'Input',
    resultTitle: skill.name,
    waitingBody: 'Waiting for execution.',
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
