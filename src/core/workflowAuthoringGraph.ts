import {
  capabilityDefinitionFor,
  tryCapabilityDefinitionFor,
} from './capabilityRegistry';
import { skillsForCapability, type RetakeSkillDefinition } from './skillRegistry';
import type {
  WorkflowBindingSource,
  WorkflowCapabilityStepDefinition,
  WorkflowDefinition,
} from './workflowRegistry';
import type { WorkflowProjectionTemplateV1 } from './workflowAuthoringContracts';
import type { CapabilityDefinition } from './capabilityContracts';
import { listSkills } from './skillRegistry';

export interface WorkflowAuthoringGraphNodeV1 {
  boundInputCount: number;
  capabilityId: string;
  capabilityLabel: string;
  dependsOn: string[];
  inputSlotCount: number;
  issueCount: number;
  optional: boolean;
  outputTypes: string[];
  position: { x: number; y: number };
  skillId: string;
  skillLabel: string;
  stageId: string;
  stepId: string;
}

export interface WorkflowAuthoringGraphEdgeV1 {
  edgeId: string;
  sourceStepId: string;
  targetStepId: string;
}

export interface WorkflowAuthoringBindingCandidateV1 {
  label: string;
  source: WorkflowBindingSource;
  value: string;
}

export interface WorkflowAuthoringChecklistItemV1 {
  issue: string;
  scope: 'step' | 'workflow';
  stepId?: string;
}

export type WorkflowAuthoringStepInsertionContextV1 =
  | { kind: 'first' }
  | { kind: 'after_step'; sourceStepId: string }
  | { kind: 'insert_edge'; sourceStepId: string; targetStepId: string };

export function workflowAuthoringGraphFor(input: {
  definition: WorkflowDefinition;
  projectionTemplate: WorkflowProjectionTemplateV1;
  validationIssues?: string[];
}): {
  edges: WorkflowAuthoringGraphEdgeV1[];
  nodes: WorkflowAuthoringGraphNodeV1[];
} {
  const positionByStepId = new Map(
    input.projectionTemplate.positions.map((position) => [position.stepId, position]),
  );
  const skillById = new Map(listSkills().map((skill) => [skill.skillId, skill]));
  return {
    edges: input.definition.steps.flatMap((step) => step.dependsOn.map((dependencyId) => ({
      edgeId: `${dependencyId}->${step.stepId}`,
      sourceStepId: dependencyId,
      targetStepId: step.stepId,
    }))),
    nodes: input.definition.steps.map((step, index) => {
      const capability = tryCapabilityDefinitionFor(step.capabilityLock.capabilityId);
      const skill = skillById.get(step.skillLock.skillId);
      return {
        boundInputCount: new Set(step.inputBindings.map((binding) => binding.inputSlotId)).size,
        capabilityId: step.capabilityLock.capabilityId,
        capabilityLabel: capability?.displayName ?? step.capabilityLock.capabilityId,
        dependsOn: [...step.dependsOn],
        inputSlotCount: capability?.inputSlots.length ?? step.inputBindings.length,
        issueCount: workflowAuthoringIssuesForStep(
          input.validationIssues ?? [],
          step.stepId,
        ).length,
        optional: step.optional,
        outputTypes: step.outputSlots.map((outputSlotId) => {
          const output = capability?.outputSlots.find((slot) => slot.slotId === outputSlotId);
          return output?.artifactType ?? output?.dataType ?? outputSlotId;
        }),
        position: positionByStepId.get(step.stepId)
          ? { x: positionByStepId.get(step.stepId)!.x, y: positionByStepId.get(step.stepId)!.y }
          : { x: index * 340, y: 0 },
        skillId: step.skillLock.skillId,
        skillLabel: skill?.name ?? step.skillLock.skillId,
        stageId: step.stageId,
        stepId: step.stepId,
      };
    }),
  };
}

export function workflowAuthoringIssuesForStep(
  issues: string[],
  stepId: string,
): string[] {
  return issues.filter((issue) => workflowIssueStepId(issue, [stepId]) === stepId);
}

export function workflowAuthoringChecklistFor(
  definition: WorkflowDefinition,
  issues: string[],
): WorkflowAuthoringChecklistItemV1[] {
  const stepIds = definition.steps.map((step) => step.stepId);
  return issues.map((issue) => {
    const stepId = workflowIssueStepId(issue, stepIds);
    return stepId
      ? { issue, scope: 'step', stepId }
      : { issue, scope: 'workflow' };
  });
}

