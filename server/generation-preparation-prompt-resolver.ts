import { readFile } from 'node:fs/promises';
import type { ArtifactRevision, ProjectArtifactSnapshot } from '../src/core/artifactContracts';
import type { CapabilityBindingValue, CapabilityInputBinding } from '../src/core/capabilityContracts';
import {
  generationPreparationCapabilityId,
  GenerationPreparationContractError,
  normalizeGenerationPreparationParameters,
  normalizeGenerationReferenceManifest,
} from '../src/core/generationPreparationContracts';
import type { RetakeSkillSnapshot } from '../src/core/skillRegistry';
import {
  assertStoryboardUnitExists,
  isStoryboardSheetArtifactRevisionMetadata,
  StoryboardSheetContractError,
} from '../src/core/storyboardSheetContracts';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { readProjectArtifacts } from './local-store/artifact-store';
import {
  readAssetMetadata,
  resolveAssetStoragePath,
} from './local-store/asset-files';

export interface GenerationPreparationRequest {
  localImagePaths: string[];
  prompt: string;
}

export async function resolveGenerationPreparationRequest(
  execution: ExecutionRecord,
  snapshot: BoardSnapshot,
): Promise<GenerationPreparationRequest> {
  if (execution.capabilityId !== generationPreparationCapabilityId) {
    throw new Error(`Execution is not Generation Preparation: ${execution.executionId}`);
  }
  const skill = fullSkillSnapshot(execution.skillSnapshot);
  if (!skill) throw new Error('Generation Preparation requires a frozen full Skill snapshot.');
  const bindings = execution.inputBindingsSnapshot ?? skill.inputBindings;
  const artifacts = await readProjectArtifacts(execution.projectId);
  const unitId = requiredInlineString(bindings, 'unit_id');
  const parameters = normalizeGenerationPreparationParameters(
    objectValue(execution.params?.generationPreparation),
  );
  const manifest = normalizeGenerationReferenceManifest(
    requiredInlineValue(bindings, 'reference_manifest'),
  );
  const storyboardPlan = await resolveSingleDocument(
    execution,
    snapshot,
    artifacts,
    requiredBinding(bindings, 'storyboard_plan'),
  );
  try {
    assertStoryboardUnitExists(storyboardPlan, unitId);
  } catch (error) {
    if (error instanceof StoryboardSheetContractError) {
      throw new GenerationPreparationContractError(
        error.code === 'storyboard_unit_ambiguous'
          ? 'generation_package_unit_ambiguous'
          : 'generation_package_unit_not_found',
        error.message,
      );
    }
    throw error;
  }

  const sheetValue = requiredBinding(bindings, 'storyboard_sheet').values[0];
  if (sheetValue?.kind !== 'artifact_revision') {
    throw new GenerationPreparationContractError(
      'generation_package_sheet_revision_required',
      'Generation Preparation requires one Storyboard Sheet ArtifactRevision.',
    );
  }
  const sheetRevision = requiredRevision(artifacts, sheetValue.artifactRevisionId);
  if (!isStoryboardSheetArtifactRevisionMetadata(sheetRevision.metadata)) {
    throw new GenerationPreparationContractError(
      'generation_package_sheet_revision_required',
      'Storyboard Sheet ArtifactRevision metadata is invalid.',
    );
  }
  if (sheetRevision.metadata.unitId !== unitId) {
    throw new GenerationPreparationContractError(
      'generation_package_unit_mismatch',
      `Storyboard Sheet belongs to ${sheetRevision.metadata.unitId}, not ${unitId}.`,
    );
  }

  const referenceBinding = bindings.find((binding) => binding.slotId === 'references');
  const referenceAssets = new Map<string, string>();
  for (const value of referenceBinding?.values ?? []) {
    const resolved = resolveAssetIdentity(value, snapshot, artifacts);
    if (!resolved) {
      throw new GenerationPreparationContractError(
        'generation_package_reference_unsupported',
        'A declared Generation Reference cannot be resolved to an Asset.',
      );
    }
    referenceAssets.set(resolved.identity, resolved.assetId);
    if (resolved.secondaryIdentity) referenceAssets.set(resolved.secondaryIdentity, resolved.assetId);
  }

  const attachmentLines: string[] = [];
  const orderedAssetIds = [sheetRevision.primaryAssetId];
  const attachmentIndexByAssetId = new Map([[sheetRevision.primaryAssetId, 1]]);
  attachmentLines.push(
    `Attachment 1: approved Storyboard Sheet ArtifactRevision ${sheetRevision.artifactRevisionId} for Unit ${unitId}.`,
  );
  for (const requirement of manifest.items) {
    if (!requirement.bindingIdentity) {
      if (requirement.required) {
        throw new GenerationPreparationContractError(
          'generation_package_required_reference_missing',
          `Required reference has no binding: ${requirement.requirementId}`,
        );
      }
      continue;
    }
    const assetId = referenceAssets.get(requirement.bindingIdentity);
    if (!assetId) {
      throw new GenerationPreparationContractError(
        'generation_package_required_reference_missing',
        `Reference binding is unavailable: ${requirement.requirementId}`,
      );
    }
    let attachmentIndex = attachmentIndexByAssetId.get(assetId);
    if (!attachmentIndex) {
      orderedAssetIds.push(assetId);
      attachmentIndex = orderedAssetIds.length;
      attachmentIndexByAssetId.set(assetId, attachmentIndex);
    }
    attachmentLines.push(
      `Attachment ${attachmentIndex}: ${requirement.requirementId}; role=${requirement.role}; `
      + `binding=${requirement.bindingIdentity}; purpose=${requirement.purpose}.`,
    );
  }
  const localImagePaths = await Promise.all(orderedAssetIds.map(async (assetId) => {
    const asset = await readAssetMetadata(execution.projectId, assetId);
    if (!asset.mimeType.startsWith('image/') || asset.mimeType === 'image/svg+xml') {
      throw new GenerationPreparationContractError(
        'generation_package_reference_unsupported',
        `Generation Preparation V0 supports raster image attachments only: ${assetId}`,
      );
    }
    return resolveAssetStoragePath(execution.projectId, assetId);
  }));

  const instructionBinding = bindings.find((binding) => binding.slotId === 'instruction');
  const instruction = instructionBinding
    ? (await Promise.all(instructionBinding.values.map((value) =>
        resolveTextValue(execution, snapshot, artifacts, value),
      ))).filter(Boolean).join('\n\n')
    : '';
  const prompt = [
    skill.instructionTemplate.trim(),
    '# Locked Generation Profile',
    `- Unit ID: ${unitId}`,
    `- Package mode: ${parameters.packageMode}`,
    `- Aspect ratio: ${parameters.aspectRatio}`,
    `- Duration: ${parameters.durationSeconds} seconds`,
    `- Prompt language: ${parameters.promptLanguage}`,
    `- Provider-neutral Submit Source budget: ${parameters.maxPromptChars} characters`,
    '# Attachment order',
    attachmentLines.join('\n'),
    '# Reference Manifest',
    `\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\``,
    '# Storyboard Plan authority',
    storyboardPlan,
    ...(instruction ? ['# User preparation instruction', instruction] : []),
    '# Required Markdown outline',
    [
      '## Authority',
      '## Generation Profile',
      '## Active Subjects',
      '## Reference Mapping',
      '## Storyboard Authority Sequence',
      '### P01 ... (continue in approved panel order)',
      '## State And Continuity',
      '## Dialogue Voice And Sound',
      '## Provider-neutral Submit Source',
      '## Negative Constraints',
      '## Readiness Review',
    ].join('\n'),
    '# Output requirements',
    skill.outputRequirements.map((requirement) => `- ${requirement}`).join('\n'),
    'Return only the Markdown Generation Package. Do not call tools and do not execute video generation.',
  ].join('\n\n');
  return { localImagePaths, prompt };
}

