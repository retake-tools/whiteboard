import { capabilityDefinitionFor } from './capabilityRegistry';
import type { CapabilityCardinality, CapabilityDataType } from './capabilityContracts';
import { skillDefinitionFor } from './skillRegistry';
import storyToStoryboardSource from '../../packages/builtin/story-production-starter/workflows/workflow-story-to-storyboard/retake.workflow.json';
import storyboardUnitToSheetSource from '../../packages/builtin/story-production-starter/workflows/workflow-storyboard-unit-to-sheet/retake.workflow.json';
import storyboardUnitToGenerationPackageSource from '../../packages/builtin/story-production-starter/workflows/workflow-storyboard-unit-to-generation-package/retake.workflow.json';
import approvedGenerationPackageToVideoSource from '../../packages/builtin/story-production-starter/workflows/workflow-approved-generation-package-to-video/retake.workflow.json';

export type WorkflowStepType = 'capability';
export type WorkflowRunPolicy = 'manual';
export type WorkflowDefaultRunMode = 'manual';
export type WorkflowOutputAcceptancePolicy = 'automatic' | 'manual_selection' | 'manual_single';
export type WorkflowStageCompletionPolicy = 'all_required_steps';

export interface WorkflowInputSlotDefinition {
  artifactTypes: string[];
  cardinality: CapabilityCardinality;
  dataTypes: CapabilityDataType[];
  required: boolean;
  schemaRef?: string;
  slotId: string;
}

export type WorkflowBindingSource =
  | { kind: 'workflow_input'; slotId: string }
  | { kind: 'step_output'; outputSlotId: string; stepId: string };

export interface WorkflowStepInputBinding {
  inputSlotId: string;
  source: WorkflowBindingSource;
}

export interface WorkflowCapabilityStepDefinition {
  capabilityLock: {
    capabilityId: string;
    definitionHash: string;
    version: string;
  };
  dependsOn: string[];
  inputBindings: WorkflowStepInputBinding[];
  optional: boolean;
  outputAcceptancePolicy?: WorkflowOutputAcceptancePolicy;
  outputSlots: string[];
  runPolicy: WorkflowRunPolicy;
  skillLock: {
    definitionHash: string;
    skillId: string;
    version: string;
  };
  stageId: string;
  stepId: string;
  type: WorkflowStepType;
}

export interface WorkflowOutputSlotDefinition {
  exposedAsIntermediate: boolean;
  slotId: string;
  source: Extract<WorkflowBindingSource, { kind: 'step_output' }>;
}

export interface WorkflowStageDefinition {
  completionPolicy: WorkflowStageCompletionPolicy;
  description?: string;
  name: string;
  outputWorkflowSlotIds: string[];
  stageId: string;
  stageTypeId: string;
}

export interface WorkflowHumanApprovalGateDefinition {
  definitionHash: string;
  gateId: string;
  kind: 'human_approval';
  name?: string;
  required: true;
  reviewChecklist?: string[];
  subject:
    | {
      kind: 'step_output';
      outputSlotId: string;
      stepId: string;
    }
    | {
      kind: 'artifact_revision';
      workflowOutputSlotId: string;
    };
}

export type WorkflowGateDefinition = WorkflowHumanApprovalGateDefinition;

export interface WorkflowDefinition {
  defaultRunMode: WorkflowDefaultRunMode;
  definitionHash: string;
  description: string;
  gates: WorkflowGateDefinition[];
  inputSlots: WorkflowInputSlotDefinition[];
  name: string;
  outputSlots: WorkflowOutputSlotDefinition[];
  schemaVersion: 1;
  stages?: WorkflowStageDefinition[];
  steps: WorkflowCapabilityStepDefinition[];
  version: string;
  workflowId: string;
  ui?: WorkflowUiDefinition;
}

export interface WorkflowUiDefinition {
  description: PluginLocalizedTextV2;
  name: PluginLocalizedTextV2;
}

export interface ResolvedWorkflowUiDefinition {
  description: string;
  name: string;
}

export const storyToStoryboardWorkflow = storyToStoryboardSource as unknown as WorkflowDefinition;
export const storyboardUnitToSheetWorkflow = storyboardUnitToSheetSource as unknown as WorkflowDefinition;
export const storyboardUnitToGenerationPackageWorkflow = storyboardUnitToGenerationPackageSource as unknown as WorkflowDefinition;
export const approvedGenerationPackageToVideoWorkflow = approvedGenerationPackageToVideoSource as unknown as WorkflowDefinition;

const builtInWorkflows = [
  storyToStoryboardWorkflow,
  storyboardUnitToSheetWorkflow,
  storyboardUnitToGenerationPackageWorkflow,
  approvedGenerationPackageToVideoWorkflow,
] as const;

