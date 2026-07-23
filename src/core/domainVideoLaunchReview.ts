import type {
  ProjectArtifactLibraryItem,
  ProjectArtifactLibrarySnapshot,
} from './artifactContracts';
import type { AdapterDefinition } from './capabilityContracts';
import {
  dreaminaCliAdapterDefinition,
  mockVideoAdapterDefinition,
  seedanceModelArkAdapterDefinition,
} from './capabilityRegistry';
import {
  domainVideoGenerationCapabilityId,
  normalizeDomainVideoGenerationParameters,
  type DomainVideoLaunchReviewV1,
  type DomainVideoReferenceBindingV1,
  type ProviderCostDisclosureV1,
} from './domainVideoGenerationContracts';
import {
  GenerationPackageHandoffError,
  type GenerationReferenceRole,
  requireVideoGenerationPackageArtifactRevisionMetadataV2,
} from './generationPreparationContracts';
import type { ExecutionConnectionSummary } from './executionProviders';
import type { AssetRecord, BoardSnapshot } from './types';

export function resolveDomainVideoLaunchReview(input: {
  artifactLibrary: ProjectArtifactLibrarySnapshot;
  connection?: ExecutionConnectionSummary;
  gateSnapshots?: BoardSnapshot[];
  generationPackageArtifactRevisionId: string;
  packageMarkdown: string;
  parameters?: Record<string, unknown>;
  referenceAssets?: AssetRecord[];
  snapshot: BoardSnapshot;
}): DomainVideoLaunchReviewV1 {
  const issues: DomainVideoLaunchReviewV1['issues'] = [];
  const parameters = normalizeDomainVideoGenerationParameters(input.parameters);
  const packageItem = currentGenerationPackage(
    input.artifactLibrary,
    input.generationPackageArtifactRevisionId,
    issues,
  );
  const packageGate = generationPackageGate(
    input.gateSnapshots ?? [input.snapshot],
    input.generationPackageArtifactRevisionId,
    issues,
  );
  const submitSource = providerNeutralSubmitSource(input.packageMarkdown, issues);
  const connection = input.connection;
  const adapter = connection ? domainVideoAdapterForConnection(connection) : undefined;
  validateConnection(connection, adapter, issues);

  const assets = uniqueAssets([
    ...input.snapshot.assets,
    ...(input.referenceAssets ?? []),
  ]);
  let referenceBindings: DomainVideoReferenceBindingV1[] = [];
  let metadata: ReturnType<typeof requireVideoGenerationPackageArtifactRevisionMetadataV2> | undefined;
  if (packageItem) {
    try {
      metadata = requireVideoGenerationPackageArtifactRevisionMetadataV2(packageItem.currentRevision.metadata);
      referenceBindings = resolveReferenceBindings(
        metadata.referenceManifest.items,
        assets,
        input.artifactLibrary,
        issues,
      );
    } catch (error) {
      const handoff = error instanceof GenerationPackageHandoffError ? error : undefined;
      issues.push({
        code: handoff?.code ?? 'generation_video_package_invalid',
        message: error instanceof Error ? error.message : 'Generation Package metadata is invalid.',
      });
    }
  }
  if (metadata && [...submitSource].length > metadata.maxPromptChars) {
    issues.push({
      code: 'generation_video_provider_prompt_budget_exceeded',
      message: `Provider prompt exceeds the Generation Package budget of ${metadata.maxPromptChars} characters.`,
    });
  }
  if (metadata && adapter) {
    validateAdapterReferenceProfile(
      metadata.referenceManifest.items,
      referenceBindings,
      assets,
      adapter,
      issues,
    );
  }

  const costDisclosure = connection
    ? costDisclosureForConnection(connection, parameters.outputCount)
    : undefined;
  const ready = issues.length === 0
    && Boolean(packageItem && metadata && adapter && connection && costDisclosure);
  const requestWithoutFingerprint = ready && packageItem && metadata && adapter && connection
    ? {
        schemaRef: 'retake.domain-video-request/v1' as const,
        generationPackageArtifactRevisionId: packageItem.currentRevision.artifactRevisionId,
        generationPackageAssetId: packageItem.primaryAsset.assetId,
        unitId: metadata.unitId,
        referenceManifestDigest: metadata.referenceManifestDigest,
        referenceBindings,
        packageProfile: {
          aspectRatio: metadata.aspectRatio,
          durationSeconds: metadata.durationSeconds,
          promptLanguage: metadata.promptLanguage,
        },
        launchParameters: parameters,
        adapterId: adapter.adapterId,
        adapterVersion: adapter.version,
        adapterDefinitionHash: adapter.definitionHash,
        connectionId: connection.connectionId,
        provider: adapter.provider ?? connection.providerLabel,
        model: connection.modelId ?? adapter.model ?? 'unknown',
        inputProfileId: 'approved_generation_package_video' as const,
      }
    : undefined;
  const request = requestWithoutFingerprint
    ? {
        ...requestWithoutFingerprint,
        requestFingerprint: fingerprint({
          ...requestWithoutFingerprint,
          packageGate,
          providerPrompt: submitSource,
          costDisclosure,
        }),
      }
    : undefined;
  return {
    schemaRef: 'retake.domain-video-launch-review/v1',
    ready,
    issues,
    ...(request ? { request } : {}),
    ...(costDisclosure ? { costDisclosure } : {}),
    packageGate,
    providerPrompt: {
      characterCount: [...submitSource].length,
      maxCharacterCount: metadata?.maxPromptChars ?? 0,
      preview: submitSource.slice(0, 500),
    },
    route: {
      ...(adapter ? {
        adapterId: adapter.adapterId,
        cancellation: stringConstraint(adapter, 'cancellation'),
        provider: adapter.provider,
        routeKind: adapter.routeKind,
      } : {}),
      ...(connection ? {
        connectionId: connection.connectionId,
        model: connection.modelId ?? adapter?.model,
      } : {}),
    },
  };
}

