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
  | 'generation_video_cost_disclosure_required';

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
