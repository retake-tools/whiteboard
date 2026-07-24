import { createHash } from 'node:crypto';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import {
  artifactIdentityKey,
  type ArtifactRevisionMetadata,
  type CreateOrAdvanceArtifactResult,
} from '../src/core/artifactContracts';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { workflowDefinitionFor } from '../src/core/workflowRegistry';
import type {
  WorkflowOutputSlotLock,
  WorkflowRunRecord,
  WorkflowStepOutputArtifactBinding,
  WorkflowStepRunRecord,
} from '../src/core/workflowRuntimeContracts';
import { workflowRunViewForId } from '../src/core/workflowRuntime';
import {
  isStoryboardSheetArtifactRevisionMetadata,
  normalizeStoryboardSheetGenerationParameters,
  normalizeStoryboardUnitId,
  storyboardSheetArtifactMetadata,
  type StoryboardSheetArtifactRevisionMetadata,
} from '../src/core/storyboardSheetContracts';
import {
  createOrAdvanceArtifact,
  readProjectArtifacts,
} from './local-store/artifact-store';
import { touchSnapshot } from './local-store/context';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { reconcileAgentArtifactTargets } from './agent-artifact-target-service';
import { reconcileWorkflowArtifactGates } from './workflow-gate-artifact-service';
import {
  generationPackageArtifactMetadata,
  normalizeGenerationPreparationParameters,
  normalizeGenerationReferenceManifest,
} from '../src/core/generationPreparationContracts';
import type { VideoClipArtifactRevisionMetadataV1 } from '../src/core/domainVideoGenerationContracts';

export type WorkflowOutputMaterializationTrigger =
  | { kind: 'execution_succeeded'; executionId: string }
  | { kind: 'output_accepted'; stepRunId: string };

export interface MaterializeWorkflowOutputArtifactsInput {
  boardId: string;
  projectId: string;
  trigger: WorkflowOutputMaterializationTrigger;
}

export interface MaterializeWorkflowOutputArtifactsResult {
  bindings: WorkflowStepOutputArtifactBinding[];
  snapshot: BoardSnapshot;
}

interface MaterializationDependencies {
  afterArtifactWrite?: (input: {
    artifact: CreateOrAdvanceArtifactResult;
    candidate: MaterializationCandidate;
  }) => Promise<void>;
}

interface MaterializationCandidate {
  artifactType: string;
  assetIds: string[];
  executionIds: string[];
  outputSlotId: string;
  primaryAssetId: string;
  metadata?: ArtifactRevisionMetadata;
  sourceArtifactRevisionIds: string[];
  stepRunId: string;
  workflowOutputSlotId: string;
  workflowRunId: string;
}

const materializationTails = new Map<string, Promise<void>>();

