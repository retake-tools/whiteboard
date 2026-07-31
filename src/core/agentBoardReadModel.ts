import { operationReadinessFor, type OperationReadiness } from './capabilities';
import type { AgentRunRecord } from './agentRuntimeContracts';
import {
  agentBoardReadModelBudget,
  type AgentBoardBlockSummaryV1,
  type AgentBoardGateSummaryV1,
  type AgentBoardOperationSummaryV1,
  type AgentBoardReadModelFocusV1,
  type AgentBoardReadModelV1,
  type AgentBoardSummaryV1,
  type AgentBoardWorkflowRunSummaryV1,
} from './agentBoardReadModelContracts';
import { sha256Hex } from './sha256';
import type {
  BlockRecord,
  BlockType,
  BoardSnapshot,
  ExecutionResultSummary,
  ExecutionStatus,
} from './types';
import type {
  WorkflowRunStatus,
  WorkflowStepRunRecord,
  WorkflowStepRunStatus,
} from './workflowRuntimeContracts';
import type { WorkflowGateEvaluationStatus } from './workflowGateContracts';

export function buildAgentBoardReadModel(
  snapshot: BoardSnapshot,
  focus: AgentBoardReadModelFocusV1 = { mentionedBlockIds: [] },
): AgentBoardReadModelV1 {
  const strings = { truncated: false };
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));
  const readinessByOperationId = new Map(
    snapshot.blocks
      .filter((block) => block.type === 'operation')
      .map((block) => [block.blockId, operationReadinessFor(snapshot, block)] as const),
  );
  const activeWorkflowRunId = workflowRunIdFor(focus.activeAgentRun);
  const stepByOperationId = workflowStepByOperationId(snapshot, activeWorkflowRunId);
  const selectedGates = selectedGateEvaluations(snapshot);
  const gateOperationIds = new Set(selectedGates.flatMap((evaluation) => {
    const operationBlockId = gateSubjectOperationBlockId(snapshot, evaluation.workflowRunId, evaluation.gateId);
    return operationBlockId ? [operationBlockId] : [];
  }));
  const focusIds = new Set(focus.mentionedBlockIds.filter((blockId) => blockById.has(blockId)));
  const runOperationIds = new Set([
    ...(focus.activeAgentRun?.currentOperationBlockId ? [focus.activeAgentRun.currentOperationBlockId] : []),
    ...(focus.activeAgentRun?.scope.allowedOperationBlockIds ?? []),
  ]);
  const latestExecutionByOperationId = new Map(
    snapshot.blocks
      .filter((block) => block.type === 'operation')
      .map((block) => [block.blockId, latestExecutionForOperation(snapshot, block)] as const),
  );
  const priorityFor = (block: BlockRecord): number => blockPriority(
    block,
    focusIds,
    runOperationIds,
    gateOperationIds,
    readinessByOperationId.get(block.blockId),
    latestExecutionByOperationId.get(block.blockId)?.status,
    stepByOperationId.get(block.blockId),
  );
  const orderedBlocks = [...snapshot.blocks].sort((left, right) =>
    priorityFor(left) - priorityFor(right)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.blockId.localeCompare(right.blockId));
  const orderedOperations = orderedBlocks.filter((block) => block.type === 'operation');
  const blocks = orderedBlocks
    .slice(0, agentBoardReadModelBudget.maxBlockSummaries)
    .map((block) => blockSummary(block, assetById, strings));
  const operations = orderedOperations
    .slice(0, agentBoardReadModelBudget.maxOperationSummaries)
    .map((block) => operationSummary(
      snapshot,
      block,
      blockById,
      readinessByOperationId.get(block.blockId) ?? { canRun: false, issues: [] },
      latestExecutionByOperationId.get(block.blockId),
      stepByOperationId.get(block.blockId),
      strings,
    ));
  const orderedWorkflowRuns = [...(snapshot.workflowRuns ?? [])].sort((left, right) => {
    return Number(right.workflowRunId === activeWorkflowRunId)
      - Number(left.workflowRunId === activeWorkflowRunId)
      || workflowRunPriority(left.status) - workflowRunPriority(right.status)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.workflowRunId.localeCompare(right.workflowRunId);
  });
  const workflowRuns = orderedWorkflowRuns
    .slice(0, agentBoardReadModelBudget.maxWorkflowRunSummaries)
    .map((run) => workflowRunSummary(snapshot, run.workflowRunId));
  const orderedGates = [...selectedGates].sort((left, right) =>
    gatePriority(left.status) - gatePriority(right.status)
      || Number(right.freshness === 'current') - Number(left.freshness === 'current')
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.gateEvaluationId.localeCompare(right.gateEvaluationId));
  const gates = orderedGates
    .slice(0, agentBoardReadModelBudget.maxGateSummaries)
    .map((evaluation) => gateSummary(snapshot, evaluation.workflowRunId, evaluation.gateId, strings));
  const base = {
    blocks,
    budget: agentBoardReadModelBudget,
    gates,
    operations,
    schemaRef: 'retake.agent-board-read-model/v1' as const,
    source: {
      boardId: snapshot.board.boardId,
      boardUpdatedAt: snapshot.board.updatedAt,
      projectId: snapshot.project.projectId,
    },
    summary: boardSummary(
      snapshot,
      readinessByOperationId,
      latestExecutionByOperationId,
      selectedGates,
      strings,
    ),
    truncation: {
      blocksOmitted: Math.max(0, snapshot.blocks.length - blocks.length),
      gatesOmitted: Math.max(0, selectedGates.length - gates.length),
      operationsOmitted: Math.max(0, orderedOperations.length - operations.length),
      stringsTruncated: strings.truncated,
      workflowRunsOmitted: Math.max(0, orderedWorkflowRuns.length - workflowRuns.length),
    },
    workflowRuns,
  };
  return {
    ...base,
    source: {
      ...base.source,
      fingerprint: `sha256:${sha256Hex(stableStringify(base))}`,
    },
  };
}

