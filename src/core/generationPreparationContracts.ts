import type { StoryboardSheetArtifactRevisionMetadata } from './storyboardSheetContracts';

export const generationPreparationCapabilityId = 'generation.video_package.prepare';
export const generationPreparationSkillId = 'retake.video-generation-package.from-approved-storyboard';
export const generationPreparationWorkflowId = 'retake.workflow.storyboard-unit-to-generation-package';

export type GenerationPreparationErrorCode =
  | 'generation_package_parameters_invalid'
  | 'generation_package_storyboard_plan_missing'
  | 'generation_package_storyboard_plan_unreadable'
  | 'generation_package_unit_not_found'
  | 'generation_package_unit_ambiguous'
  | 'generation_package_sheet_revision_required'
  | 'generation_package_sheet_gate_required'
  | 'generation_package_sheet_gate_outdated'
  | 'generation_package_unit_mismatch'
  | 'generation_package_reference_manifest_invalid'
  | 'generation_package_required_reference_missing'
  | 'generation_package_reference_unsupported'
  | 'generation_package_adapter_unavailable'
  | 'generation_package_prompt_budget_exceeded'
  | 'generation_package_output_invalid';

export class GenerationPreparationContractError extends Error {
  readonly code: GenerationPreparationErrorCode;

  constructor(code: GenerationPreparationErrorCode, message: string) {
    super(message);
    this.name = 'GenerationPreparationContractError';
    this.code = code;
  }
}

export type GenerationPackageAspectRatio = '9:16' | '16:9' | '1:1';
export type GenerationPackagePromptLanguage = 'zh' | 'en';
export type GenerationReferenceRole =
  | 'character_identity'
  | 'character_scene'
  | 'scene'
  | 'layout'
  | 'prop'
  | 'first_frame'
  | 'last_frame'
  | 'reveal_frame'
  | 'pose'
  | 'expression'
  | 'action'
  | 'motion'
  | 'voice'
  | 'ambience'
  | 'sound_effect'
  | 'general';

export interface GenerationPreparationParameters {
  aspectRatio: GenerationPackageAspectRatio;
  durationSeconds: number;
  maxPromptChars: number;
  packageMode: 'storyboard_authority_sequence';
  promptLanguage: GenerationPackagePromptLanguage;
}

export interface GenerationReferenceRequirement {
  bindingIdentity?: `asset:${string}` | `artifact_revision:${string}`;
  purpose: string;
  required: boolean;
  requirementId: string;
  role: GenerationReferenceRole;
  subjectId?: string;
  subjectLabel?: string;
}

export interface GenerationReferenceManifest {
  items: GenerationReferenceRequirement[];
  schemaRef: 'retake.generation-reference-manifest/v1';
}

interface VideoGenerationPackageArtifactRevisionMetadataBase {
  aspectRatio: GenerationPackageAspectRatio;
  durationSeconds: number;
  kind: 'video_generation_package';
  maxPromptChars: number;
  packageMode: 'storyboard_authority_sequence';
  promptLanguage: GenerationPackagePromptLanguage;
  providerNeutral: true;
  referenceCount: number;
  referenceManifestDigest: string;
  requiredReferenceCount: number;
  storyboardSheetArtifactRevisionId: string;
  storyboardSheetPanelCount: StoryboardSheetArtifactRevisionMetadata['panelCount'];
  unitId: string;
}

export interface VideoGenerationPackageArtifactRevisionMetadataV1
  extends VideoGenerationPackageArtifactRevisionMetadataBase {
  schemaRef: 'retake.video-generation-package-metadata/v1';
}

export interface VideoGenerationPackageArtifactRevisionMetadataV2
  extends VideoGenerationPackageArtifactRevisionMetadataBase {
  referenceManifest: GenerationReferenceManifest;
  schemaRef: 'retake.video-generation-package-metadata/v2';
}

export type VideoGenerationPackageArtifactRevisionMetadata =
  | VideoGenerationPackageArtifactRevisionMetadataV1
  | VideoGenerationPackageArtifactRevisionMetadataV2;

export class GenerationPackageHandoffError extends Error {
  readonly code:
    | 'generation_video_package_invalid'
    | 'generation_video_package_manifest_snapshot_required';