export async function materializeWorkflowOutputArtifacts(
  input: MaterializeWorkflowOutputArtifactsInput,
  dependencies: MaterializationDependencies = {},
): Promise<MaterializeWorkflowOutputArtifactsResult> {
  return withMaterializationLock(`${input.projectId}:${input.boardId}`, async () => {
    const initial = await loadSnapshot(input.projectId, input.boardId);
    const scope = resolveTriggerScope(initial, input.trigger);
    if (!scope) return { bindings: [], snapshot: initial };
    const candidates = materializationCandidates(initial, scope.workflowRun, scope.step);
    if (candidates.length === 0) return { bindings: [], snapshot: initial };

    const persistedArtifacts = await readProjectArtifacts(input.projectId);
    const materialized: Array<{
      candidate: MaterializationCandidate;
      result: CreateOrAdvanceArtifactResult;
      expectedStepRunVersion: number;
    }> = [];
    for (const candidate of candidates) {
      const existingBinding = scope.step.outputArtifactBindings.find(
        (binding) => binding.workflowOutputSlotId === candidate.workflowOutputSlotId,
      );
      const existingRevision = existingBinding
        ? persistedArtifacts.revisions.find(
            (revision) => revision.artifactRevisionId === existingBinding.artifactRevisionId,
          )
        : undefined;
      const existingArtifact = existingBinding
        ? persistedArtifacts.artifacts.find(
            (artifact) => artifact.artifactId === existingBinding.artifactId,
          )
        : undefined;
      if (
        existingBinding
        && existingRevision
        && existingArtifact?.currentRevisionId === existingRevision.artifactRevisionId
        && arraysEqual(existingBinding.assetIds, candidate.assetIds)
        && arraysEqual(existingBinding.executionIds, candidate.executionIds)
      ) continue;

      const semanticKey = `workflow_output:${candidate.workflowOutputSlotId}`;
      const identityKey = artifactIdentityKey({
        scope: 'workflow_run',
        semanticKey,
        sourceContext: { workflowRunId: candidate.workflowRunId },
      });
      const currentArtifact = persistedArtifacts.artifacts.find(
        (artifact) => artifactIdentityKey(artifact) === identityKey,
      );
      const currentRevision = currentArtifact
        ? persistedArtifacts.revisions.find(
            (revision) => revision.artifactRevisionId === currentArtifact.currentRevisionId,
          )
        : undefined;
      const executions = executionsForCandidate(initial, candidate);
      const singleExecution = executions.length === 1 ? executions[0] : undefined;
      const result = currentArtifact && currentRevision && revisionMatchesCandidate(
        currentRevision,
        candidate,
      )
        ? {
            artifact: structuredClone(currentArtifact),
            created: false,
            revision: structuredClone(currentRevision),
          }
        : await createOrAdvanceArtifact({
            artifactType: candidate.artifactType,
            assetIds: candidate.assetIds,
            createdByActor: actorFor(input.trigger, singleExecution),
            ...(singleExecution ? { createdByExecutionId: singleExecution.executionId } : {}),
            definitionLocks: {
              capability: structuredClone(scope.step.capabilityLock),
              skill: structuredClone(scope.step.skillLock),
              workflow: structuredClone(scope.workflowRun.workflowDefinitionLock),
            },
            expectedCurrentRevisionId: currentArtifact?.currentRevisionId ?? null,
            idempotencyKey: materializationIdempotencyKey(candidate),
            libraryVisibility: 'hidden',
            ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
            primaryAssetId: candidate.primaryAssetId,
            projectId: input.projectId,
            schemaVersion: 1,
            scope: 'workflow_run',
            semanticKey,
            sourceArtifactRevisionIds: candidate.sourceArtifactRevisionIds,
            sourceAssetIds: unique(executions.flatMap((execution) => execution.inputAssetIds ?? [])),
            sourceContext: {
              boardId: input.boardId,
              operationBlockId: scope.step.operationBlockId,
              outputSlotId: candidate.outputSlotId,
              stepRunId: candidate.stepRunId,
              workflowOutputSlotId: candidate.workflowOutputSlotId,
              workflowRunId: candidate.workflowRunId,
            },
          });
      await dependencies.afterArtifactWrite?.({ artifact: result, candidate });
      materialized.push({
        candidate,
        result,
        expectedStepRunVersion: scope.step.recordVersion,
      });
    }

    if (materialized.length === 0) return { bindings: [], snapshot: initial };
    const latest = await loadSnapshot(input.projectId, input.boardId);
    const latestScope = resolveTriggerScope(latest, input.trigger);
    if (!latestScope) throw new Error('Workflow output materialization trigger is no longer current.');

    const nextBindings: WorkflowStepOutputArtifactBinding[] = [];
    const replacements: WorkflowStepOutputArtifactBinding[] = [];
    for (const item of materialized) {
      const alreadyBound = latestScope.step.outputArtifactBindings.find(
        (binding) => binding.artifactRevisionId === item.result.revision.artifactRevisionId,
      );
      if (alreadyBound) {
        nextBindings.push(structuredClone(alreadyBound));
        continue;
      }
      if (latestScope.step.recordVersion !== item.expectedStepRunVersion) {
        throw new Error(`Workflow StepRun version conflict: ${latestScope.step.stepRunId}`);
      }
      const latestCandidate = materializationCandidates(
        latest,
        latestScope.workflowRun,
        latestScope.step,
      ).find(
        (candidate) => candidate.workflowOutputSlotId === item.candidate.workflowOutputSlotId,
      );
      if (!latestCandidate || !sameCandidate(latestCandidate, item.candidate)) {
        throw new Error(`Workflow output changed during materialization: ${item.candidate.workflowOutputSlotId}`);
      }
      const binding: WorkflowStepOutputArtifactBinding = {
        artifactId: item.result.artifact.artifactId,
        artifactRevisionId: item.result.revision.artifactRevisionId,
        artifactType: item.candidate.artifactType,
        assetIds: [...item.candidate.assetIds],
        boundAt: new Date().toISOString(),
        executionIds: [...item.candidate.executionIds],
        outputSlotId: item.candidate.outputSlotId,
        primaryAssetId: item.candidate.primaryAssetId,
        workflowOutputSlotId: item.candidate.workflowOutputSlotId,
      };
      replacements.push(binding);
      nextBindings.push(structuredClone(binding));
    }
    if (replacements.length === 0) {
      await reconcileWorkflowArtifactGates({
        boardId: input.boardId,
        projectId: input.projectId,
        workflowRunId: latestScope.workflowRun.workflowRunId,
      });
      const reconciled = await reconcileAgentArtifactTargets({
        boardId: input.boardId,
        projectId: input.projectId,
        workflowRunId: latestScope.workflowRun.workflowRunId,
      });
      return { bindings: nextBindings, snapshot: reconciled.snapshot };
    }
    const replacedSlotIds = new Set(
      replacements.map((binding) => binding.workflowOutputSlotId),
    );
    latestScope.step.outputArtifactBindings = [
      ...latestScope.step.outputArtifactBindings.filter(
        (candidate) => !replacedSlotIds.has(candidate.workflowOutputSlotId),
      ),
      ...replacements,
    ];
    latestScope.step.recordVersion += 1;
    latestScope.step.updatedAt = replacements[replacements.length - 1].boundAt;
    touchSnapshot(latest);
    await saveSnapshot(latest);
    await reconcileWorkflowArtifactGates({
      boardId: input.boardId,
      projectId: input.projectId,
      workflowRunId: latestScope.workflowRun.workflowRunId,
    });
    const reconciled = await reconcileAgentArtifactTargets({
      boardId: input.boardId,
      projectId: input.projectId,
      workflowRunId: latestScope.workflowRun.workflowRunId,
    });
    return {
      bindings: nextBindings,
      snapshot: reconciled.snapshot,
    };
  });
}