function blockSummary(
  block: BlockRecord,
  assetById: Map<string, BoardSnapshot['assets'][number]>,
  strings: { truncated: boolean },
): AgentBoardBlockSummaryV1 {
  const assetId = stringValue(block.data.assetId);
  const asset = assetId ? assetById.get(assetId) : undefined;
  const artifactId = stringValue(block.data.artifactId);
  const artifactRevisionId = stringValue(block.data.artifactRevisionId);
  const artifactType = stringValue(block.data.artifactType);
  const textSource = block.type === 'text'
    ? stringValue(block.data.body)
    : block.type === 'document'
      ? stringValue(block.data.documentExcerpt)
      : undefined;
  const text = textSource ? truncatedText(
    textSource,
    agentBoardReadModelBudget.maxTextPreviewCharacters,
    strings,
  ) : undefined;
  return {
    ...(artifactId || artifactRevisionId || artifactType ? {
      artifact: {
        ...(artifactId ? { artifactId } : {}),
        ...(artifactRevisionId ? { artifactRevisionId } : {}),
        ...(artifactType ? { artifactType } : {}),
      },
    } : {}),
    blockId: block.blockId,
    ...(asset ? {
      media: {
        assetId: asset.assetId,
        ...(asset.duration !== undefined ? { duration: asset.duration } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
        kind: asset.kind,
        mimeType: asset.mimeType,
        ...(asset.sourceExecutionId ? { sourceExecutionId: asset.sourceExecutionId } : {}),
        ...(asset.width !== undefined ? { width: asset.width } : {}),
      },
    } : {}),
    ...(block.parentGroupId ? { parentGroupId: block.parentGroupId } : {}),
    ...(block.data.reviewStatus === 'selected' ? { reviewStatus: 'selected' as const } : {}),
    ...(text ? {
      text: {
        kind: block.type === 'text' ? 'text_body' as const : 'document_excerpt' as const,
        ...text,
      },
    } : {}),
    title: blockTitle(block, strings),
    type: block.type,
    updatedAt: block.updatedAt,
  };
}

function operationSummary(
  snapshot: BoardSnapshot,
  block: BlockRecord,
  blockById: Map<string, BlockRecord>,
  readiness: OperationReadiness,
  latestExecution: BoardSnapshot['executions'][number] | undefined,
  step: WorkflowStepRunRecord | undefined,
  strings: { truncated: boolean },
): AgentBoardOperationSummaryV1 {
  const inputBindings = snapshot.edges
    .filter((edge) => edge.kind === 'execution_input' && edge.targetBlockId === block.blockId)
    .flatMap((edge) => {
      const source = blockById.get(edge.sourceBlockId);
      return source ? [{
        ...(edge.inputSlotId ? { inputSlotId: edge.inputSlotId } : {}),
        ...(edge.referenceIntent
          ? {
              referenceIntent: {
                instruction: edge.referenceIntent.instruction,
                label: edge.referenceIntent.label,
              },
            }
          : {}),
        sourceBlockId: source.blockId,
        sourceBlockType: source.type,
      }] : [];
    })
    .sort((left, right) =>
      (left.inputSlotId ?? '').localeCompare(right.inputSlotId ?? '')
        || left.sourceBlockId.localeCompare(right.sourceBlockId));
  const outputBlockIds = snapshot.edges
    .filter((edge) => edge.kind === 'execution_output' && edge.sourceBlockId === block.blockId)
    .map((edge) => edge.targetBlockId)
    .sort((left, right) => left.localeCompare(right));
  const packageId = stringValue(block.data.packageId);
  const status = executionStatus(block.data.status) ?? latestExecution?.status;
  return {
    ...(stringValue(block.data.capabilityId) ? { capabilityId: stringValue(block.data.capabilityId) } : {}),
    inputBindings: inputBindings.slice(0, agentBoardReadModelBudget.maxInputBindingsPerOperation),
    inputBindingsOmitted: Math.max(0, inputBindings.length - agentBoardReadModelBudget.maxInputBindingsPerOperation),
    ...(latestExecution ? {
      latestExecution: {
        ...(latestExecution.completedAt ? { completedAt: latestExecution.completedAt } : {}),
        executionId: latestExecution.executionId,
        hasError: Boolean(latestExecution.errorMessage),
        ...(latestExecution.model ? { model: latestExecution.model } : {}),
        ...(latestExecution.provider ? { provider: latestExecution.provider } : {}),
        ...(latestExecution.resultSummary ? { resultSummary: copyResultSummary(latestExecution.resultSummary) } : {}),
        startedAt: latestExecution.startedAt,
        status: latestExecution.status,
      },
    } : {}),
    operationBlockId: block.blockId,
    outputBlockIds: outputBlockIds.slice(0, agentBoardReadModelBudget.maxOutputBlockIdsPerOperation),
    outputBlockIdsOmitted: Math.max(0, outputBlockIds.length - agentBoardReadModelBudget.maxOutputBlockIdsPerOperation),
    ...(packageId ? {
      package: {
        ...(stringValue(block.data.packageDigest) ? { digest: stringValue(block.data.packageDigest) } : {}),
        ...(stringValue(block.data.packageEntryPointId) ? { entrypointId: stringValue(block.data.packageEntryPointId) } : {}),
        packageId,
        ...(stringValue(block.data.packageVersion) ? { version: stringValue(block.data.packageVersion) } : {}),
      },
    } : {}),
    readiness: { canRun: readiness.canRun, issues: [...readiness.issues] },
    ...(stringValue(block.data.skillId) ? { skillId: stringValue(block.data.skillId) } : {}),
    ...(status ? { status } : {}),
    title: blockTitle(block, strings),
    ...(step ? {
      workflowStep: {
        acceptedOutputAssetIds: [...step.acceptedOutputAssetIds],
        freshness: step.freshness,
        ...(step.stageId ? { stageId: step.stageId } : {}),
        status: step.status,
        stepId: step.stepId,
        stepRunId: step.stepRunId,
        workflowRunId: step.workflowRunId,
      },
    } : {}),
  };
}

function boardSummary(
  snapshot: BoardSnapshot,
  readinessByOperationId: Map<string, OperationReadiness>,
  latestExecutionByOperationId: Map<string, BoardSnapshot['executions'][number] | undefined>,
  selectedGates: BoardSnapshot['workflowGateEvaluations'],
  strings: { truncated: boolean },
): AgentBoardSummaryV1 {
  const operationBlocks = snapshot.blocks.filter((block) => block.type === 'operation');
  const operationStatuses = operationBlocks.map((block) =>
    executionStatus(block.data.status) ?? latestExecutionByOperationId.get(block.blockId)?.status);
  return {
    assetCount: snapshot.assets.length,
    blockCounts: countValues<BlockType>(
      ['text', 'document', 'image', 'video', 'operation', 'group'],
      snapshot.blocks.map((block) => block.type),
    ),
    boardName: truncatedValue(snapshot.board.name, agentBoardReadModelBudget.maxTitleCharacters, strings),
    currentGateCounts: {
      failed: selectedGates?.filter((gate) => gate.freshness === 'current' && gate.status === 'failed').length ?? 0,
      passed: selectedGates?.filter((gate) => gate.freshness === 'current' && gate.status === 'passed').length ?? 0,
      waitingApproval: selectedGates?.filter(
        (gate) => gate.freshness === 'current' && gate.status === 'waiting_approval',
      ).length ?? 0,
    },
    edgeCount: snapshot.edges.length,
    executionCounts: countValues<ExecutionStatus>(
      ['queued', 'running', 'succeeded', 'failed', 'canceled'],
      snapshot.executions.map((execution) => execution.status),
    ),
    operationCounts: {
      active: operationStatuses.filter((status) => status === 'queued' || status === 'running').length,
      blocked: operationBlocks.filter((block) => !readinessByOperationId.get(block.blockId)?.canRun).length,
      failed: operationStatuses.filter((status) => status === 'failed').length,
      ready: operationBlocks.filter((block) => readinessByOperationId.get(block.blockId)?.canRun).length,
      total: operationBlocks.length,
    },
    projectName: truncatedValue(snapshot.project.name, agentBoardReadModelBudget.maxTitleCharacters, strings),
    workflowRunCounts: countValues<WorkflowRunStatus>(
      [
        'draft', 'ready', 'running', 'waiting_input', 'waiting_selection', 'waiting_approval',
        'paused', 'needs_attention', 'succeeded', 'failed', 'canceled',
      ],
      (snapshot.workflowRuns ?? []).map((run) => run.status),
    ),
  };
}

function workflowRunSummary(
  snapshot: BoardSnapshot,
  workflowRunId: string,
): AgentBoardWorkflowRunSummaryV1 {
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === workflowRunId);
  if (!run) throw new Error(`Workflow Run is missing: ${workflowRunId}`);
  const steps = (snapshot.workflowStepRuns ?? []).filter((step) => step.workflowRunId === workflowRunId);
  return {
    currentStepIds: [...run.currentStepIds],
    outdatedStepCount: steps.filter((step) => step.freshness === 'outdated').length,
    ...(run.sourcePackageLock ? { package: { ...run.sourcePackageLock } } : {}),
    status: run.status,
    stepCounts: countValues<WorkflowStepRunStatus>(
      [
        'pending', 'ready', 'queued', 'running', 'waiting_input', 'waiting_selection',
        'succeeded', 'failed', 'skipped', 'canceled', 'blocked',
      ],
      steps.map((step) => step.status),
    ),
    workflowDefinitionId: run.workflowDefinitionLock.workflowId,
    workflowRunId,
    workflowVersion: run.workflowDefinitionLock.version,
  };
}