function requiredBinding(
  bindings: CapabilityInputBinding[],
  slotId: string,
): CapabilityInputBinding {
  const binding = bindings.find((candidate) => candidate.slotId === slotId);
  if (!binding || binding.values.length === 0) {
    throw new Error(`Generation Preparation input is missing: ${slotId}`);
  }
  return binding;
}

function requiredInlineValue(bindings: CapabilityInputBinding[], slotId: string): unknown {
  const value = requiredBinding(bindings, slotId).values.find((candidate) => candidate.kind === 'inline');
  if (!value || value.kind !== 'inline') throw new Error(`Generation Preparation inline input is missing: ${slotId}`);
  return value.value;
}

function requiredInlineString(bindings: CapabilityInputBinding[], slotId: string): string {
  const value = requiredInlineValue(bindings, slotId);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Generation Preparation inline text is invalid: ${slotId}`);
  }
  return value.trim();
}

async function resolveSingleDocument(
  execution: ExecutionRecord,
  snapshot: BoardSnapshot,
  artifacts: ProjectArtifactSnapshot,
  binding: CapabilityInputBinding,
): Promise<string> {
  if (binding.values.length !== 1) {
    throw new GenerationPreparationContractError(
      'generation_package_storyboard_plan_missing',
      'Generation Preparation requires exactly one Storyboard Plan.',
    );
  }
  const markdown = await resolveTextValue(execution, snapshot, artifacts, binding.values[0]);
  if (!markdown.trim()) {
    throw new GenerationPreparationContractError(
      'generation_package_storyboard_plan_unreadable',
      'Storyboard Plan is empty or unreadable.',
    );
  }
  return markdown;
}

async function resolveTextValue(
  execution: ExecutionRecord,
  snapshot: BoardSnapshot,
  artifacts: ProjectArtifactSnapshot,
  value: CapabilityBindingValue,
): Promise<string> {
  if (value.kind === 'inline') {
    return typeof value.value === 'string' ? value.value : JSON.stringify(value.value);
  }
  const resolved = resolveAssetIdentity(value, snapshot, artifacts);
  if (!resolved) return '';
  const bytes = await readFile(await resolveAssetStoragePath(execution.projectId, resolved.assetId));
  if (bytes.byteLength > 2 * 1024 * 1024) {
    throw new Error(`Generation Preparation document exceeds 2 MB: ${resolved.assetId}`);
  }
  return bytes.toString('utf8');
}

function resolveAssetIdentity(
  value: CapabilityBindingValue,
  snapshot: BoardSnapshot,
  artifacts: ProjectArtifactSnapshot,
): { assetId: string; identity: string; secondaryIdentity?: string } | undefined {
  if (value.kind === 'asset') return { assetId: value.assetId, identity: `asset:${value.assetId}` };
  if (value.kind === 'artifact_revision') {
    const revision = requiredRevision(artifacts, value.artifactRevisionId);
    return {
      assetId: revision.primaryAssetId,
      identity: `artifact_revision:${revision.artifactRevisionId}`,
      secondaryIdentity: `asset:${revision.primaryAssetId}`,
    };
  }
  if (value.kind === 'block') {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === value.blockId);
    if (!block || typeof block.data.assetId !== 'string') return undefined;
    return {
      assetId: block.data.assetId,
      identity: typeof block.data.artifactRevisionId === 'string'
        ? `artifact_revision:${block.data.artifactRevisionId}`
        : `asset:${block.data.assetId}`,
      ...(typeof block.data.artifactRevisionId === 'string'
        ? { secondaryIdentity: `asset:${block.data.assetId}` }
        : {}),
    };
  }
  return undefined;
}

function requiredRevision(artifacts: ProjectArtifactSnapshot, artifactRevisionId: string): ArtifactRevision {
  const revision = artifacts.revisions.find(
    (candidate) => candidate.artifactRevisionId === artifactRevisionId,
  );
  if (!revision) {
    throw new GenerationPreparationContractError(
      'generation_package_sheet_revision_required',
      `ArtifactRevision is unavailable: ${artifactRevisionId}`,
    );
  }
  return revision;
}

function fullSkillSnapshot(input: ExecutionRecord['skillSnapshot']): RetakeSkillSnapshot | undefined {
  if (!input || !('instructionTemplate' in input) || !('inputBindings' in input)) return undefined;
  return input as RetakeSkillSnapshot;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