function resolveTriggerScope(
  snapshot: BoardSnapshot,
  trigger: WorkflowOutputMaterializationTrigger,
): { step: WorkflowStepRunRecord; workflowRun: WorkflowRunRecord } | undefined {
  const execution = trigger.kind === 'execution_succeeded'
    ? snapshot.executions.find((candidate) => candidate.executionId === trigger.executionId)
    : undefined;
  if (trigger.kind === 'execution_succeeded' && (
    !execution
    || execution.status !== 'succeeded'
    || !execution.workflowRunId
    || !execution.stepRunId
  )) return undefined;
  const stepRunId = trigger.kind === 'execution_succeeded'
    ? execution?.stepRunId
    : trigger.stepRunId;
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.stepRunId === stepRunId,
  );
  if (!step) return undefined;
  const workflowRun = (snapshot.workflowRuns ?? []).find(
    (candidate) => candidate.workflowRunId === step.workflowRunId,
  );
  if (
    !workflowRun
    || workflowRun.projectId !== snapshot.project.projectId
    || workflowRun.boardId !== snapshot.board.boardId
  ) return undefined;
  if (
    trigger.kind === 'execution_succeeded'
    && (
      execution?.workflowRunId !== workflowRun.workflowRunId
      || execution.stepRunId !== step.stepRunId
      || step.outputAcceptancePolicy !== 'automatic'
      || step.executionIds.at(-1) !== execution.executionId
    )
  ) return undefined;
  if (
    trigger.kind === 'output_accepted'
    && (
      step.outputAcceptancePolicy === 'automatic'
      || step.acceptedOutputAssetIds.length === 0
    )
  ) return undefined;
  return { step, workflowRun };
}