let activeWorkflows: WorkflowDefinition[] = structuredClone([...builtInWorkflows]);

export function listWorkflows(): WorkflowDefinition[] {
  return structuredClone(activeWorkflows);
}

export function configureWorkflowRegistry(
  definitions: WorkflowDefinition[],
): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.workflowId)) {
      throw new Error(`Duplicate Workflow definition: ${definition.workflowId}`);
    }
    ids.add(definition.workflowId);
    const issues = validateWorkflowDefinition(definition);
    if (issues.length > 0) throw new Error(issues.join('\n'));
  }
  activeWorkflows = structuredClone(definitions);
}

export function workflowDefinitionFor(workflowId: string): WorkflowDefinition {
  const definition = activeWorkflows.find((candidate) => candidate.workflowId === workflowId);
  if (!definition) throw new Error(`Workflow definition not found: ${workflowId}`);
  return structuredClone(definition);
}

export function workflowUiDefinitionFor(workflowId: string): WorkflowUiDefinition {
  const definition = workflowDefinitionFor(workflowId).ui;
  if (!definition) {
    throw new Error(`Workflow UI definition not found: ${workflowId}`);
  }
  return structuredClone(definition);
}

export function resolvedWorkflowUiDefinitionFor(
  workflowId: string,
  locale: string,
): ResolvedWorkflowUiDefinition {
  const definition = workflowUiDefinitionFor(workflowId);
  return {
    description: resolvePluginLocalizedTextV2(definition.description, locale),
    name: resolvePluginLocalizedTextV2(definition.name, locale),
  };
}

