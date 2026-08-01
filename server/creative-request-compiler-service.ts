import path from 'node:path';
import {
  creativeRequestInputSlotsFor,
  generalReferenceSlot,
  imageInputSlots,
  sourceImageSlot,
  type CompiledCreativeRequest,
  type CompiledCreativeRequestReference,
  type CreativeRequestCapabilityId,
  type CreativeRequestCompileInput,
  type CreativeRequestExplicitBinding,
} from '../src/core/creativeRequestCompiler';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import {
  createReferenceIntent,
} from '../src/core/referenceIntent';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { runCodexAppServerTurn } from './codex-app-server-client';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { listExecutionProviderSettings } from './local-store/execution-provider-store';
import { getBoardSnapshot } from './local-store';

interface ResolvedCreativeReference {
  asset: AssetRecord;
  block?: BlockRecord;
  explicitBinding?: CreativeRequestExplicitBinding;
  label: string;
  localPath: string;
  mentionId: string;
}

interface CreativeRequestCompilerDependencies {
  getSnapshot?: typeof getBoardSnapshot;
  listSettings?: typeof listExecutionProviderSettings;
  resolveAssetPath?: typeof resolveAssetStoragePath;
  runTurn?: typeof runCodexAppServerTurn;
}

const compilerInstructions = [
  'You compile a Retake direct creative request into typed Capability input slots.',
  'Return JSON matching the provided schema and do not call tools.',
  'Use semantic understanding, not keyword filtering.',
  'Every supplied image must appear exactly once using its exact mentionId.',
  'Respect every explicitBinding exactly.',
  'For image requests, bind one image to source_image only when the user wants that image edited as the base.',
  'A request that combines several images into a new image has no source image; bind all of them to references.',
  'For each reference, describe the exact content to borrow in open user language. Do not force it into a fixed style, scene, composition, or character category.',
  'A source image has no reference intent.',
  'For video requests, first_frame and last_frame are temporal anchors; other inputs use the most suitable declared reference Slot.',
  'The Capability is fixed by Retake. Compile only input Slot semantics and never invent an input Slot, Block, Asset, or mention.',
].join('\n');