function materializationCandidates(
  snapshot: BoardSnapshot,
  workflowRun: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
): MaterializationCandidate[] {
  const runtimeStep = workflowRunViewForId(snapshot, workflowRun.workflowRunId)?.steps.find(
    (candidate) => candidate.record.stepRunId === step.stepRunId,
  );
  if (!runtimeStep || runtimeStep.freshness !== 'current' || runtimeStep.status !== 'succeeded') return [];
  const relevantOutputs = workflowOutputLocks(workflowRun).filter(
    (output) => output.stepId === step.stepId,
  );
  return relevantOutputs.flatMap((output): MaterializationCandidate[] => {
    const resolved = outputAssets(snapshot, step, output.outputSlotId);
    if (resolved.assetIds.length === 0 || resolved.executionIds.length === 0) return [];
    const executions = resolved.executionIds.flatMap((executionId) => {
      const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
      return execution ? [execution] : [];
    });
    const metadata = output.artifactType === 'storyboard_sheet'
      ? storyboardSheetMetadataForExecution(executions.at(-1))
      : output.artifactType === 'video_generation_package'
        ? generationPackageMetadataForExecution(executions.at(-1))
        : output.artifactType === 'video_clip'
          ? videoClipMetadataForExecution(
              snapshot,
              executions.at(-1),
              resolved.assetIds[0],
            )
        : undefined;
    return [{
      artifactType: output.artifactType,
      assetIds: resolved.assetIds,
      executionIds: resolved.executionIds,
      outputSlotId: output.outputSlotId,
      primaryAssetId: resolved.assetIds[0],
      ...(metadata ? { metadata } : {}),
      sourceArtifactRevisionIds: unique(executions.flatMap((execution) =>
        execution.inputBindingsSnapshot?.flatMap((binding) => binding.values.flatMap((value) =>
          value.kind === 'artifact_revision' ? [value.artifactRevisionId] : []
        )) ?? [],
      )),
      stepRunId: step.stepRunId,
      workflowOutputSlotId: output.workflowOutputSlotId,
      workflowRunId: workflowRun.workflowRunId,
    }];
  });
}

function workflowOutputLocks(workflowRun: WorkflowRunRecord): WorkflowOutputSlotLock[] {
  if (workflowRun.outputSlotLocks.length > 0) return workflowRun.outputSlotLocks;
  const workflow = workflowDefinitionFor(workflowRun.workflowDefinitionLock.workflowId);
  if (
    workflow.version !== workflowRun.workflowDefinitionLock.version
    || workflow.definitionHash !== workflowRun.workflowDefinitionLock.definitionHash
  ) throw new Error(`Workflow Definition lock mismatch: ${workflow.workflowId}`);
  return workflow.outputSlots.map((output) => {
    const step = workflow.steps.find((candidate) => candidate.stepId === output.source.stepId);
    const capability = step ? capabilityDefinitionFor(step.capabilityLock.capabilityId) : undefined;
    const slot = capability?.outputSlots.find(
      (candidate) => candidate.slotId === output.source.outputSlotId,
    );
    if (!step || !slot?.artifactType) {
      throw new Error(`Workflow output Artifact type is missing: ${output.slotId}`);
    }
    return {
      artifactType: slot.artifactType,
      outputSlotId: output.source.outputSlotId,
      stepId: output.source.stepId,
      workflowOutputSlotId: output.slotId,
    };
  });
}

function outputAssets(
  snapshot: BoardSnapshot,
  step: WorkflowStepRunRecord,
  outputSlotId: string,
): { assetIds: string[]; executionIds: string[] } {
  const executionById = new Map(snapshot.executions.map((execution) => [execution.executionId, execution]));
  if (step.outputAcceptancePolicy === 'automatic') {
    const execution = executionById.get(step.executionIds.at(-1) ?? '');
    if (!execution || execution.status !== 'succeeded') return { assetIds: [], executionIds: [] };
    const slotResult = execution.outputSlotResults?.find((slot) => slot.slotId === outputSlotId);
    const assetIds = unique(slotResult?.assetIds ?? []).filter(
      (assetId) => execution.outputAssetIds.includes(assetId),
    );
    return { assetIds, executionIds: assetIds.length > 0 ? [execution.executionId] : [] };
  }
  const accepted = new Set(step.acceptedOutputAssetIds);
  const executionIds: string[] = [];
  const assetIds: string[] = [];
  for (const executionId of step.executionIds) {
    const execution = executionById.get(executionId);
    if (!execution || execution.status !== 'succeeded') continue;
    const slotResult = execution.outputSlotResults?.find((slot) => slot.slotId === outputSlotId);
    const selected = (slotResult?.assetIds ?? []).filter(
      (assetId) => accepted.has(assetId) && execution.outputAssetIds.includes(assetId),
    );
    if (selected.length === 0) continue;
    executionIds.push(execution.executionId);
    assetIds.push(...selected);
  }
  return { assetIds: unique(assetIds), executionIds: unique(executionIds) };
}