function gateSummary(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  gateId: string,
  strings: { truncated: boolean },
): AgentBoardGateSummaryV1 {
  const evaluation = selectedGateEvaluations(snapshot).find(
    (candidate) => candidate.workflowRunId === workflowRunId && candidate.gateId === gateId,
  );
  if (!evaluation) throw new Error(`Workflow Gate is missing: ${workflowRunId}/${gateId}`);
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === workflowRunId);
  const lock = run?.gateDefinitionLocks.find((candidate) => candidate.gateId === gateId);
  const subjectOperationBlockId = gateSubjectOperationBlockId(snapshot, workflowRunId, gateId);
  return {
    approvalRequestId: evaluation.approvalRequestId,
    freshness: evaluation.freshness,
    gateEvaluationId: evaluation.gateEvaluationId,
    gateId,
    name: truncatedValue(lock?.name ?? gateId, agentBoardReadModelBudget.maxTitleCharacters, strings),
    status: evaluation.status,
    ...(evaluation.subjectArtifactRevisionId
      ? { subjectArtifactRevisionId: evaluation.subjectArtifactRevisionId }
      : {}),
    ...(subjectOperationBlockId ? { subjectOperationBlockId } : {}),
    workflowRunId,
  };
}

function selectedGateEvaluations(snapshot: BoardSnapshot) {
  const byIdentity = new Map<string, NonNullable<BoardSnapshot['workflowGateEvaluations']>[number]>();
  for (const evaluation of snapshot.workflowGateEvaluations ?? []) {
    const key = `${evaluation.workflowRunId}:${evaluation.gateId}`;
    const current = byIdentity.get(key);
    if (!current || compareGateRecency(evaluation, current) < 0) byIdentity.set(key, evaluation);
  }
  return [...byIdentity.values()];
}

