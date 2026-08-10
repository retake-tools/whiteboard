import { sha256Hex } from './sha256';
import type { BoardSnapshot } from './types';
import type { WorkflowStepRunRecord } from './workflowRuntimeContracts';
import type { WorkflowDefinition } from './workflowRegistry';
import type { WorkflowDefinitionIdentityV1 } from './workflowAuthoringContracts';

export interface WorkflowSelectionCaptureProposalV1 {
  blockIds: string[];
  boardId: string;
  definition?: WorkflowDefinition;
  fingerprint: string;
  issues: string[];
  projectId: string;
  schemaVersion: 1;
  sourceWorkflowRunId?: string;
  valid: boolean;
  workflowLock?: WorkflowDefinitionIdentityV1;
}

export function proposeWorkflowSelectionCapture(input: {
  blockIds: string[];
  snapshot: BoardSnapshot;
  sourceDefinition?: WorkflowDefinition;
}): WorkflowSelectionCaptureProposalV1 {
  const blockIds = [...new Set(input.blockIds)].sort();
  const issues: string[] = [];
  const selectedBlocks = blockIds.map((blockId) => {
    const block = input.snapshot.blocks.find((candidate) => candidate.blockId === blockId);
    if (!block) issues.push(`Selected Block does not exist: ${blockId}.`);
    return block;
  }).filter((block) => block !== undefined);
  const operations = selectedBlocks.filter((block) => block.type === 'operation');
  for (const block of selectedBlocks) {
    if (block.type !== 'operation') issues.push(`Selected Block is not an Operation: ${block.blockId}.`);
  }
  if (operations.length === 0) issues.push('Select at least one Workflow Operation.');

  const stepRuns = operations.map((operation) => {
    const matches = (input.snapshot.workflowStepRuns ?? []).filter(
      (candidate) => candidate.operationBlockId === operation.blockId,
    );
    if (matches.length !== 1) {
      issues.push(`Operation must resolve to exactly one Workflow StepRun: ${operation.blockId}.`);
    }
    return matches[0];
  }).filter((step): step is WorkflowStepRunRecord => step !== undefined);
  const runIds = [...new Set(stepRuns.map((step) => step.workflowRunId))];
  if (runIds.length > 1) issues.push('Selected Operations must belong to the same Workflow Run.');
  const sourceWorkflowRunId = runIds.length === 1 ? runIds[0] : undefined;
  const run = sourceWorkflowRunId
    ? (input.snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === sourceWorkflowRunId)
    : undefined;
  if (sourceWorkflowRunId && !run) issues.push(`Workflow Run does not exist: ${sourceWorkflowRunId}.`);
  const sourceDefinition = input.sourceDefinition;
  if (run && !sourceDefinition) issues.push('Exact source Workflow Definition is unavailable.');
  if (run && sourceDefinition && !sameWorkflowLock(run.workflowDefinitionLock, sourceDefinition)) {
    issues.push('Source Workflow Definition does not match the Workflow Run exact lock.');
  }

  if (run && sourceDefinition) {
    const selectedStepIds = new Set(stepRuns.map((step) => step.stepId));
    const sourceStepIds = new Set(sourceDefinition.steps.map((step) => step.stepId));
    for (const step of sourceDefinition.steps) {
      if (!selectedStepIds.has(step.stepId)) {
        issues.push(`Selection is not dependency-complete; missing Step: ${step.stepId}.`);
      }
    }
    for (const stepRun of stepRuns) {
      const sourceStep = sourceDefinition.steps.find((step) => step.stepId === stepRun.stepId);
      if (!sourceStep) {
        issues.push(`StepRun is absent from the source Definition: ${stepRun.stepId}.`);
        continue;
      }
      if (
        sourceStep.capabilityLock.capabilityId !== stepRun.capabilityLock.capabilityId
        || sourceStep.capabilityLock.version !== stepRun.capabilityLock.version
        || sourceStep.capabilityLock.definitionHash !== stepRun.capabilityLock.definitionHash
      ) issues.push(`Capability lock changed for Step: ${stepRun.stepId}.`);
      if (
        sourceStep.skillLock.skillId !== stepRun.skillLock.skillId
        || sourceStep.skillLock.version !== stepRun.skillLock.version
        || sourceStep.skillLock.definitionHash !== stepRun.skillLock.definitionHash
      ) issues.push(`Skill lock changed for Step: ${stepRun.stepId}.`);
      if (!sourceStepIds.has(stepRun.stepId)) continue;
      validateTypedInputEdges(input.snapshot, sourceDefinition, stepRun, issues);
    }
  }

  const workflowLock = run ? {
    definitionHash: run.workflowDefinitionLock.definitionHash,
    version: run.workflowDefinitionLock.version,
    workflowId: run.workflowDefinitionLock.workflowId,
  } : undefined;
  const fingerprint = `sha256:${sha256Hex(stableStringify({
    blockIds,
    boardId: input.snapshot.board.boardId,
    definitionHash: sourceDefinition?.definitionHash,
    projectId: input.snapshot.project.projectId,
    sourceWorkflowRunId,
    stepRuns: stepRuns.map((step) => ({
      capabilityLock: step.capabilityLock,
      operationBlockId: step.operationBlockId,
      skillLock: step.skillLock,
      stepId: step.stepId,
    })).sort((left, right) => left.stepId.localeCompare(right.stepId)),
    typedEdges: input.snapshot.edges.filter((edge) => (
      edge.kind === 'execution_input'
      && operations.some((operation) => operation.blockId === edge.targetBlockId)
    )).map((edge) => ({
      inputSlotId: edge.inputSlotId,
      sourceBlockId: edge.sourceBlockId,
      targetBlockId: edge.targetBlockId,
    })).sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
    workflowLock,
  }))}`;
  return {
    blockIds,
    boardId: input.snapshot.board.boardId,
    ...(sourceDefinition ? { definition: structuredClone(sourceDefinition) } : {}),
    fingerprint,
    issues: [...new Set(issues)],
    projectId: input.snapshot.project.projectId,
    schemaVersion: 1,
    ...(sourceWorkflowRunId ? { sourceWorkflowRunId } : {}),
    valid: issues.length === 0,
    ...(workflowLock ? { workflowLock } : {}),
  };
}