function executionsForCandidate(
  snapshot: BoardSnapshot,
  candidate: MaterializationCandidate,
): ExecutionRecord[] {
  const byId = new Map(snapshot.executions.map((execution) => [execution.executionId, execution]));
  return candidate.executionIds.flatMap((executionId) => {
    const execution = byId.get(executionId);
    return execution ? [execution] : [];
  });
}

function actorFor(
  trigger: WorkflowOutputMaterializationTrigger,
  execution?: ExecutionRecord,
) {
  if (trigger.kind === 'output_accepted') {
    return { actorId: 'user_local', actorType: 'user' as const };
  }
  if (execution?.agentRunId) {
    return {
      actorId: execution.agentRunId,
      actorType: 'agent' as const,
      agentRunId: execution.agentRunId,
    };
  }
  return { actorId: 'workflow_output_materializer', actorType: 'system' as const };
}

function materializationIdempotencyKey(candidate: MaterializationCandidate): string {
  const payload = JSON.stringify({
    assetIds: candidate.assetIds,
    executionIds: candidate.executionIds,
    metadata: candidate.metadata,
    outputSlotId: candidate.outputSlotId,
    stepRunId: candidate.stepRunId,
    workflowOutputSlotId: candidate.workflowOutputSlotId,
    workflowRunId: candidate.workflowRunId,
    sourceArtifactRevisionIds: candidate.sourceArtifactRevisionIds,
  });
  return `workflow-output:${createHash('sha256').update(payload).digest('hex')}`;
}

function sameCandidate(left: MaterializationCandidate, right: MaterializationCandidate): boolean {
  return left.artifactType === right.artifactType
    && left.outputSlotId === right.outputSlotId
    && left.primaryAssetId === right.primaryAssetId
    && left.stepRunId === right.stepRunId
    && left.workflowOutputSlotId === right.workflowOutputSlotId
    && left.workflowRunId === right.workflowRunId
    && arraysEqual(left.assetIds, right.assetIds)
    && arraysEqual(left.executionIds, right.executionIds)
    && arraysEqual(left.sourceArtifactRevisionIds, right.sourceArtifactRevisionIds)
    && JSON.stringify(left.metadata) === JSON.stringify(right.metadata);
}

function revisionMatchesCandidate(
  revision: Awaited<ReturnType<typeof readProjectArtifacts>>['revisions'][number],
  candidate: MaterializationCandidate,
): boolean {
  return revision.primaryAssetId === candidate.primaryAssetId
    && revision.sourceContext?.stepRunId === candidate.stepRunId
    && revision.sourceContext?.outputSlotId === candidate.outputSlotId
    && revision.sourceContext?.workflowOutputSlotId === candidate.workflowOutputSlotId
    && revision.sourceContext?.workflowRunId === candidate.workflowRunId
    && arraysEqual(revision.assetIds, candidate.assetIds)
    && arraysEqual(revision.sourceArtifactRevisionIds, candidate.sourceArtifactRevisionIds)
    && JSON.stringify(revision.metadata) === JSON.stringify(candidate.metadata)
    && (
      candidate.executionIds.length !== 1
      || revision.createdByExecutionId === candidate.executionIds[0]
    );
}