function compareGateRecency(
  left: NonNullable<BoardSnapshot['workflowGateEvaluations']>[number],
  right: NonNullable<BoardSnapshot['workflowGateEvaluations']>[number],
): number {
  return Number(right.freshness === 'current') - Number(left.freshness === 'current')
    || right.updatedAt.localeCompare(left.updatedAt)
    || right.gateEvaluationId.localeCompare(left.gateEvaluationId);
}

function gateSubjectOperationBlockId(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  gateId: string,
): string | undefined {
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === workflowRunId);
  const stepId = run?.gateDefinitionLocks.find((gate) => gate.gateId === gateId)?.subject.stepId;
  return stepId
    ? (snapshot.workflowStepRuns ?? []).find(
      (step) => step.workflowRunId === workflowRunId && step.stepId === stepId,
    )?.operationBlockId
    : undefined;
}

function latestExecutionForOperation(snapshot: BoardSnapshot, block: BlockRecord) {
  const explicitId = stringValue(block.data.sourceExecutionId);
  const explicit = explicitId
    ? snapshot.executions.find(
      (execution) =>
        execution.executionId === explicitId
        && execution.params?.operationBlockId === block.blockId,
    )
    : undefined;
  if (explicit) return explicit;
  return snapshot.executions
    .filter((execution) => execution.params?.operationBlockId === block.blockId)
    .sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt)
        || right.executionId.localeCompare(left.executionId))[0];
}