export function validateWorkflowDefinition(workflow: WorkflowDefinition): string[] {
  const issues: string[] = [];
  const workflowInputById = new Map<string, WorkflowInputSlotDefinition>();
  for (const slot of workflow.inputSlots) {
    if (workflowInputById.has(slot.slotId)) issues.push(`Duplicate Workflow input slot: ${slot.slotId}`);
    if (slot.required && slot.cardinality === 'optional') {
      issues.push(`Required Workflow input cannot be optional: ${slot.slotId}`);
    }
    workflowInputById.set(slot.slotId, slot);
  }
  const stepById = new Map<string, WorkflowCapabilityStepDefinition>();
  for (const step of workflow.steps) {
    if (stepById.has(step.stepId)) issues.push(`Duplicate Workflow stepId: ${step.stepId}`);
    stepById.set(step.stepId, step);
  }
  const workflowOutputById = new Map(
    workflow.outputSlots.map((slot) => [slot.slotId, slot]),
  );
  validateWorkflowStages(workflow, stepById, workflowOutputById, issues);

  const gateIds = new Set<string>();
  for (const gate of workflow.gates) {
    if (gateIds.has(gate.gateId)) issues.push(`Duplicate Workflow gateId: ${gate.gateId}`);
    gateIds.add(gate.gateId);
    if (gate.name !== undefined && gate.name.trim().length === 0) {
      issues.push(`Workflow Gate name is invalid: ${gate.gateId}`);
    }
    if (!gate.definitionHash.startsWith('sha256:')) {
      issues.push(`Workflow Gate definitionHash is invalid: ${gate.gateId}`);
    }
    if (gate.subject.kind === 'step_output') {
      const subjectStep = stepById.get(gate.subject.stepId);
      if (!subjectStep) {
        issues.push(`Workflow Gate subject Step is missing: ${gate.gateId}.${gate.subject.stepId}`);
      } else if (!subjectStep.outputSlots.includes(gate.subject.outputSlotId)) {
        issues.push(`Workflow Gate subject output is missing: ${gate.gateId}.${gate.subject.outputSlotId}`);
      }
    } else if (!workflowOutputById.has(gate.subject.workflowOutputSlotId)) {
      issues.push(
        `Workflow Gate Artifact subject output is missing: ${gate.gateId}.${gate.subject.workflowOutputSlotId}`,
      );
    }
  }

  for (const step of workflow.steps) {
    const capability = capabilityDefinitionFor(step.capabilityLock.capabilityId);
    const skill = skillDefinitionFor(step.skillLock.skillId);
    if (
      capability.version !== step.capabilityLock.version
      || capability.definitionHash !== step.capabilityLock.definitionHash
    ) issues.push(`Capability lock mismatch: ${step.stepId}.${capability.capabilityId}`);
    if (skill.version !== step.skillLock.version || skill.definitionHash !== step.skillLock.definitionHash) {
      issues.push(`Skill lock mismatch: ${step.stepId}.${skill.skillId}`);
    }
    if (!skill.capabilityBindings.some((binding) => binding.capabilityId === capability.capabilityId)) {
      issues.push(`Skill does not bind Workflow capability: ${step.stepId}.${skill.skillId}`);
    }
    for (const dependencyId of step.dependsOn) {
      if (dependencyId === step.stepId || !stepById.has(dependencyId)) {
        issues.push(`Invalid Workflow dependency: ${step.stepId}.${dependencyId}`);
      }
    }
    const dependencyIds = workflowDependencyClosure(step, stepById);
    const boundInputIds = new Set<string>();
    for (const binding of step.inputBindings) {
      if (boundInputIds.has(binding.inputSlotId)) {
        issues.push(`Duplicate Workflow step input binding: ${step.stepId}.${binding.inputSlotId}`);
      }
      boundInputIds.add(binding.inputSlotId);
      const targetSlot = capability.inputSlots.find((slot) => slot.slotId === binding.inputSlotId);
      if (!targetSlot) {
        issues.push(`Workflow binding targets unknown capability input: ${step.stepId}.${binding.inputSlotId}`);
        continue;
      }
      if (binding.source.kind === 'workflow_input') {
        const sourceSlot = workflowInputById.get(binding.source.slotId);
        if (!sourceSlot) {
          issues.push(`Workflow binding uses unknown workflow input: ${step.stepId}.${binding.source.slotId}`);
          continue;
        }
        if (!sourceSlot.dataTypes.some((dataType) => targetSlot.dataTypes.includes(dataType))) {
          issues.push(`Workflow input data type mismatch: ${step.stepId}.${binding.inputSlotId}`);
        }
        if (sourceSlot.cardinality === 'many' && targetSlot.cardinality !== 'many') {
          issues.push(`Workflow input cardinality mismatch: ${step.stepId}.${binding.inputSlotId}`);
        }
        if (
          targetSlot.artifactTypes.length > 0
          && !sourceSlot.artifactTypes.some((artifactType) => targetSlot.artifactTypes.includes(artifactType))
        ) {
          issues.push(`Workflow input artifact type mismatch: ${step.stepId}.${binding.inputSlotId}`);
        }
        continue;
      }
      const source = binding.source;
      if (!dependencyIds.has(source.stepId)) {
        issues.push(`Workflow binding source is not a dependency: ${step.stepId}.${source.stepId}`);
      }
      const sourceStep = stepById.get(source.stepId);
      if (!sourceStep || !sourceStep.outputSlots.includes(source.outputSlotId)) {
        issues.push(`Workflow binding uses unknown step output: ${step.stepId}.${source.stepId}.${source.outputSlotId}`);
        continue;
      }
      const sourceCapability = capabilityDefinitionFor(sourceStep.capabilityLock.capabilityId);
      const sourceSlot = sourceCapability.outputSlots.find((slot) => slot.slotId === source.outputSlotId);
      if (!sourceSlot) {
        issues.push(`Workflow source capability output is missing: ${sourceStep.stepId}.${source.outputSlotId}`);
        continue;
      }
      if (!targetSlot.dataTypes.includes(sourceSlot.dataType)) {
        issues.push(`Workflow binding data type mismatch: ${step.stepId}.${binding.inputSlotId}`);
      }
      if (
        targetSlot.artifactTypes.length > 0
        && sourceSlot.artifactType
        && !targetSlot.artifactTypes.includes(sourceSlot.artifactType)
      ) issues.push(`Workflow binding artifact type mismatch: ${step.stepId}.${binding.inputSlotId}`);
    }
    for (const requiredSlot of capability.inputSlots.filter((slot) => slot.required)) {
      if (!boundInputIds.has(requiredSlot.slotId)) {
        issues.push(`Required Workflow step input is not bound: ${step.stepId}.${requiredSlot.slotId}`);
      }
    }
    for (const outputSlotId of step.outputSlots) {
      if (!capability.outputSlots.some((slot) => slot.slotId === outputSlotId)) {
        issues.push(`Workflow step exposes unknown capability output: ${step.stepId}.${outputSlotId}`);
      }
    }
  }

  if (!isAcyclic(workflow.steps)) issues.push(`Workflow must be an acyclic graph: ${workflow.workflowId}`);
  const workflowOutputIds = new Set<string>();
  for (const output of workflow.outputSlots) {
    if (workflowOutputIds.has(output.slotId)) issues.push(`Duplicate Workflow output slot: ${output.slotId}`);
    workflowOutputIds.add(output.slotId);
    const step = stepById.get(output.source.stepId);
    if (!step?.outputSlots.includes(output.source.outputSlotId)) {
      issues.push(`Workflow output uses unknown step output: ${output.slotId}`);
    }
  }
  return issues;
}