export function addWorkflowAuthoringProjectionPosition(input: {
  context: WorkflowAuthoringStepInsertionContextV1;
  projectionTemplate: WorkflowProjectionTemplateV1;
  stepId: string;
}): WorkflowProjectionTemplateV1 {
  const { context } = input;
  const positions = input.projectionTemplate.positions.map((position) => ({ ...position }));
  if (positions.some((position) => position.stepId === input.stepId)) {
    throw new Error(`Workflow projection position already exists: ${input.stepId}`);
  }
  if (context.kind === 'first') {
    return {
      ...input.projectionTemplate,
      positions: [...positions, { stepId: input.stepId, x: 0, y: 0 }],
    };
  }

  const sourceStepId = context.sourceStepId;
  const source = positions.find((position) => position.stepId === sourceStepId);
  if (!source) {
    throw new Error(`Workflow source Step position not found: ${sourceStepId}`);
  }
  if (context.kind === 'insert_edge') {
    const targetStepId = context.targetStepId;
    const target = positions.find((position) => position.stepId === targetStepId);
    if (!target) {
      throw new Error(`Workflow target Step position not found: ${targetStepId}`);
    }
    const insertionX = Math.max(source.x + 340, target.x);
    return {
      ...input.projectionTemplate,
      positions: [
        ...positions.map((position) => (
          position.x >= insertionX ? { ...position, x: position.x + 340 } : position
        )),
        { stepId: input.stepId, x: insertionX, y: target.y },
      ],
    };
  }

  const x = source.x + 340;
  let y = source.y;
  while (positions.some((position) => position.x === x && position.y === y)) y += 180;
  return {
    ...input.projectionTemplate,
    positions: [...positions, { stepId: input.stepId, x, y }],
  };
}

export function compatibleSkillsForWorkflowStep(
  step: WorkflowCapabilityStepDefinition,
): RetakeSkillDefinition[] {
  const boundInputIds = new Set(step.inputBindings.map((binding) => binding.inputSlotId));
  return skillsForCapability(step.capabilityLock.capabilityId).filter((skill) => (
    skill.capabilityBindings.some((binding) => (
      binding.capabilityId === step.capabilityLock.capabilityId
      && [...boundInputIds].every((slotId) => binding.inputSlots.includes(slotId))
      && step.outputSlots.every((slotId) => binding.outputSlots.includes(slotId))
    ))
  ));
}

export function workflowBindingCandidates(input: {
  definition: WorkflowDefinition;
  inputSlotId: string;
  stepId: string;
}): WorkflowAuthoringBindingCandidateV1[] {
  const stepById = new Map(input.definition.steps.map((step) => [step.stepId, step]));
  const step = stepById.get(input.stepId);
  if (!step) return [];
  const capability = tryCapabilityDefinitionFor(step.capabilityLock.capabilityId);
  const targetSlot = capability?.inputSlots.find((slot) => slot.slotId === input.inputSlotId);
  if (!targetSlot) return [];
  const candidates: WorkflowAuthoringBindingCandidateV1[] = [];
  for (const slot of input.definition.inputSlots) {
    if (!dataTypesOverlap(slot.dataTypes, targetSlot.dataTypes)) continue;
    if (!artifactTypesCompatible(slot.artifactTypes, targetSlot.artifactTypes)) continue;
    candidates.push({
      label: `Input · ${slot.slotId}`,
      source: { kind: 'workflow_input', slotId: slot.slotId },
      value: `workflow:${slot.slotId}`,
    });
  }
  const dependencyIds = workflowDependencyClosure(step, stepById);
  for (const dependencyId of dependencyIds) {
    const dependency = stepById.get(dependencyId);
    if (!dependency) continue;
    const sourceCapability = tryCapabilityDefinitionFor(
      dependency.capabilityLock.capabilityId,
    );
    if (!sourceCapability) continue;
    for (const outputSlotId of dependency.outputSlots) {
      const sourceSlot = sourceCapability.outputSlots.find(
        (slot) => slot.slotId === outputSlotId,
      );
      if (
        !sourceSlot
        || !targetSlot.dataTypes.includes(sourceSlot.dataType)
        || !artifactTypesCompatible(
          sourceSlot.artifactType ? [sourceSlot.artifactType] : [],
          targetSlot.artifactTypes,
        )
      ) continue;
      candidates.push({
        label: `${dependency.stepId} · ${outputSlotId}`,
        source: { kind: 'step_output', outputSlotId, stepId: dependency.stepId },
        value: `step:${dependency.stepId}:${outputSlotId}`,
      });
    }
  }
  return candidates;
}

export function workflowBindingSourceValue(source: WorkflowBindingSource): string {
  return source.kind === 'workflow_input'
    ? `workflow:${source.slotId}`
    : `step:${source.stepId}:${source.outputSlotId}`;
}

export function workflowStepInputSlotIds(
  step: WorkflowCapabilityStepDefinition,
): string[] {
  return capabilityDefinitionFor(step.capabilityLock.capabilityId).inputSlots.map(
    (slot) => slot.slotId,
  );
}

export function addWorkflowAuthoringStep(input: {
  capability: CapabilityDefinition;
  definition: WorkflowDefinition;
  skill: RetakeSkillDefinition;
  stageId: string;
  stepId: string;
}): WorkflowDefinition {
  if (input.definition.steps.some((step) => step.stepId === input.stepId)) {
    throw new Error(`Workflow Step already exists: ${input.stepId}`);
  }
  const binding = input.skill.capabilityBindings.find(
    (candidate) => candidate.capabilityId === input.capability.capabilityId,
  );
  if (!binding) throw new Error(`Skill is incompatible with Capability: ${input.skill.skillId}`);
  return {
    ...input.definition,
    steps: [...input.definition.steps, {
      capabilityLock: {
        capabilityId: input.capability.capabilityId,
        definitionHash: input.capability.definitionHash,
        version: input.capability.version,
      },
      dependsOn: [],
      inputBindings: [],
      optional: false,
      outputSlots: [...binding.outputSlots],
      runPolicy: 'manual',
      skillLock: {
        definitionHash: input.skill.definitionHash,
        skillId: input.skill.skillId,
        version: input.skill.version,
      },
      stageId: input.stageId,
      stepId: input.stepId,
      type: 'capability',
    }],
  };
}