function blockPriority(
  block: BlockRecord,
  focusIds: Set<string>,
  runOperationIds: Set<string>,
  gateOperationIds: Set<string>,
  readiness: OperationReadiness | undefined,
  executionStatusValue: ExecutionStatus | undefined,
  step: WorkflowStepRunRecord | undefined,
): number {
  if (focusIds.has(block.blockId)) return 0;
  if (runOperationIds.has(block.blockId)) return 1;
  if (block.type === 'operation' && (
    gateOperationIds.has(block.blockId)
    || readiness?.canRun === false
    || executionStatusValue === 'queued'
    || executionStatusValue === 'running'
    || executionStatusValue === 'failed'
    || step?.status === 'waiting_selection'
    || step?.status === 'waiting_input'
  )) return 2;
  return block.type === 'operation' ? 3 : 4;
}

function workflowRunPriority(status: WorkflowRunStatus): number {
  if (status === 'running' || status === 'waiting_input' || status === 'waiting_selection' || status === 'waiting_approval') {
    return 0;
  }
  if (status === 'needs_attention' || status === 'failed') return 1;
  if (status === 'ready' || status === 'paused') return 2;
  return 3;
}

function workflowStepByOperationId(
  snapshot: BoardSnapshot,
  activeWorkflowRunId: string | undefined,
): Map<string, WorkflowStepRunRecord> {
  const ordered = [...(snapshot.workflowStepRuns ?? [])].sort((left, right) =>
    Number(right.workflowRunId === activeWorkflowRunId)
      - Number(left.workflowRunId === activeWorkflowRunId)
      || workflowStepPriority(left.status) - workflowStepPriority(right.status)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.stepRunId.localeCompare(right.stepRunId));
  const result = new Map<string, WorkflowStepRunRecord>();
  for (const step of ordered) {
    if (!result.has(step.operationBlockId)) result.set(step.operationBlockId, step);
  }
  return result;
}

function workflowStepPriority(status: WorkflowStepRunStatus): number {
  if (status === 'running' || status === 'queued' || status === 'waiting_input' || status === 'waiting_selection') {
    return 0;
  }
  if (status === 'failed' || status === 'blocked') return 1;
  if (status === 'ready' || status === 'pending') return 2;
  return 3;
}

function gatePriority(status: WorkflowGateEvaluationStatus): number {
  if (status === 'waiting_approval') return 0;
  if (status === 'failed') return 1;
  return 2;
}

function workflowRunIdFor(run: AgentRunRecord | undefined): string | undefined {
  return run && run.target.kind !== 'capability' ? run.target.workflowRunId : undefined;
}

function blockTitle(block: BlockRecord, strings: { truncated: boolean }): string {
  return truncatedValue(
    stringValue(block.data.title)?.trim() || block.type,
    agentBoardReadModelBudget.maxTitleCharacters,
    strings,
  );
}

function truncatedText(
  value: string,
  limit: number,
  strings: { truncated: boolean },
): { preview: string; truncated: boolean } {
  const characters = [...value.trim()];
  const truncated = characters.length > limit;
  if (truncated) strings.truncated = true;
  return { preview: characters.slice(0, limit).join(''), truncated };
}

function truncatedValue(value: string, limit: number, strings: { truncated: boolean }): string {
  return truncatedText(value, limit, strings).preview;
}

function countValues<Value extends string>(
  values: readonly Value[],
  input: readonly Value[],
): Record<Value, number> {
  const result = Object.fromEntries(values.map((value) => [value, 0])) as Record<Value, number>;
  for (const value of input) result[value] += 1;
  return result;
}

function executionStatus(value: unknown): ExecutionStatus | undefined {
  return value === 'queued'
    || value === 'running'
    || value === 'succeeded'
    || value === 'failed'
    || value === 'canceled'
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function copyResultSummary(summary: ExecutionResultSummary): ExecutionResultSummary {
  return {
    failed: summary.failed,
    requested: summary.requested,
    succeeded: summary.succeeded,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
