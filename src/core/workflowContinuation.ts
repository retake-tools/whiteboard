import type { ProjectArtifactLibraryItem, ProjectArtifactLibrarySnapshot } from './artifactContracts';
import {
  listPackageComposerMentionOptions,
  type PackageComposerMention,
} from './packageComposer';
import {
  listPackageEntryPoints,
} from './packageRegistry';
import type { BoardSnapshot } from './types';
import { workflowDefinitionFor } from './workflowRegistry';

export type WorkflowContinuationGateStatus =
  | 'not_required'
  | 'passed'
  | 'waiting_approval'
  | 'rejected'
  | 'outdated';

export type WorkflowContinuationBlockedReason =
  | 'source_missing'
  | 'artifact_pin_incomplete'
  | 'artifact_not_found'
  | 'artifact_outdated'
  | 'gate_waiting_approval'
  | 'gate_rejected'
  | 'gate_outdated';

export interface WorkflowContinuationCandidate {
  candidateId: string;
  entrypointId: string;
  inlineValuesBySlot: Record<string, string>;
  inputSlotId: string;
  mention: Extract<PackageComposerMention, { kind: 'block' }>;
  missingRequiredSlotIds: string[];
  packageId: string;
  recommended: boolean;
  workflowDefinitionId: string;
}

export interface WorkflowContinuationSource {
  artifactId: string;
  artifactRevisionId: string;
  artifactType: string;
  blockId: string;
  current: boolean;
  gateStatus: WorkflowContinuationGateStatus;
}

export type WorkflowContinuationResolution =
  | {
      blockedReason: WorkflowContinuationBlockedReason;
      candidates: [];
      source?: WorkflowContinuationSource;
      status: 'blocked';
    }
  | {
      candidates: WorkflowContinuationCandidate[];
      source: WorkflowContinuationSource;
      status: 'ready';
    };

export function resolveWorkflowContinuation(
  snapshot: BoardSnapshot,
  authority: ProjectArtifactLibrarySnapshot,
  sourceBlockId: string,
): WorkflowContinuationResolution {
  if (authority.projectId !== snapshot.project.projectId) {
    return blocked('artifact_not_found');
  }
  const block = snapshot.blocks.find((candidate) => candidate.blockId === sourceBlockId);
  if (!block) return blocked('source_missing');
  const artifactId = stringValue(block.data.artifactId);
  const artifactRevisionId = stringValue(block.data.artifactRevisionId);
  const artifactType = stringValue(block.data.artifactType);
  if (!artifactId || !artifactRevisionId || !artifactType) {
    return blocked('artifact_pin_incomplete');
  }
  const item = authority.items.find((candidate) => candidate.artifact.artifactId === artifactId);
  if (!item || item.artifact.artifactType !== artifactType) {
    return blocked('artifact_not_found');
  }
  const current = item.currentRevision.artifactRevisionId === artifactRevisionId;
  const gateStatus = gateStatusForRevision(snapshot, artifactRevisionId);
  const source: WorkflowContinuationSource = {
    artifactId,
    artifactRevisionId,
    artifactType,
    blockId: block.blockId,
    current,
    gateStatus,
  };
  if (!current) return blocked('artifact_outdated', source);
  if (gateStatus === 'waiting_approval') return blocked('gate_waiting_approval', source);
  if (gateStatus === 'rejected') return blocked('gate_rejected', source);
  if (gateStatus === 'outdated') return blocked('gate_outdated', source);
  return {
    candidates: continuationCandidates(snapshot, block.blockId, item),
    source,
    status: 'ready',
  };
}

function continuationCandidates(
  snapshot: BoardSnapshot,
  blockId: string,
  item: ProjectArtifactLibraryItem,
): WorkflowContinuationCandidate[] {
  const candidates: WorkflowContinuationCandidate[] = [];
  for (const registration of listPackageEntryPoints()) {
    if (registration.entrypoint.kind !== 'workflow') continue;
    const workflow = workflowDefinitionFor(registration.entrypoint.ref.workflowDefinitionId);
    const options = listPackageComposerMentionOptions(
      snapshot,
      registration.entrypoint.entrypointId,
    ).filter((option) => {
      if (option.kind !== 'block' || option.blockId !== blockId) return false;
      const slot = workflow.inputSlots.find((candidate) => candidate.slotId === option.slotId);
      return slot?.artifactTypes.includes(item.artifact.artifactType) === true;
    });
    for (const option of options) {
      const inlineValuesBySlot = inheritedInlineValues(item, workflow.inputSlots);
      const occupiedSlotIds = new Set([
        option.slotId,
        ...Object.keys(inlineValuesBySlot),
        ...workflow.inputSlots
          .filter((slot) => slot.schemaRef === 'retake.generation-reference-manifest/v1')
          .map((slot) => slot.slotId),
      ]);
      candidates.push({
        candidateId: `${registration.entrypoint.entrypointId}:${option.slotId}`,
        entrypointId: registration.entrypoint.entrypointId,
        inlineValuesBySlot,
        inputSlotId: option.slotId,
        mention: {
          blockId,
          kind: 'block',
          slotId: option.slotId,
        },
        missingRequiredSlotIds: workflow.inputSlots
          .filter((slot) => slot.required && !occupiedSlotIds.has(slot.slotId))
          .map((slot) => slot.slotId),
        packageId: registration.packageLock.packageId,
        recommended: registration.entrypoint.recommended === true,
        workflowDefinitionId: workflow.workflowId,
      });
    }
  }
  return candidates;
}

function inheritedInlineValues(
  item: ProjectArtifactLibraryItem,
  slots: ReturnType<typeof workflowDefinitionFor>['inputSlots'],
): Record<string, string> {
  if (!slots.some((slot) => slot.slotId === 'unit_id')) return {};
  const metadata = item.currentRevision.metadata;
  const unitId = metadata && typeof metadata === 'object' && 'unitId' in metadata
    ? stringValue(metadata.unitId)
    : undefined;
  return unitId ? { unit_id: unitId } : {};
}

function gateStatusForRevision(
  snapshot: BoardSnapshot,
  artifactRevisionId: string,
): WorkflowContinuationGateStatus {
  const evaluations = (snapshot.workflowGateEvaluations ?? []).filter(
    (evaluation) => evaluation.subjectArtifactRevisionId === artifactRevisionId,
  );
  if (evaluations.length === 0) return 'not_required';
  const current = evaluations.filter((evaluation) => evaluation.freshness === 'current');
  if (current.length === 0) return 'outdated';
  if (current.some((evaluation) => evaluation.status === 'failed')) return 'rejected';
  if (current.some((evaluation) => evaluation.status === 'waiting_approval')) {
    return 'waiting_approval';
  }
  return 'passed';
}

function blocked(
  blockedReason: WorkflowContinuationBlockedReason,
  source?: WorkflowContinuationSource,
): WorkflowContinuationResolution {
  return {
    blockedReason,
    candidates: [],
    ...(source ? { source } : {}),
    status: 'blocked',
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