function validateTypedInputEdges(
  snapshot: BoardSnapshot,
  definition: WorkflowDefinition,
  stepRun: WorkflowStepRunRecord,
  issues: string[],
): void {
  const stepId = stepRun.stepId;
  const step = definition.steps.find((candidate) => candidate.stepId === stepId);
  if (!step) return;
  const incoming = snapshot.edges.filter((edge) => (
    edge.kind === 'execution_input' && edge.targetBlockId === stepRun.operationBlockId
  ));
  for (const edge of incoming) {
    if (!edge.inputSlotId) {
      issues.push(`Execution input Edge is untyped: ${edge.edgeId}.`);
      continue;
    }
    const binding = step.inputBindings.find(
      (candidate) => candidate.inputSlotId === edge.inputSlotId,
    );
    if (!binding) {
      issues.push(`Execution input Edge targets an unknown Slot: ${edge.edgeId}.`);
      continue;
    }
    const resolved = stepRun.resolvedInputBindings.find(
      (candidate) => candidate.inputSlotId === binding.inputSlotId,
    );
    const expectedBlockIds = new Set((resolved?.values ?? []).flatMap(
      (value) => value.kind === 'block' ? [value.blockId] : [],
    ));
    if (!expectedBlockIds.has(edge.sourceBlockId) || !edgeMatchesBinding(snapshot, edge.sourceBlockId, binding.source)) {
      issues.push(`Execution input Edge is incompatible with the frozen binding: ${edge.edgeId}.`);
    }
  }
  for (const binding of step.inputBindings) {
    const resolved = stepRun.resolvedInputBindings.find(
      (candidate) => candidate.inputSlotId === binding.inputSlotId,
    );
    const expectedBlockIds = new Set((resolved?.values ?? []).flatMap(
      (value) => value.kind === 'block' ? [value.blockId] : [],
    ));
    if (expectedBlockIds.size === 0) continue;
    const matches = incoming.filter((edge) => {
      if (edge.inputSlotId !== binding.inputSlotId) return false;
      if (!expectedBlockIds.has(edge.sourceBlockId)) return false;
      return edgeMatchesBinding(snapshot, edge.sourceBlockId, binding.source);
    });
    if (matches.length !== expectedBlockIds.size) {
      issues.push(`Typed input Edge count does not match the frozen binding: ${stepId}.${binding.inputSlotId}.`);
    }
  }
}

function edgeMatchesBinding(
  snapshot: BoardSnapshot,
  sourceBlockId: string,
  source: WorkflowDefinition['steps'][number]['inputBindings'][number]['source'],
): boolean {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === sourceBlockId);
  if (!block) return false;
  return source.kind === 'workflow_input'
    ? block.data.workflowInputSlotId === source.slotId
    : block.data.workflowStepId === source.stepId
      && block.data.workflowOutputSlotId === source.outputSlotId;
}

function sameWorkflowLock(
  lock: { definitionHash: string; version: string; workflowId: string },
  definition: WorkflowDefinition,
): boolean {
  return lock.workflowId === definition.workflowId
    && lock.version === definition.version
    && lock.definitionHash === definition.definitionHash;
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
  return JSON.stringify(value);
}
