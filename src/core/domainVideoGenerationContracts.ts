import type { GenerationReferenceRole } from './generationPreparationContracts';

export const domainVideoGenerationCapabilityId = 'generation.video.generate';
export const domainVideoGenerationSkillId = 'retake.video-generation.from-approved-package';
export const domainVideoGenerationWorkflowId = 'retake.workflow.approved-generation-package-to-video';

export type DomainVideoGenerationErrorCode =
  | 'generation_video_package_revision_required'
  | 'generation_video_package_revision_not_current'
  | 'generation_video_package_gate_required'
  | 'generation_video_package_gate_outdated'
  | 'generation_video_package_manifest_snapshot_required'
  | 'generation_video_package_invalid'
  | 'generation_video_reference_missing'
  | 'generation_video_reference_unsupported'
  | 'generation_video_connection_required'
  | 'generation_video_connection_unavailable'
  | 'generation_video_adapter_incompatible'
  | 'generation_video_provider_prompt_invalid'
  | 'generation_video_provider_prompt_budget_exceeded'
  | 'generation_video_cost_disclosure_required'
  | 'generation_video_authorization_required'
  | 'generation_video_authorization_mismatch';

export class DomainVideoGenerationContractError extends Error {
  readonly code: DomainVideoGenerationErrorCode;

  constructor(code: DomainVideoGenerationErrorCode, message: string) {
    super(message);
    this.name = 'DomainVideoGenerationContractError';
    this.code = code;
  }
}

export interface DomainVideoGenerationParametersV1 {
  outputCount: 1 | 2 | 3 | 4;
  qualityTier: 'preview' | 'final';
}

export interface ProviderCostDisclosureV1 {
  billingSource:
    | 'no_cost'
    | 'metered_api'
    | 'membership_credit'
    | 'provider_credit'
    | 'unknown';
  risk: 'none' | 'low' | 'medium' | 'high' | 'unknown';
  estimateStatus: 'known' | 'estimated' | 'unknown' | 'not_applicable';
  currency?: string;
  estimatedAmount?: string;
  estimatedCredits?: string;
  note?: string;
}

export interface DomainVideoReferenceBindingV1 {
  assetId: string;
  bindingIdentity: string;
  requirementId: string;
  role: GenerationReferenceRole;
}

export interface DomainVideoRequestSnapshotV1 {
  schemaRef: 'retake.domain-video-request/v1';
  generationPackageArtifactRevisionId: string;
  generationPackageAssetId: string;
  unitId: string;
  referenceManifestDigest: string;
  referenceBindings: DomainVideoReferenceBindingV1[];
  packageProfile: {
    aspectRatio: '9:16' | '16:9' | '1:1';
    durationSeconds: number;
    promptLanguage: 'zh' | 'en';
  };
  launchParameters: DomainVideoGenerationParametersV1;
  adapterId: string;
  adapterVersion: string;
  adapterDefinitionHash: string;
  connectionId: string;
  provider: string;
  model: string;
  inputProfileId: 'approved_generation_package_video';
  requestFingerprint: string;
}

export interface DomainVideoLaunchReviewV1 {
  schemaRef: 'retake.domain-video-launch-review/v1';
  ready: boolean;
  issues: Array<{ code: DomainVideoGenerationErrorCode; message: string }>;
  request?: DomainVideoRequestSnapshotV1;
  costDisclosure?: ProviderCostDisclosureV1;
  packageGate: {
    evaluationId?: string;
    freshness: 'current' | 'outdated' | 'missing';
    status: 'passed' | 'failed' | 'waiting_approval' | 'missing';
  };
  providerPrompt: {
    characterCount: number;
    maxCharacterCount: number;
    preview: string;
  };
  route: {
    adapterId?: string;
    cancellation?: string;
    connectionId?: string;
    model?: string;
    provider?: string;
    routeKind?: string;
  };
}

export interface ProviderExecutionAuthorizationV1 {
  schemaRef: 'retake.provider-execution-authorization/v1';
  kind: 'explicit_user_submit' | 'not_required_no_external_action';
  action: 'provider_submit' | 'local_execute';
  authorizedByActorId: string;
  authorizedAt: string;
  generationPackageArtifactRevisionId: string;
  requestFingerprint: string;
  adapterId: string;
  connectionId: string;
  outputCount: number;
  costDisclosure: ProviderCostDisclosureV1;
}

export type ProviderCallStatus =
  | 'queued'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface ProviderCallRecord {
  providerCallId: string;
  executionId: string;
  callIndex: number;
  status: ProviderCallStatus;
  provider: string;
  model: string;
  providerTaskId?: string;
  requestPromptIndex: number;
  outputAssetIds: string[];
  billingSource: ProviderCostDisclosureV1['billingSource'];
  usage?: Record<string, unknown>;
  cost?: {
    currency: string;
    amount: string;
    status: 'estimated' | 'reported';
  };
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface VideoClipArtifactRevisionMetadataV1 {
  kind: 'video_clip';
  schemaRef: 'retake.video-clip-metadata/v1';
  unitId: string;
  generationPackageArtifactRevisionId: string;
  executionId: string;
  providerCallId: string;
  adapterId: string;
  connectionId: string;
  provider: string;
  model: string;
  targetAspectRatio: '9:16' | '16:9' | '1:1';
  targetDurationSeconds: number;
  actualDurationSeconds?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

export const defaultDomainVideoGenerationParameters: DomainVideoGenerationParametersV1 = {
  outputCount: 1,
  qualityTier: 'preview',
};

export function normalizeDomainVideoGenerationParameters(
  value: Record<string, unknown> | undefined,
): DomainVideoGenerationParametersV1 {
  const merged = { ...defaultDomainVideoGenerationParameters, ...(value ?? {}) };
  if (
    merged.outputCount !== 1
    && merged.outputCount !== 2
    && merged.outputCount !== 3
    && merged.outputCount !== 4
  ) {
    throw new DomainVideoGenerationContractError(
      'generation_video_package_invalid',
      'Domain Video outputCount must be between 1 and 4.',
    );
  }
  if (merged.qualityTier !== 'preview' && merged.qualityTier !== 'final') {
    throw new DomainVideoGenerationContractError(
      'generation_video_package_invalid',
      'Domain Video qualityTier must be preview or final.',
    );
  }
  return { outputCount: merged.outputCount, qualityTier: merged.qualityTier };
}

export function isVideoClipArtifactRevisionMetadataV1(
  value: unknown,
): value is VideoClipArtifactRevisionMetadataV1 {
  if (!isRecord(value)) return false;
  return value.kind === 'video_clip'
    && value.schemaRef === 'retake.video-clip-metadata/v1'
    && isNonEmptyString(value.unitId)
    && isNonEmptyString(value.generationPackageArtifactRevisionId)
    && isNonEmptyString(value.executionId)
    && isNonEmptyString(value.providerCallId)
    && isNonEmptyString(value.adapterId)
    && isNonEmptyString(value.connectionId)
    && isNonEmptyString(value.provider)
    && isNonEmptyString(value.model)
    && ['9:16', '16:9', '1:1'].includes(String(value.targetAspectRatio))
    && typeof value.targetDurationSeconds === 'number'
    && Number.isFinite(value.targetDurationSeconds)
    && value.targetDurationSeconds > 0
    && optionalFiniteNumber(value.actualDurationSeconds)
    && optionalFiniteNumber(value.width)
    && optionalFiniteNumber(value.height)
    && (value.hasAudio === undefined || typeof value.hasAudio === 'boolean');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}