export function costDisclosureForConnection(
  connection: ExecutionConnectionSummary,
  outputCount: number,
): ProviderCostDisclosureV1 {
  if (connection.connectorId === 'retake-mock') {
    return {
      billingSource: 'no_cost',
      risk: 'none',
      estimateStatus: 'not_applicable',
      note: 'Local contract-only execution; no external Provider action.',
    };
  }
  if (connection.connectorId === 'dreamina') {
    return {
      billingSource: 'membership_credit',
      risk: 'medium',
      estimateStatus: 'unknown',
      note: `${outputCount} separate Provider task${outputCount === 1 ? '' : 's'} will consume membership credits.`,
    };
  }
  if (connection.connectorId === 'byteplus-modelark') {
    return {
      billingSource: 'metered_api',
      risk: 'medium',
      estimateStatus: 'unknown',
      note: `${outputCount} separate metered API task${outputCount === 1 ? '' : 's'}; exact cost is unavailable.`,
    };
  }
  return {
    billingSource: 'unknown',
    risk: 'unknown',
    estimateStatus: 'unknown',
    note: 'The selected Connection has no verified billing disclosure.',
  };
}

export function domainVideoAdapterForConnection(
  connection: ExecutionConnectionSummary,
): AdapterDefinition | undefined {
  if (connection.connectorId === 'retake-mock') return mockVideoAdapterDefinition;
  if (connection.connectorId === 'dreamina') return dreaminaCliAdapterDefinition;
  if (connection.connectorId === 'byteplus-modelark') return seedanceModelArkAdapterDefinition;
  return undefined;
}

function validateConnection(
  connection: ExecutionConnectionSummary | undefined,
  adapter: AdapterDefinition | undefined,
  issues: DomainVideoLaunchReviewV1['issues'],
): void {
  if (!connection) {
    issues.push({
      code: 'generation_video_connection_required',
      message: 'Select a video Connection before checking launch readiness.',
    });
  } else if (
    !connection.enabled
    || connection.status !== 'ready'
    || !connection.enabledUseCases.includes('video')
  ) {
    issues.push({
      code: 'generation_video_connection_unavailable',
      message: `Video Connection is not ready: ${connection.connectionId}`,
    });
  } else if (
    !adapter
    || !connection.supportedCapabilityIds.includes(domainVideoGenerationCapabilityId)
    || !adapter.supportedCapabilityIds.includes(domainVideoGenerationCapabilityId)
    || !adapter.inputProfiles.some((profile) =>
      profile.profileId === 'approved_generation_package_video',
    )
  ) {
    issues.push({
      code: 'generation_video_adapter_incompatible',
      message: `Connection has no Domain Video Adapter profile: ${connection.connectionId}`,
    });
  }
}