export async function compileCreativeRequest(
  input: CreativeRequestCompileInput,
  dependencies: CreativeRequestCompilerDependencies = {},
): Promise<CompiledCreativeRequest> {
  const instruction = input.instruction.trim();
  if (!instruction) throw new Error('Creative request instruction is required.');
  const snapshot = await (dependencies.getSnapshot ?? getBoardSnapshot)({
    boardId: input.boardId,
    projectId: input.projectId,
  });
  const references = await resolveReferences(
    snapshot,
    input,
    dependencies.resolveAssetPath ?? resolveAssetStoragePath,
  );
  if (references.length === 0 || references.every(referenceIsFullyExplicit)) {
    return deterministicRequest(input, references);
  }

  try {
    const settings = await (dependencies.listSettings ?? listExecutionProviderSettings)(
      input.projectId,
    );
    const connection = preferredCompilerConnection(settings);
    if (!connection?.modelId) {
      throw new Error('No ready Codex App Server model is configured.');
    }
    const inputSlots = creativeRequestInputSlotsFor(input.mediaKind);
    const result = await (dependencies.runTurn ?? runCodexAppServerTurn)({
      baseInstructions: compilerInstructions,
      cwd: process.cwd(),
      ephemeral: true,
      localImagePaths: references.map((reference) => reference.localPath),
      model: connection.modelId,
      outputSchema: compilerOutputSchema(inputSlots.map((slot) => slot.inputSlotId)),
      prompt: JSON.stringify({
        instruction,
        mediaKind: input.mediaKind,
        capability: (() => {
          const capabilityId = capabilityForMediaKind(input.mediaKind);
          const definition = capabilityDefinitionFor(capabilityId);
          return {
            capabilityId,
            inputSlots: imageInputSlots(definition).map((slot) => ({
              cardinality: slot.cardinality,
              required: slot.required,
              semanticRole: slot.semanticRole,
              slotId: slot.slotId,
            })),
          };
        })(),
        references: references.map((reference, index) => ({
          attachmentIndex: index + 1,
          mentionId: reference.mentionId,
          label: reference.label,
          assetId: reference.asset.assetId,
          ...(reference.block ? { blockId: reference.block.blockId } : {}),
          ...(reference.explicitBinding
            ? { explicitBinding: reference.explicitBinding }
            : {}),
        })),
      }),
      sandbox: 'read-only',
    });
    return parseCompilerResult(input, references, result.text, connection.modelId);
  } catch (error) {
    return {
      ...deterministicRequest(input, references),
      unresolved: [{
        code: 'semantic_mapping_unavailable',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

function deterministicRequest(
  input: CreativeRequestCompileInput,
  references: readonly ResolvedCreativeReference[],
): CompiledCreativeRequest {
  const capabilityId = capabilityForMediaKind(input.mediaKind);
  const definition = capabilityDefinitionFor(capabilityId);
  const fallbackSlot = generalReferenceSlot(definition)
    ?? imageInputSlots(definition).find((slot) => !slot.required)
    ?? imageInputSlots(definition)[0];
  const compiledReferences = references.map((reference) => {
    const explicit = reference.explicitBinding;
    const inputSlotId = explicit?.inputSlotId ?? fallbackSlot?.slotId;
    if (!inputSlotId) {
      throw new Error(`Capability ${capabilityId} has no compatible image reference Slot.`);
    }
    return {
      assetId: reference.asset.assetId,
      ...(reference.block ? { blockId: reference.block.blockId } : {}),
      inputSlotId,
      mentionId: reference.mentionId,
      ...(explicit?.referenceIntent
        ? { referenceIntent: structuredClone(explicit.referenceIntent) }
        : {}),
    };
  });
  assertSlotCardinality(capabilityId, compiledReferences);
  return {
    schemaVersion: 1,
    capabilityId,
    compiler: { kind: 'deterministic', version: '2' },
    mediaKind: input.mediaKind,
    parameters: structuredClone(input.explicitParameters),
    prompt: input.instruction.trim(),
    references: compiledReferences,
    unresolved: [],
  };
}

function parseCompilerResult(
  input: CreativeRequestCompileInput,
  references: readonly ResolvedCreativeReference[],
  text: string,
  model: string,
): CompiledCreativeRequest {
  const parsed = JSON.parse(text) as {
    references?: unknown;
  };
  const capabilityId = capabilityForMediaKind(input.mediaKind);
  if (!Array.isArray(parsed.references)) {
    throw new Error('Creative Request Compiler returned an invalid result.');
  }
  const definition = capabilityDefinitionFor(capabilityId);
  const allowedSlotIds = new Set(imageInputSlots(definition).map((slot) => slot.slotId));
  const sourceSlotId = sourceImageSlot(definition)?.slotId;
  const referenceById = new Map(references.map((reference) => [reference.mentionId, reference]));
  const seen = new Set<string>();
  const compiledReferences = parsed.references.map((value): CompiledCreativeRequestReference => {
    if (!isRecord(value)) throw new Error('Creative Request Compiler returned an invalid reference.');
    const mentionId = typeof value.mentionId === 'string' ? value.mentionId : '';
    const resolved = referenceById.get(mentionId);
    const inferredInputSlotId = typeof value.inputSlotId === 'string'
      && allowedSlotIds.has(value.inputSlotId)
      ? value.inputSlotId
      : undefined;
    const inputSlotId = resolved?.explicitBinding?.inputSlotId ?? inferredInputSlotId;
    if (
      !resolved
      || !inputSlotId
      || !allowedSlotIds.has(inputSlotId)
      || seen.has(mentionId)
    ) {
      throw new Error('Creative Request Compiler returned an unknown, duplicate, or unsupported reference.');
    }
    seen.add(mentionId);
    const inferredIntent = inputSlotId === sourceSlotId
      ? undefined
      : createReferenceIntent(
          typeof value.intentInstruction === 'string' ? value.intentInstruction : '',
          'ai',
          typeof value.intentLabel === 'string' ? value.intentLabel : undefined,
        );
    const referenceIntent = inputSlotId === sourceSlotId
      ? undefined
      : resolved.explicitBinding?.referenceIntent ?? inferredIntent;
    return {
      assetId: resolved.asset.assetId,
      ...(resolved.block ? { blockId: resolved.block.blockId } : {}),
      inputSlotId,
      mentionId,
      ...(referenceIntent
        ? { referenceIntent: structuredClone(referenceIntent) }
        : {}),
    };
  });
  if (seen.size !== references.length) {
    throw new Error('Creative Request Compiler omitted a reference.');
  }
  assertSlotCardinality(capabilityId, compiledReferences);
  return {
    schemaVersion: 1,
    capabilityId,
    compiler: { kind: 'ai', model, version: '2' },
    mediaKind: input.mediaKind,
    parameters: structuredClone(input.explicitParameters),
    prompt: input.instruction.trim(),
    references: compiledReferences,
    unresolved: [],
  };
}

async function resolveReferences(
  snapshot: BoardSnapshot,
  input: CreativeRequestCompileInput,
  resolveAssetPath: typeof resolveAssetStoragePath,
): Promise<ResolvedCreativeReference[]> {
  const seen = new Set<string>();
  const allowedSlotIds = new Set(
    creativeRequestInputSlotsFor(input.mediaKind).map((slot) => slot.inputSlotId),
  );
  return Promise.all(input.references.map(async (reference) => {
    if (!reference.mentionId || seen.has(reference.mentionId)) {
      throw new Error('Creative request reference is duplicated.');
    }
    seen.add(reference.mentionId);
    const mention = reference.mention;
    const block = mention.kind === 'block'
      ? snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId)
      : undefined;
    const assetId = mention.kind === 'asset'
      ? mention.assetId
      : typeof block?.data.assetId === 'string'
        ? block.data.assetId
        : undefined;
    const asset = assetId
      ? snapshot.assets.find((candidate) => candidate.assetId === assetId)
      : undefined;
    if (
      !asset
      || asset.projectId !== input.projectId
      || asset.kind !== 'image'
      || (block && block.type !== 'image')
    ) {
      throw new Error(`Creative request image reference is invalid: ${reference.mentionId}`);
    }
    if (
      reference.explicitBinding
      && !allowedSlotIds.has(reference.explicitBinding.inputSlotId)
    ) {
      throw new Error(
        `Creative request input Slot is unsupported: ${reference.explicitBinding.inputSlotId}`,
      );
    }
    return {
      asset,
      ...(block ? { block } : {}),
      ...(reference.explicitBinding
        ? { explicitBinding: structuredClone(reference.explicitBinding) }
        : {}),
      label: typeof block?.data.title === 'string'
        ? block.data.title
        : path.basename(asset.storageKey),
      localPath: await resolveAssetPath(input.projectId, asset.assetId),
      mentionId: reference.mentionId,
    };
  }));
}

function preferredCompilerConnection(
  settings: Awaited<ReturnType<typeof listExecutionProviderSettings>>,
) {
  const ready = settings.connections.filter((connection) => (
    connection.connectorId === 'codex-app-server'
    && connection.enabled
    && connection.status === 'ready'
    && Boolean(connection.modelId)
  ));
  const preferredIds = [
    settings.projectDefaults.find((value) => value.useCase === 'text')?.connectionId,
    settings.workspaceDefaults.find((value) => value.useCase === 'text')?.connectionId,
    'codex-app-server',
  ];
  return preferredIds
    .map((connectionId) => ready.find((connection) => connection.connectionId === connectionId))
    .find(Boolean) ?? ready[0];
}

function compilerOutputSchema(inputSlotIds: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      references: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mentionId: { type: 'string' },
            inputSlotId: { type: 'string', enum: inputSlotIds },
            intentLabel: { type: 'string' },
            intentInstruction: { type: 'string' },
          },
          required: ['mentionId', 'inputSlotId', 'intentLabel', 'intentInstruction'],
        },
      },
    },
    required: ['references'],
  };
}

