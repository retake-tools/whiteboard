import path from 'node:path';
import {
  creativeRequestRolesFor,
  type CompiledCreativeRequest,
  type CreativeRequestCapabilityId,
  type CreativeRequestCompileInput,
  type CreativeRequestReferenceRole,
} from '../src/core/creativeRequestCompiler';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { runCodexAppServerTurn } from './codex-app-server-client';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { listExecutionProviderSettings } from './local-store/execution-provider-store';
import { getBoardSnapshot } from './local-store';

interface ResolvedCreativeReference {
  asset: AssetRecord;
  block?: BlockRecord;
  explicitRole?: CreativeRequestReferenceRole;
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
  'You compile a Retake direct creative request into typed capability inputs.',
  'Return JSON matching the provided schema and do not call tools.',
  'Use semantic understanding, not keyword filtering.',
  'Every supplied reference must appear exactly once using its exact mentionId.',
  'Respect explicitRole whenever present.',
  'For image requests, use source only when the user is editing or transforming that image.',
  'Other image roles describe what visual authority the reference contributes.',
  'For video requests, first_frame and last_frame are temporal anchors; environment_reference is scene authority.',
  'Use general_reference when a more specific supported role is not justified.',
  'Write a short purpose in the user language. Do not invent unsupported role identifiers.',
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
  if (references.length === 0 || references.every((reference) => reference.explicitRole)) {
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
    const roles = creativeRequestRolesFor(input.mediaKind);
    const result = await (dependencies.runTurn ?? runCodexAppServerTurn)({
      baseInstructions: compilerInstructions,
      cwd: process.cwd(),
      ephemeral: true,
      localImagePaths: references.map((reference) => reference.localPath),
      model: connection.modelId,
      outputSchema: compilerOutputSchema(input.mediaKind, roles),
      prompt: JSON.stringify({
        instruction,
        mediaKind: input.mediaKind,
        allowedCapabilities: capabilitiesFor(input.mediaKind),
        allowedRoles: roles,
        references: references.map((reference, index) => ({
          attachmentIndex: index + 1,
          mentionId: reference.mentionId,
          label: reference.label,
          assetId: reference.asset.assetId,
          ...(reference.block ? { blockId: reference.block.blockId } : {}),
          ...(reference.explicitRole ? { explicitRole: reference.explicitRole } : {}),
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
  const roles = references.map((reference) => (
    reference.explicitRole ?? 'general_reference'
  ));
  return {
    schemaVersion: 1,
    capabilityId: capabilityForDeterministicRequest(input.mediaKind, roles),
    compiler: { kind: 'deterministic', version: '1' },
    mediaKind: input.mediaKind,
    parameters: structuredClone(input.explicitParameters),
    prompt: input.instruction.trim(),
    references: references.map((reference, index) => ({
      assetId: reference.asset.assetId,
      ...(reference.block ? { blockId: reference.block.blockId } : {}),
      mentionId: reference.mentionId,
      role: roles[index],
    })),
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
    capabilityId?: unknown;
    references?: unknown;
  };
  const allowedCapabilities = capabilitiesFor(input.mediaKind);
  const capabilityId = typeof parsed.capabilityId === 'string'
    && allowedCapabilities.includes(parsed.capabilityId as CreativeRequestCapabilityId)
    ? parsed.capabilityId as CreativeRequestCapabilityId
    : undefined;
  if (!capabilityId || !Array.isArray(parsed.references)) {
    throw new Error('Creative Request Compiler returned an invalid result.');
  }
  const allowedRoles = creativeRequestRolesFor(input.mediaKind);
  const referenceById = new Map(references.map((reference) => [reference.mentionId, reference]));
  const seen = new Set<string>();
  const compiledReferences = parsed.references.map((value) => {
    if (!isRecord(value)) throw new Error('Creative Request Compiler returned an invalid reference.');
    const mentionId = typeof value.mentionId === 'string' ? value.mentionId : '';
    const resolved = referenceById.get(mentionId);
    const inferredRole = typeof value.role === 'string'
      && allowedRoles.includes(value.role as CreativeRequestReferenceRole)
      ? value.role as CreativeRequestReferenceRole
      : undefined;
    const role = resolved?.explicitRole ?? inferredRole;
    if (!resolved || !role || seen.has(mentionId)) {
      throw new Error('Creative Request Compiler returned an unknown or duplicate reference.');
    }
    seen.add(mentionId);
    const purpose = typeof value.purpose === 'string' ? value.purpose.trim() : '';
    return {
      assetId: resolved.asset.assetId,
      ...(resolved.block ? { blockId: resolved.block.blockId } : {}),
      mentionId,
      ...(purpose ? { purpose } : {}),
      role,
    };
  });
  if (seen.size !== references.length) {
    throw new Error('Creative Request Compiler omitted a reference.');
  }
  assertRoleCardinality(input.mediaKind, capabilityId, compiledReferences.map(({ role }) => role));
  return {
    schemaVersion: 1,
    capabilityId,
    compiler: { kind: 'ai', model, version: '1' },
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
    const allowedRoles = creativeRequestRolesFor(input.mediaKind);
    if (reference.explicitRole && !allowedRoles.includes(reference.explicitRole)) {
      throw new Error(`Creative request role is unsupported: ${reference.explicitRole}`);
    }
    return {
      asset,
      ...(block ? { block } : {}),
      ...(reference.explicitRole ? { explicitRole: reference.explicitRole } : {}),
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

function compilerOutputSchema(
  mediaKind: CreativeRequestCompileInput['mediaKind'],
  roles: readonly CreativeRequestReferenceRole[],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      capabilityId: {
        type: 'string',
        enum: capabilitiesFor(mediaKind),
      },
      references: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mentionId: { type: 'string' },
            purpose: { type: 'string' },
            role: { type: 'string', enum: roles },
          },
          required: ['mentionId', 'purpose', 'role'],
        },
      },
    },
    required: ['capabilityId', 'references'],
  };
}

function capabilitiesFor(
  mediaKind: CreativeRequestCompileInput['mediaKind'],
): CreativeRequestCapabilityId[] {
  return mediaKind === 'image'
    ? ['image.text_to_image', 'image.image_to_image']
    : ['video.generate'];
}

function capabilityForDeterministicRequest(
  mediaKind: CreativeRequestCompileInput['mediaKind'],
  roles: readonly CreativeRequestReferenceRole[],
): CreativeRequestCapabilityId {
  if (mediaKind === 'video') return 'video.generate';
  return roles.includes('source') ? 'image.image_to_image' : 'image.text_to_image';
}

function assertRoleCardinality(
  mediaKind: CreativeRequestCompileInput['mediaKind'],
  capabilityId: CreativeRequestCapabilityId,
  roles: readonly CreativeRequestReferenceRole[],
): void {
  const sourceCount = roles.filter((role) => role === 'source').length;
  if (
    mediaKind === 'image'
    && (
      (capabilityId === 'image.image_to_image' && sourceCount !== 1)
      || (capabilityId === 'image.text_to_image' && sourceCount !== 0)
    )
  ) {
    throw new Error('Creative Request Compiler returned inconsistent image source roles.');
  }
  if (
    roles.filter((role) => role === 'first_frame').length > 1
    || roles.filter((role) => role === 'last_frame').length > 1
  ) {
    throw new Error('Creative Request Compiler returned duplicate video frame roles.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