function currentGenerationPackage(
  library: ProjectArtifactLibrarySnapshot,
  revisionId: string,
  issues: DomainVideoLaunchReviewV1['issues'],
): ProjectArtifactLibraryItem | undefined {
  if (!revisionId) {
    issues.push({
      code: 'generation_video_package_revision_required',
      message: 'Connect one Generation Package ArtifactRevision.',
    });
    return undefined;
  }
  const item = library.items.find((candidate) =>
    candidate.currentRevision.artifactRevisionId === revisionId,
  );
  if (!item) {
    const historical = library.items.some((candidate) =>
      candidate.revisions.some((revision) => revision.artifactRevisionId === revisionId),
    );
    issues.push({
      code: historical
        ? 'generation_video_package_revision_not_current'
        : 'generation_video_package_revision_required',
      message: historical
        ? 'The connected Generation Package is not the current Revision.'
        : 'The connected Generation Package Revision is unavailable.',
    });
    return undefined;
  }
  if (item.artifact.artifactType !== 'video_generation_package' || item.primaryAsset.kind !== 'document') {
    issues.push({
      code: 'generation_video_package_invalid',
      message: 'Domain Video requires a document-backed video_generation_package Artifact.',
    });
    return undefined;
  }
  return item;
}

function generationPackageGate(
  snapshots: BoardSnapshot[],
  revisionId: string,
  issues: DomainVideoLaunchReviewV1['issues'],
): DomainVideoLaunchReviewV1['packageGate'] {
  const evaluations = snapshots.flatMap((snapshot) =>
    (snapshot.workflowGateEvaluations ?? []).filter((evaluation) =>
      evaluation.gateId === 'generation_package_review'
      && evaluation.subjectArtifactRevisionId === revisionId,
    ),
  );
  const currentPassed = evaluations.find((evaluation) =>
    evaluation.freshness === 'current' && evaluation.status === 'passed',
  );
  if (currentPassed) {
    return {
      evaluationId: currentPassed.gateEvaluationId,
      freshness: 'current',
      status: 'passed',
    };
  }
  const current = evaluations.find((evaluation) => evaluation.freshness === 'current');
  if (evaluations.some((evaluation) => evaluation.status === 'passed')) {
    issues.push({
      code: 'generation_video_package_gate_outdated',
      message: 'The Generation Package approval is outdated.',
    });
    return {
      evaluationId: evaluations.at(-1)?.gateEvaluationId,
      freshness: 'outdated',
      status: evaluations.at(-1)?.status ?? 'missing',
    };
  }
  issues.push({
    code: 'generation_video_package_gate_required',
    message: 'The Generation Package Revision must pass generation_package_review.',
  });
  return {
    evaluationId: current?.gateEvaluationId,
    freshness: current ? 'current' : 'missing',
    status: current?.status ?? 'missing',
  };
}

function resolveReferenceBindings(
  requirements: Array<{
    bindingIdentity?: string;
    requirementId: string;
    required: boolean;
    role: GenerationReferenceRole;
  }>,
  assets: AssetRecord[],
  library: ProjectArtifactLibrarySnapshot,
  issues: DomainVideoLaunchReviewV1['issues'],
): DomainVideoReferenceBindingV1[] {
  const bindings: DomainVideoReferenceBindingV1[] = [];
  for (const requirement of requirements) {
    if (!requirement.bindingIdentity) {
      if (requirement.required) {
        issues.push({
          code: 'generation_video_reference_missing',
          message: `Required reference has no binding: ${requirement.requirementId}`,
        });
      }
      continue;
    }
    const asset = assetForIdentity(requirement.bindingIdentity, assets, library);
    if (!asset) {
      issues.push({
        code: 'generation_video_reference_missing',
        message: `Reference binding is unavailable: ${requirement.requirementId}`,
      });
      continue;
    }
    bindings.push({
      assetId: asset.assetId,
      bindingIdentity: requirement.bindingIdentity,
      requirementId: requirement.requirementId,
      role: requirement.role,
    });
  }
  return bindings;
}