function storyboardSheetMetadataForExecution(
  execution: ExecutionRecord | undefined,
): StoryboardSheetArtifactRevisionMetadata {
  if (!execution) throw new Error('Storyboard Sheet Artifact requires one source Execution.');
  const unitBinding = execution.inputBindingsSnapshot?.find((binding) => binding.slotId === 'unit_id');
  const inlineUnit = unitBinding?.values.find(
    (value): value is Extract<typeof value, { kind: 'inline' }> => value.kind === 'inline',
  );
  const parameters = normalizeStoryboardSheetGenerationParameters(
    objectRecord(execution.params?.storyboardSheet),
  );
  return storyboardSheetArtifactMetadata({
    unitId: normalizeStoryboardUnitId(inlineUnit?.value),
    parameters,
  });
}

function generationPackageMetadataForExecution(
  execution: ExecutionRecord | undefined,
): ArtifactRevisionMetadata {
  if (!execution) throw new Error('Video Generation Package Artifact requires one source Execution.');
  const unitBinding = execution.inputBindingsSnapshot?.find((binding) => binding.slotId === 'unit_id');
  const inlineUnit = unitBinding?.values.find(
    (value): value is Extract<typeof value, { kind: 'inline' }> => value.kind === 'inline',
  );
  const manifestBinding = execution.inputBindingsSnapshot?.find(
    (binding) => binding.slotId === 'reference_manifest',
  );
  const inlineManifest = manifestBinding?.values.find(
    (value): value is Extract<typeof value, { kind: 'inline' }> => value.kind === 'inline',
  );
  const sheetBinding = execution.inputBindingsSnapshot?.find(
    (binding) => binding.slotId === 'storyboard_sheet',
  );
  const sheetRevision = sheetBinding?.values.find(
    (value): value is Extract<typeof value, { kind: 'artifact_revision' }> => value.kind === 'artifact_revision',
  );
  const storyboardSheetMetadata = execution.params?.storyboardSheetMetadata;
  if (!sheetRevision || !isStoryboardSheetArtifactRevisionMetadata(storyboardSheetMetadata)) {
    throw new Error('Video Generation Package source Storyboard Sheet metadata is missing.');
  }
  if (typeof inlineUnit?.value !== 'string') {
    throw new Error('Video Generation Package Unit ID is missing.');
  }
  return generationPackageArtifactMetadata({
    parameters: normalizeGenerationPreparationParameters(
      objectRecord(execution.params?.generationPreparation),
    ),
    referenceManifest: normalizeGenerationReferenceManifest(inlineManifest?.value),
    storyboardSheetArtifactRevisionId: sheetRevision.artifactRevisionId,
    storyboardSheetMetadata,
    unitId: inlineUnit.value,
  });
}

function videoClipMetadataForExecution(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord | undefined,
  assetId: string | undefined,
): VideoClipArtifactRevisionMetadataV1 {
  if (!execution?.domainVideoRequestSnapshot) {
    throw new Error('Video Clip Artifact requires one Domain Video source Execution.');
  }
  if (!assetId) throw new Error('Video Clip Artifact requires one selected Video Asset.');
  const asset = snapshot.assets.find(
    (candidate) => candidate.assetId === assetId && candidate.kind === 'video',
  );
  if (!asset) throw new Error(`Selected Video Asset is unavailable: ${assetId}`);
  const providerCall = execution.providerCalls?.find(
    (call) => call.status === 'succeeded' && call.outputAssetIds.includes(assetId),
  );
  if (!providerCall) {
    throw new Error(`Selected Video Asset has no successful Provider Call: ${assetId}`);
  }
  const request = execution.domainVideoRequestSnapshot;
  return {
    kind: 'video_clip',
    schemaRef: 'retake.video-clip-metadata/v1',
    unitId: request.unitId,
    generationPackageArtifactRevisionId: request.generationPackageArtifactRevisionId,
    executionId: execution.executionId,
    providerCallId: providerCall.providerCallId,
    adapterId: request.adapterId,
    connectionId: request.connectionId,
    provider: request.provider,
    model: request.model,
    targetAspectRatio: request.packageProfile.aspectRatio,
    targetDurationSeconds: request.packageProfile.durationSeconds,
    ...(asset.duration === undefined ? {} : { actualDurationSeconds: asset.duration }),
    ...(asset.width === undefined ? {} : { width: asset.width }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
  };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function withMaterializationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = materializationTails.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  materializationTails.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release?.();
    if (materializationTails.get(key) === tail) materializationTails.delete(key);
  }
}