  constructor(
    code: GenerationPackageHandoffError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'GenerationPackageHandoffError';
    this.code = code;
  }
}

export const generationReferenceRoles: readonly GenerationReferenceRole[] = [
  'character_identity',
  'character_scene',
  'scene',
  'layout',
  'prop',
  'first_frame',
  'last_frame',
  'reveal_frame',
  'pose',
  'expression',
  'action',
  'motion',
  'voice',
  'ambience',
  'sound_effect',
  'general',
];

export const defaultGenerationPreparationParameters: GenerationPreparationParameters = {
  aspectRatio: '9:16',
  durationSeconds: 6,
  maxPromptChars: 2000,
  packageMode: 'storyboard_authority_sequence',
  promptLanguage: 'zh',
};

const requiredOutputHeadings = [
  'Authority',
  'Generation Profile',
  'Active Subjects',
  'Reference Mapping',
  'Storyboard Authority Sequence',
  'State And Continuity',
  'Dialogue Voice And Sound',
  'Provider-neutral Submit Source',
  'Negative Constraints',
  'Readiness Review',
] as const;

export function normalizeGenerationPreparationParameters(
  value: Record<string, unknown> | undefined,
): GenerationPreparationParameters {
  const merged = { ...defaultGenerationPreparationParameters, ...(value ?? {}) };
  if (
    merged.aspectRatio !== '9:16'
    && merged.aspectRatio !== '16:9'
    && merged.aspectRatio !== '1:1'
  ) {
    invalidParameters('aspectRatio must be 9:16, 16:9, or 1:1.');
  }
  if (
    typeof merged.durationSeconds !== 'number'
    || !Number.isInteger(merged.durationSeconds)
    || merged.durationSeconds < 4
    || merged.durationSeconds > 15
  ) {
    invalidParameters('durationSeconds must be an integer from 4 through 15.');
  }
  if (merged.promptLanguage !== 'zh' && merged.promptLanguage !== 'en') {
    invalidParameters('promptLanguage must be zh or en.');
  }
  if (
    typeof merged.maxPromptChars !== 'number'
    || !Number.isInteger(merged.maxPromptChars)
    || merged.maxPromptChars < 500
    || merged.maxPromptChars > 4000
  ) {
    invalidParameters('maxPromptChars must be an integer from 500 through 4000.');
  }
  if (merged.packageMode !== 'storyboard_authority_sequence') {
    invalidParameters('packageMode must be storyboard_authority_sequence.');
  }
  return {
    aspectRatio: merged.aspectRatio,
    durationSeconds: merged.durationSeconds,
    maxPromptChars: merged.maxPromptChars,
    packageMode: merged.packageMode,
    promptLanguage: merged.promptLanguage,
  };
}

export function normalizeGenerationReferenceManifest(
  value: unknown,
): GenerationReferenceManifest {
  if (!isRecord(value) || value.schemaRef !== 'retake.generation-reference-manifest/v1') {
    invalidManifest('Reference manifest must use retake.generation-reference-manifest/v1.');
  }
  if (!Array.isArray(value.items)) invalidManifest('Reference manifest items must be an array.');
  const requirementIds = new Set<string>();
  const items = value.items.map((item, index) => {
    if (!isRecord(item)) invalidManifest(`Reference requirement ${index + 1} must be an object.`);
    const requirementId = requiredText(item.requirementId, `items[${index}].requirementId`, 64);
    if (requirementIds.has(requirementId)) {
      invalidManifest(`Reference requirementId must be unique: ${requirementId}`);
    }
    requirementIds.add(requirementId);
    if (!generationReferenceRoles.includes(item.role as GenerationReferenceRole)) {
      invalidManifest(`Unsupported reference role: ${String(item.role)}`);
    }
    if (typeof item.required !== 'boolean') {
      invalidManifest(`items[${index}].required must be boolean.`);
    }
    const bindingIdentity = optionalText(item.bindingIdentity, `items[${index}].bindingIdentity`, 160);
    if (
      bindingIdentity
      && !bindingIdentity.startsWith('asset:')
      && !bindingIdentity.startsWith('artifact_revision:')
    ) {
      invalidManifest(`items[${index}].bindingIdentity must reference an Asset or ArtifactRevision.`);
    }
    return {
      requirementId,
      role: item.role as GenerationReferenceRole,
      required: item.required,
      ...(optionalText(item.subjectId, `items[${index}].subjectId`, 96)
        ? { subjectId: optionalText(item.subjectId, `items[${index}].subjectId`, 96) }
        : {}),
      ...(optionalText(item.subjectLabel, `items[${index}].subjectLabel`, 160)
        ? { subjectLabel: optionalText(item.subjectLabel, `items[${index}].subjectLabel`, 160) }
        : {}),
      ...(bindingIdentity ? { bindingIdentity: bindingIdentity as GenerationReferenceRequirement['bindingIdentity'] } : {}),
      purpose: requiredText(item.purpose, `items[${index}].purpose`, 500),
    };
  });
  return {
    schemaRef: 'retake.generation-reference-manifest/v1',
    items,
  };
}