function capabilityForMediaKind(
  mediaKind: CreativeRequestCompileInput['mediaKind'],
): CreativeRequestCapabilityId {
  if (mediaKind === 'video') return 'video.generate';
  return 'image.generate';
}

function referenceIsFullyExplicit(reference: ResolvedCreativeReference): boolean {
  const binding = reference.explicitBinding;
  if (!binding) return false;
  if (binding.inputSlotId === 'source_image') return true;
  return Boolean(binding.referenceIntent?.instruction.trim());
}

function assertSlotCardinality(
  capabilityId: CreativeRequestCapabilityId,
  references: readonly CompiledCreativeRequestReference[],
): void {
  const definition = capabilityDefinitionFor(capabilityId);
  const imageSlots = imageInputSlots(definition);
  const counts = new Map<string, number>();
  for (const reference of references) {
    const slot = imageSlots.find((candidate) => candidate.slotId === reference.inputSlotId);
    if (!slot) {
      throw new Error(
        `Creative Request Compiler returned unsupported input Slot ${reference.inputSlotId}.`,
      );
    }
    counts.set(slot.slotId, (counts.get(slot.slotId) ?? 0) + 1);
  }
  for (const slot of imageSlots) {
    const count = counts.get(slot.slotId) ?? 0;
    if (slot.required && count === 0) {
      throw new Error(`Creative Request Compiler omitted required input Slot ${slot.slotId}.`);
    }
    if (slot.cardinality !== 'many' && count > 1) {
      throw new Error(`Creative Request Compiler exceeded input Slot ${slot.slotId}.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