function assetForIdentity(
  identity: string,
  assets: AssetRecord[],
  library: ProjectArtifactLibrarySnapshot,
): AssetRecord | undefined {
  if (identity.startsWith('asset:')) {
    return assets.find((asset) => asset.assetId === identity.slice('asset:'.length));
  }
  if (!identity.startsWith('artifact_revision:')) return undefined;
  const revisionId = identity.slice('artifact_revision:'.length);
  const item = library.items.find((candidate) =>
    candidate.revisions.some((revision) => revision.artifactRevisionId === revisionId),
  );
  const revision = item?.revisions.find((candidate) => candidate.artifactRevisionId === revisionId);
  const assetId = revision?.primaryAssetId;
  return assetId
    ? assets.find((asset) => asset.assetId === assetId)
      ?? (item?.primaryAsset.assetId === assetId ? item.primaryAsset : undefined)
    : undefined;
}

function validateAdapterReferenceProfile(
  requirements: Array<{ role: GenerationReferenceRole }>,
  bindings: DomainVideoReferenceBindingV1[],
  assets: AssetRecord[],
  adapter: AdapterDefinition,
  issues: DomainVideoLaunchReviewV1['issues'],
): void {
  const audioRoles = new Set<GenerationReferenceRole>(['voice', 'ambience', 'sound_effect']);
  if (requirements.some((requirement) => audioRoles.has(requirement.role))) {
    issues.push({
      code: 'generation_video_reference_unsupported',
      message: 'The selected Domain Video Adapter does not support audio references.',
    });
  }
  const boundAssets = bindings.flatMap((binding) => {
    const asset = assets.find((candidate) => candidate.assetId === binding.assetId);
    return asset ? [asset] : [];
  });
  if (boundAssets.some((asset) =>
    asset.kind !== 'image'
    || !asset.mimeType.startsWith('image/')
    || asset.mimeType === 'image/svg+xml'
  )) {
    issues.push({
      code: 'generation_video_reference_unsupported',
      message: 'Domain Video V0 supports readable raster image references only.',
    });
  }
  const roles = new Set(bindings.map((binding) => binding.role));
  if (roles.has('last_frame') && !roles.has('first_frame')) {
    issues.push({
      code: 'generation_video_reference_unsupported',
      message: 'A last_frame reference requires a first_frame reference.',
    });
  }
  const frameMode = roles.has('first_frame') || roles.has('last_frame');
  if (
    frameMode
    && bindings.some((binding) =>
      binding.role !== 'first_frame' && binding.role !== 'last_frame',
    )
  ) {
    issues.push({
      code: 'generation_video_reference_unsupported',
      message: 'Current Domain Video Adapters cannot mix first/last frames with other references.',
    });
  }
  const max = numberConstraint(adapter, 'imageReferenceCount', 'max') ?? 9;
  if (new Set(bindings.map((binding) => binding.assetId)).size > max) {
    issues.push({
      code: 'generation_video_reference_unsupported',
      message: `The selected Adapter supports at most ${max} image references.`,
    });
  }
}

function providerNeutralSubmitSource(
  markdown: string,
  issues: DomainVideoLaunchReviewV1['issues'],
): string {
  const heading = /^#{1,6}\s+Provider-neutral Submit Source\s*$/imu.exec(markdown);
  const tail = heading ? markdown.slice(heading.index + heading[0].length) : '';
  const nextHeading = /^#{1,6}\s+/mu.exec(tail);
  const source = (nextHeading ? tail.slice(0, nextHeading.index) : tail).trim();
  if (!source) {
    issues.push({
      code: 'generation_video_provider_prompt_invalid',
      message: 'Generation Package has no readable Provider-neutral Submit Source.',
    });
  }
  return source;
}

function uniqueAssets(assets: AssetRecord[]): AssetRecord[] {
  return [...new Map(assets.map((asset) => [asset.assetId, asset])).values()];
}

function fingerprint(value: unknown): string {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function numberConstraint(
  adapter: AdapterDefinition,
  key: string,
  child: string,
): number | undefined {
  const value = adapter.constraints[key];
  if (!value || typeof value !== 'object') return undefined;
  const childValue = (value as Record<string, unknown>)[child];
  return typeof childValue === 'number' ? childValue : undefined;
}

function stringConstraint(adapter: AdapterDefinition, key: string): string | undefined {
  const value = adapter.constraints[key];
  return typeof value === 'string' ? value : undefined;
}