export function referenceManifestDigest(manifest: GenerationReferenceManifest): string {
  const source = stableStringify(manifest);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function generationPackageArtifactMetadata(input: {
  parameters: GenerationPreparationParameters;
  referenceManifest: GenerationReferenceManifest;
  storyboardSheetArtifactRevisionId: string;
  storyboardSheetMetadata: StoryboardSheetArtifactRevisionMetadata;
  unitId: string;
}): VideoGenerationPackageArtifactRevisionMetadataV2 {
  const unitId = requiredText(input.unitId, 'unitId', 64);
  const referenceManifest = normalizeGenerationReferenceManifest(input.referenceManifest);
  if (input.storyboardSheetMetadata.unitId !== unitId) {
    throw new GenerationPreparationContractError(
      'generation_package_unit_mismatch',
      `Storyboard Sheet belongs to ${input.storyboardSheetMetadata.unitId}, not ${unitId}.`,
    );
  }
  return {
    kind: 'video_generation_package',
    schemaRef: 'retake.video-generation-package-metadata/v2',
    unitId,
    packageMode: input.parameters.packageMode,
    aspectRatio: input.parameters.aspectRatio,
    durationSeconds: input.parameters.durationSeconds,
    promptLanguage: input.parameters.promptLanguage,
    maxPromptChars: input.parameters.maxPromptChars,
    storyboardSheetArtifactRevisionId: requiredText(
      input.storyboardSheetArtifactRevisionId,
      'storyboardSheetArtifactRevisionId',
      160,
    ),
    storyboardSheetPanelCount: input.storyboardSheetMetadata.panelCount,
    referenceManifest,
    referenceManifestDigest: referenceManifestDigest(referenceManifest),
    referenceCount: referenceManifest.items.length,
    requiredReferenceCount: referenceManifest.items.filter((item) => item.required).length,
    providerNeutral: true,
  };
}

export function isVideoGenerationPackageArtifactRevisionMetadata(
  value: unknown,
): value is VideoGenerationPackageArtifactRevisionMetadata {
  return isVideoGenerationPackageArtifactRevisionMetadataV1(value)
    || isVideoGenerationPackageArtifactRevisionMetadataV2(value);
}

export function isVideoGenerationPackageArtifactRevisionMetadataV1(
  value: unknown,
): value is VideoGenerationPackageArtifactRevisionMetadataV1 {
  return commonVideoGenerationPackageMetadataIsValid(value)
    && value.schemaRef === 'retake.video-generation-package-metadata/v1';
}

export function isVideoGenerationPackageArtifactRevisionMetadataV2(
  value: unknown,
): value is VideoGenerationPackageArtifactRevisionMetadataV2 {
  if (!commonVideoGenerationPackageMetadataIsValid(value)) return false;
  if (value.schemaRef !== 'retake.video-generation-package-metadata/v2') return false;
  try {
    const manifest = normalizeGenerationReferenceManifest(value.referenceManifest);
    return stableStringify(value.referenceManifest) === stableStringify(manifest)
      && value.referenceManifestDigest === referenceManifestDigest(manifest)
      && value.referenceCount === manifest.items.length
      && value.requiredReferenceCount === manifest.items.filter((item) => item.required).length;
  } catch {
    return false;
  }
}

export function requireVideoGenerationPackageArtifactRevisionMetadataV2(
  value: unknown,
): VideoGenerationPackageArtifactRevisionMetadataV2 {
  if (isVideoGenerationPackageArtifactRevisionMetadataV2(value)) return value;
  if (isVideoGenerationPackageArtifactRevisionMetadataV1(value)) {
    throw new GenerationPackageHandoffError(
      'generation_video_package_manifest_snapshot_required',
      'Generation Package V1 is reviewable but must be regenerated as V2 before video execution.',
    );
  }
  throw new GenerationPackageHandoffError(
    'generation_video_package_invalid',
    'Video Generation Package metadata is invalid.',
  );
}

function commonVideoGenerationPackageMetadataIsValid(
  value: unknown,
): value is Record<string, unknown> & VideoGenerationPackageArtifactRevisionMetadataBase {
  if (!isRecord(value)) return false;
  try {
    const parameters = normalizeGenerationPreparationParameters(value);
    return value.kind === 'video_generation_package'
      && requiredText(value.unitId, 'unitId', 64) === value.unitId
      && requiredText(value.storyboardSheetArtifactRevisionId, 'storyboardSheetArtifactRevisionId', 160)
        === value.storyboardSheetArtifactRevisionId
      && [6, 8, 10, 12].includes(value.storyboardSheetPanelCount as number)
      && typeof value.referenceManifestDigest === 'string'
      && value.referenceManifestDigest.startsWith('fnv1a:')
      && isNonNegativeInteger(value.referenceCount)
      && isNonNegativeInteger(value.requiredReferenceCount)
      && Number(value.requiredReferenceCount) <= Number(value.referenceCount)
      && value.providerNeutral === true
      && parameters.packageMode === 'storyboard_authority_sequence';
  } catch {
    return false;
  }
}

export function assertGenerationPackageMarkdown(markdown: string, maxPromptChars: number): void {
  if (!markdown.trim()) invalidOutput('Generation Package document is empty.');
  for (const heading of requiredOutputHeadings) {
    const pattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, 'imu');
    if (!pattern.test(markdown)) invalidOutput(`Generation Package is missing heading: ${heading}`);
  }
  const authoritySequence = sectionForHeading(markdown, 'Storyboard Authority Sequence');
  if (!/^#{1,6}\s+P\d{2}\b/imu.test(authoritySequence)) {
    invalidOutput('Storyboard Authority Sequence must contain ordered Pxx panel responsibilities.');
  }
  const submitSource = sectionForHeading(markdown, 'Provider-neutral Submit Source');
  if ([...submitSource].length > maxPromptChars) {
    throw new GenerationPreparationContractError(
      'generation_package_prompt_budget_exceeded',
      `Provider-neutral Submit Source exceeds ${maxPromptChars} characters.`,
    );
  }
  if (/\b(?:seedance|dreamina|runway|kling|veo|sora|modelark)\b/iu.test(submitSource)) {
    invalidOutput('Provider-neutral Submit Source must not contain a provider or model name.');
  }
}

function sectionForHeading(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/u);
  const index = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, 'iu').test(line));
  if (index < 0) return '';
  const level = lines[index].match(/^#+/u)?.[0].length ?? 1;
  const body: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const nextLevel = line.match(/^(#+)\s+/u)?.[1].length;
    if (nextLevel !== undefined && nextLevel <= level) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

function invalidParameters(message: string): never {
  throw new GenerationPreparationContractError('generation_package_parameters_invalid', message);
}

function invalidManifest(message: string): never {
  throw new GenerationPreparationContractError('generation_package_reference_manifest_invalid', message);
}

function invalidOutput(message: string): never {
  throw new GenerationPreparationContractError('generation_package_output_invalid', message);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const result = optionalText(value, field, maxLength);
  if (!result) invalidManifest(`${field} is required.`);
  return result;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalidManifest(`${field} must be text.`);
  const result = value.trim();
  if (!result) invalidManifest(`${field} must not be empty.`);
  if ([...result].length > maxLength) invalidManifest(`${field} must be at most ${maxLength} characters.`);
  return result;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