function validateWorkflowStages(
  workflow: WorkflowDefinition,
  stepById: Map<string, WorkflowCapabilityStepDefinition>,
  workflowOutputById: Map<string, WorkflowOutputSlotDefinition>,
  issues: string[],
): void {
  if (!workflow.stages) return;
  const stageById = new Map<string, WorkflowStageDefinition>();
  for (const stage of workflow.stages) {
    if (stageById.has(stage.stageId)) issues.push(`Duplicate Workflow stageId: ${stage.stageId}`);
    stageById.set(stage.stageId, stage);
  }
  const stepsByStageId = new Map<string, WorkflowCapabilityStepDefinition[]>();
  for (const step of workflow.steps) {
    if (!stageById.has(step.stageId)) {
      issues.push(`Workflow Step references unknown Stage: ${step.stepId}.${step.stageId}`);
      continue;
    }
    stepsByStageId.set(step.stageId, [...(stepsByStageId.get(step.stageId) ?? []), step]);
  }
  const claimedOutputIds = new Set<string>();
  for (const stage of workflow.stages) {
    const members = stepsByStageId.get(stage.stageId) ?? [];
    if (!members.some((step) => !step.optional)) {
      issues.push(`Workflow Stage requires at least one required Step: ${stage.stageId}`);
    }
    for (const workflowOutputSlotId of stage.outputWorkflowSlotIds) {
      if (claimedOutputIds.has(workflowOutputSlotId)) {
        issues.push(`Workflow Stage output is declared more than once: ${workflowOutputSlotId}`);
      }
      claimedOutputIds.add(workflowOutputSlotId);
      const output = workflowOutputById.get(workflowOutputSlotId);
      if (!output) {
        issues.push(`Workflow Stage output is missing: ${stage.stageId}.${workflowOutputSlotId}`);
        continue;
      }
      const producer = stepById.get(output.source.stepId);
      if (producer?.stageId !== stage.stageId) {
        issues.push(`Workflow Stage output producer belongs to another Stage: ${stage.stageId}.${workflowOutputSlotId}`);
      } else if (producer.optional) {
        issues.push(`Workflow Stage output producer cannot be optional: ${stage.stageId}.${workflowOutputSlotId}`);
      }
    }
  }
  for (const step of workflow.steps.filter((candidate) => !candidate.optional)) {
    for (const dependencyId of step.dependsOn) {
      if (stepById.get(dependencyId)?.optional) {
        issues.push(`Required Workflow Step depends on optional Step: ${step.stepId}.${dependencyId}`);
      }
    }
  }
  if (!isStageGraphAcyclic(workflow.steps, stageById)) {
    issues.push(`Workflow Stage graph must be acyclic: ${workflow.workflowId}`);
  }
}

function isStageGraphAcyclic(
  steps: WorkflowCapabilityStepDefinition[],
  stageById: Map<string, WorkflowStageDefinition>,
): boolean {
  const dependencyIdsByStage = new Map<string, Set<string>>(
    [...stageById.keys()].map((stageId) => [stageId, new Set<string>()]),
  );
  const stepById = new Map(steps.map((step) => [step.stepId, step]));
  for (const step of steps) {
    const stageDependencies = dependencyIdsByStage.get(step.stageId);
    if (!stageDependencies) continue;
    for (const dependencyId of step.dependsOn) {
      const dependencyStageId = stepById.get(dependencyId)?.stageId;
      if (dependencyStageId && dependencyStageId !== step.stageId) {
        stageDependencies.add(dependencyStageId);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stageId: string): boolean => {
    if (visiting.has(stageId)) return false;
    if (visited.has(stageId)) return true;
    visiting.add(stageId);
    for (const dependencyId of dependencyIdsByStage.get(stageId) ?? []) {
      if (!visit(dependencyId)) return false;
    }
    visiting.delete(stageId);
    visited.add(stageId);
    return true;
  };
  return [...stageById.keys()].every(visit);
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
    const dependency = stepById.get(dependencyId);
    if (dependency) pending.push(...dependency.dependsOn);
  }
  return dependencies;
}

function isAcyclic(steps: WorkflowCapabilityStepDefinition[]): boolean {
  const remaining = new Map(steps.map((step) => [step.stepId, step]));
  const resolved = new Set<string>();
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((step) => step.dependsOn.every((stepId) => resolved.has(stepId)));
    if (ready.length === 0) return false;
    for (const step of ready) {
      remaining.delete(step.stepId);
      resolved.add(step.stepId);
    }
  }
  return true;
}
import {
  resolvePluginLocalizedTextV2,
  type PluginLocalizedTextV2,
} from '@retake-tools/package-contracts';
