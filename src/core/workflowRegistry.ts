import { capabilityDefinitionFor } from './capabilityRegistry';
import type { CapabilityCardinality, CapabilityDataType } from './capabilityContracts';
import { skillDefinitionFor } from './skillRegistry';

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
}

export interface WorkflowUiDefinition {
  descriptionKey:
    | 'workflow.storyToStoryboard.description'
    | 'workflow.storyboardUnitToSheet.description';
  nameKey:
    | 'workflow.storyToStoryboard.name'
    | 'workflow.storyboardUnitToSheet.name';
}

function capabilityLock(capabilityId: string): WorkflowCapabilityStepDefinition['capabilityLock'] {
  const definition = capabilityDefinitionFor(capabilityId);
  return {
    capabilityId: definition.capabilityId,
    version: definition.version,
    definitionHash: definition.definitionHash,
  };
}

function skillLock(skillId: string): WorkflowCapabilityStepDefinition['skillLock'] {
  const definition = skillDefinitionFor(skillId);
  return {
    skillId: definition.skillId,
    version: definition.version,
    definitionHash: definition.definitionHash,
  };
}

export const storyToStoryboardWorkflow: WorkflowDefinition = {
  schemaVersion: 1,
  workflowId: 'retake.workflow.story-to-storyboard',
  version: '0.2.0',
  definitionHash: 'sha256:retake-workflow-story-to-storyboard-stage-runtime-v2',
  name: 'Story to storyboard plan',
  description: 'Project a manual draft from creative brief through screenplay and production design to storyboard planning.',
  inputSlots: [{
    slotId: 'brief',
    artifactTypes: ['creative_brief'],
    cardinality: 'one',
    dataTypes: ['text', 'document'],
    required: true,
  }],
  outputSlots: [
    {
      slotId: 'screenplay',
      source: { kind: 'step_output', stepId: 'screenplay_generate', outputSlotId: 'screenplay' },
      exposedAsIntermediate: true,
    },
    {
      slotId: 'character_bible',
      source: { kind: 'step_output', stepId: 'character_define', outputSlotId: 'character_bible' },
      exposedAsIntermediate: true,
    },
    {
      slotId: 'scene_bible',
      source: { kind: 'step_output', stepId: 'scene_define', outputSlotId: 'scene_bible' },
      exposedAsIntermediate: true,
    },
    {
      slotId: 'storyboard_plan',
      source: { kind: 'step_output', stepId: 'storyboard_plan', outputSlotId: 'storyboard_plan' },
      exposedAsIntermediate: false,
    },
  ],
  stages: [
    {
      stageId: 'story_screenplay',
      stageTypeId: 'retake.stage.story_screenplay',
      name: 'Story & Screenplay',
      completionPolicy: 'all_required_steps',
      outputWorkflowSlotIds: ['screenplay'],
    },
    {
      stageId: 'production_design',
      stageTypeId: 'retake.stage.production_design',
      name: 'Production Design',
      completionPolicy: 'all_required_steps',
      outputWorkflowSlotIds: ['character_bible', 'scene_bible'],
    },
    {
      stageId: 'storyboard_previsualization',
      stageTypeId: 'retake.stage.storyboard_previsualization',
      name: 'Storyboard & Previsualization',
      completionPolicy: 'all_required_steps',
      outputWorkflowSlotIds: ['storyboard_plan'],
    },
  ],
  steps: [
    {
      stepId: 'screenplay_generate',
      type: 'capability',
      stageId: 'story_screenplay',
      capabilityLock: capabilityLock('story.screenplay.generate'),
      skillLock: skillLock('retake.screenplay.from-brief'),
      inputBindings: [{
        inputSlotId: 'brief',
        source: { kind: 'workflow_input', slotId: 'brief' },
      }],
      outputSlots: ['screenplay'],
      runPolicy: 'manual',
      dependsOn: [],
      optional: false,
    },
    {
      stepId: 'character_define',
      type: 'capability',
      stageId: 'production_design',
      capabilityLock: capabilityLock('design.character.define'),
      skillLock: skillLock('retake.character-bible.from-screenplay'),
      inputBindings: [{
        inputSlotId: 'screenplay',
        source: { kind: 'step_output', stepId: 'screenplay_generate', outputSlotId: 'screenplay' },
      }],
      outputSlots: ['character_bible'],
      runPolicy: 'manual',
      dependsOn: ['screenplay_generate'],
      optional: false,
    },
    {
      stepId: 'scene_define',
      type: 'capability',
      stageId: 'production_design',
      capabilityLock: capabilityLock('design.scene.define'),
      skillLock: skillLock('retake.scene-bible.from-screenplay'),
      inputBindings: [{
        inputSlotId: 'screenplay',
        source: { kind: 'step_output', stepId: 'screenplay_generate', outputSlotId: 'screenplay' },
      }],
      outputSlots: ['scene_bible'],
      runPolicy: 'manual',
      dependsOn: ['screenplay_generate'],
      optional: false,
    },
    {
      stepId: 'storyboard_plan',
      type: 'capability',
      stageId: 'storyboard_previsualization',
      capabilityLock: capabilityLock('previs.storyboard.plan'),
      skillLock: skillLock('retake.storyboard-plan.from-production-design'),
      inputBindings: [
        {
          inputSlotId: 'screenplay',
          source: { kind: 'step_output', stepId: 'screenplay_generate', outputSlotId: 'screenplay' },
        },
        {
          inputSlotId: 'character_bible',
          source: { kind: 'step_output', stepId: 'character_define', outputSlotId: 'character_bible' },
        },
        {
          inputSlotId: 'scene_bible',
          source: { kind: 'step_output', stepId: 'scene_define', outputSlotId: 'scene_bible' },
        },
      ],
      outputSlots: ['storyboard_plan'],
      runPolicy: 'manual',
      dependsOn: ['character_define', 'scene_define'],
      optional: false,
    },
  ],
  gates: [],
  defaultRunMode: 'manual',
};