export function addWorkflowAuthoringStepAtContext(input: {
  capability: CapabilityDefinition;
  context: WorkflowAuthoringStepInsertionContextV1;
  definition: WorkflowDefinition;
  skill: RetakeSkillDefinition;
  stageId: string;
  stepId: string;
}): WorkflowDefinition {
  const { context } = input;
  if (context.kind === 'first' && input.definition.steps.length > 0) {
    throw new Error('The first Step entry is only available for an empty Workflow Draft.');
  }
  if (context.kind !== 'first' && !input.definition.steps.some(
    (step) => step.stepId === context.sourceStepId,
  )) {
    throw new Error(`Workflow source Step not found: ${context.sourceStepId}`);
  }
  if (context.kind === 'insert_edge') {
    const target = input.definition.steps.find((step) => step.stepId === context.targetStepId);
    if (!target) throw new Error(`Workflow target Step not found: ${context.targetStepId}`);
    if (!target.dependsOn.includes(context.sourceStepId)) {
      throw new Error(
        `Workflow dependency Edge not found: ${context.sourceStepId}->${context.targetStepId}`,
      );
    }
  }

  const withStep = addWorkflowAuthoringStep(input);
  if (context.kind === 'first') return withStep;
  return {
    ...withStep,
    steps: withStep.steps.map((step) => {
      if (step.stepId === input.stepId) {
        return { ...step, dependsOn: [context.sourceStepId] };
      }
      if (context.kind === 'insert_edge' && step.stepId === context.targetStepId) {
        return {
          ...step,
          dependsOn: step.dependsOn.map((dependencyId) => (
            dependencyId === context.sourceStepId ? input.stepId : dependencyId
          )),
        };
      }
      return step;
    }),
  };
}

export function workflowStepRemovalIssues(
  definition: WorkflowDefinition,
  stepId: string,
): string[] {
  const issues: string[] = [];
  for (const step of definition.steps) {
    if (step.dependsOn.includes(stepId)) {
      issues.push(`${step.stepId} depends on ${stepId}.`);
    }
    for (const binding of step.inputBindings) {
      if (binding.source.kind === 'step_output' && binding.source.stepId === stepId) {
        issues.push(`${step.stepId}.${binding.inputSlotId} reads ${stepId}.${binding.source.outputSlotId}.`);
      }
    }
  }
  for (const output of definition.outputSlots) {
    if (output.source.stepId === stepId) {
      issues.push(`Workflow output ${output.slotId} reads ${stepId}.${output.source.outputSlotId}.`);
    }
  }
  for (const gate of definition.gates) {
    if (gate.subject.kind === 'step_output' && gate.subject.stepId === stepId) {
      issues.push(`Gate ${gate.gateId} reviews ${stepId}.${gate.subject.outputSlotId}.`);
    }
  }
  return [...new Set(issues)];
}

export function removeWorkflowAuthoringStep(
  definition: WorkflowDefinition,
  stepId: string,
): WorkflowDefinition {
  const issues = workflowStepRemovalIssues(definition, stepId);
  if (issues.length > 0) throw new Error(issues.join('\n'));
  if (!definition.steps.some((step) => step.stepId === stepId)) {
    throw new Error(`Workflow Step not found: ${stepId}`);
  }
  return {
    ...definition,
    steps: definition.steps.filter((step) => step.stepId !== stepId),
  };
}

function workflowDependencyClosure(
  step: WorkflowCapabilityStepDefinition,
  stepById: Map<string, WorkflowCapabilityStepDefinition>,
): Set<string> {
  const dependencies = new Set<string>();
  const pending = [...step.dependsOn];
  while (pending.length > 0) {
    const dependencyId = pending.pop();
    if (!dependencyId || dependencies.has(dependencyId)) continue;
    dependencies.add(dependencyId);
    pending.push(...(stepById.get(dependencyId)?.dependsOn ?? []));
  }
  return dependencies;
}

function dataTypesOverlap(left: string[], right: string[]): boolean {
  return left.some((value) => right.includes(value));
}

function artifactTypesCompatible(left: string[], right: string[]): boolean {
  return left.length === 0 || right.length === 0 || left.some((value) => right.includes(value));
}

function workflowIssueStepId(issue: string, stepIds: string[]): string | undefined {
  let match: { index: number; stepId: string } | undefined;
  for (const stepId of stepIds) {
    const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const index = issue.search(new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`));
    if (index < 0 || (match && match.index <= index)) continue;
    match = { index, stepId };
  }
  return match?.stepId;
}