export const storyboardUnitToSheetWorkflow: WorkflowDefinition = {
  schemaVersion: 1,
  workflowId: 'retake.workflow.storyboard-unit-to-sheet',
  version: '0.1.0',
  definitionHash: 'sha256:retake-workflow-storyboard-unit-to-sheet-v1',
  name: 'Storyboard unit to sheet',
  description: 'Generate image candidates for one explicitly selected storyboard unit and review one accepted sheet.',
  inputSlots: [
    {
      slotId: 'storyboard_plan',
      artifactTypes: ['storyboard_plan'],
      cardinality: 'one',
      dataTypes: ['document'],
      required: true,
    },
    {
      slotId: 'unit_id',
      artifactTypes: [],
      cardinality: 'one',
      dataTypes: ['text'],
      required: true,
      schemaRef: 'retake.storyboard-unit-id/v1',
    },
    {
      slotId: 'references',
      artifactTypes: [
        'character_reference',
        'scene_reference',
        'prop_reference',
        'storyboard_reference',
        'reference',
      ],
      cardinality: 'many',
      dataTypes: ['image'],
      required: false,
    },
  ],
  outputSlots: [{
    slotId: 'storyboard_sheet',
    source: {
      kind: 'step_output',
      stepId: 'storyboard_sheet_generate',
      outputSlotId: 'storyboard_sheet',
    },
    exposedAsIntermediate: false,
  }],
  stages: [{
    stageId: 'storyboard_previsualization',
    stageTypeId: 'retake.stage.storyboard_previsualization',
    name: 'Storyboard & Previsualization',
    completionPolicy: 'all_required_steps',
    outputWorkflowSlotIds: ['storyboard_sheet'],
  }],
  steps: [{
    stepId: 'storyboard_sheet_generate',
    type: 'capability',
    stageId: 'storyboard_previsualization',
    capabilityLock: capabilityLock('previs.storyboard_sheet.generate'),
    skillLock: skillLock('retake.storyboard-sheet.from-unit-plan'),
    inputBindings: [
      {
        inputSlotId: 'storyboard_plan',
        source: { kind: 'workflow_input', slotId: 'storyboard_plan' },
      },
      {
        inputSlotId: 'unit_id',
        source: { kind: 'workflow_input', slotId: 'unit_id' },
      },
      {
        inputSlotId: 'references',
        source: { kind: 'workflow_input', slotId: 'references' },
      },
    ],
    outputSlots: ['storyboard_sheet'],
    outputAcceptancePolicy: 'manual_single',
    runPolicy: 'manual',
    dependsOn: [],
    optional: false,
  }],
  gates: [{
    definitionHash: 'sha256:retake-workflow-gate-storyboard-sheet-review-v1',
    gateId: 'storyboard_sheet_review',
    kind: 'human_approval',
    name: 'Storyboard sheet review',
    required: true,
    reviewChecklist: [
      'geometry',
      'content_readout',
      'asset_fidelity',
      'continuity',
      'no_explanatory_overlay',
    ],
    subject: {
      kind: 'artifact_revision',
      workflowOutputSlotId: 'storyboard_sheet',
    },
  }],
  defaultRunMode: 'manual',
};

const builtInWorkflows = [storyToStoryboardWorkflow, storyboardUnitToSheetWorkflow] as const;

const workflowUiDefinitions: Record<string, WorkflowUiDefinition> = {
  [storyToStoryboardWorkflow.workflowId]: {
    nameKey: 'workflow.storyToStoryboard.name',
    descriptionKey: 'workflow.storyToStoryboard.description',
  },
  [storyboardUnitToSheetWorkflow.workflowId]: {
    nameKey: 'workflow.storyboardUnitToSheet.name',
    descriptionKey: 'workflow.storyboardUnitToSheet.description',
  },
};

export function listWorkflows(): WorkflowDefinition[] {
  return [...builtInWorkflows];
}

export function workflowDefinitionFor(workflowId: string): WorkflowDefinition {
  const definition = builtInWorkflows.find((candidate) => candidate.workflowId === workflowId);
  if (!definition) throw new Error(`Workflow definition not found: ${workflowId}`);
  return definition;
}

export function workflowUiDefinitionFor(workflowId: string): WorkflowUiDefinition {
  const definition = workflowUiDefinitions[workflowId];
  if (!definition) throw new Error(`Workflow UI definition not found: ${workflowId}`);
  return definition;
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
