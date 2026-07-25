import type { DeclarativePackageManifest } from './declarativePackageContracts';
import {
  declarativeAgentPresetDefinitionSchema,
  declarativeSkillDefinitionSchema,
  declarativeWorkflowDefinitionSchema,
  type DeclarativeAgentPresetDefinition,
  type DeclarativeSkillDefinition,
  type DeclarativeWorkflowDefinition,
} from './declarativePackageDefinitionSchemas';

export interface DeclarativePackageDefinitions {
  agentPresets: Map<string, DeclarativeAgentPresetDefinition>;
  skills: Map<string, DeclarativeSkillDefinition>;
  workflows: Map<string, DeclarativeWorkflowDefinition>;
}

export interface DeclarativePackageDefinitionValidation {
  definitions: DeclarativePackageDefinitions;
  issues: string[];
}

export function validateDeclarativePackageDefinitions(
  manifest: DeclarativePackageManifest,
  jsonFiles: Map<string, unknown>,
): DeclarativePackageDefinitionValidation {
  const issues: string[] = [];
  const definitions: DeclarativePackageDefinitions = {
    agentPresets: new Map(),
    skills: new Map(),
    workflows: new Map(),
  };

  for (const component of manifest.components.skills) {
    const parsed = declarativeSkillDefinitionSchema.safeParse(
      jsonFiles.get(component.definitionPath),
    );
    if (!parsed.success) {
      appendSchemaIssues(component.definitionPath, parsed.error.issues, issues);
      continue;
    }
    const definition = parsed.data;
    if (
      definition.skillId !== component.skillId
      || definition.version !== component.version
      || definition.definitionHash !== component.definitionHash
    ) issues.push(`Package Skill identity does not match its component lock: ${component.skillId}`);
    validateSkillDefinition(definition, issues);
    definitions.skills.set(component.skillId, definition);
  }

  for (const component of manifest.components.workflows) {
    const parsed = declarativeWorkflowDefinitionSchema.safeParse(
      jsonFiles.get(component.definitionPath),
    );
    if (!parsed.success) {
      appendSchemaIssues(component.definitionPath, parsed.error.issues, issues);
      continue;
    }
    const definition = parsed.data;
    if (
      definition.workflowId !== component.workflowDefinitionId
      || definition.version !== component.version
      || definition.definitionHash !== component.definitionHash
    ) {
      issues.push(
        `Package Workflow identity does not match its component lock: ${component.workflowDefinitionId}`,
      );
    }
    validateWorkflowDefinition(definition, issues);
    definitions.workflows.set(component.workflowDefinitionId, definition);
  }

  for (const component of manifest.components.agentPresets) {
    const parsed = declarativeAgentPresetDefinitionSchema.safeParse(
      jsonFiles.get(component.definitionPath),
    );
    if (!parsed.success) {
      appendSchemaIssues(component.definitionPath, parsed.error.issues, issues);
      continue;
    }
    const definition = parsed.data;
    if (
      definition.agentPresetId !== component.agentPresetId
      || definition.version !== component.version
      || definition.definitionHash !== component.definitionHash
    ) {
      issues.push(
        `Package AgentPreset identity does not match its component lock: ${component.agentPresetId}`,
      );
    }
    validateAgentPresetDefinition(definition, issues);
    definitions.agentPresets.set(component.agentPresetId, definition);
  }

  validateEntrypoints(manifest, definitions, issues);
  validateLocalDefinitionLocks(definitions, issues);
  return { definitions, issues };
}

function validateSkillDefinition(
  definition: DeclarativeSkillDefinition,
  issues: string[],
): void {
  uniqueNonEmpty(
    definition.outputRequirements,
    `Skill outputRequirements ${definition.skillId}`,
    issues,
  );
  const capabilityIds = new Set<string>();
  for (const binding of definition.capabilityBindings) {
    if (capabilityIds.has(binding.capabilityId)) {
      issues.push(`Duplicate Skill Capability binding: ${definition.skillId}.${binding.capabilityId}`);
    }
    capabilityIds.add(binding.capabilityId);
    uniqueNonEmpty(
      binding.inputSlots,
      `Skill input slots ${definition.skillId}.${binding.capabilityId}`,
      issues,
    );
    uniqueNonEmpty(
      binding.outputSlots,
      `Skill output slots ${definition.skillId}.${binding.capabilityId}`,
      issues,
    );
  }
}

function validateWorkflowDefinition(
  definition: DeclarativeWorkflowDefinition,
  issues: string[],
): void {
  const inputSlots = uniqueMap(
    definition.inputSlots,
    (slot) => slot.slotId,
    `Workflow input slot ${definition.workflowId}`,
    issues,
  );
  for (const slot of definition.inputSlots) {
    uniqueNonEmpty(slot.dataTypes, `Workflow input dataTypes ${slot.slotId}`, issues);
    uniqueNonEmpty(slot.artifactTypes, `Workflow input artifactTypes ${slot.slotId}`, issues, true);
    if (slot.required && slot.cardinality === 'optional') {
      issues.push(`Required Workflow input cannot be optional: ${definition.workflowId}.${slot.slotId}`);
    }
  }

  const steps = uniqueMap(
    definition.steps,
    (step) => step.stepId,
    `Workflow step ${definition.workflowId}`,
    issues,
  );
  for (const step of definition.steps) {
    uniqueNonEmpty(step.dependsOn, `Workflow dependencies ${step.stepId}`, issues, true);
    uniqueNonEmpty(step.outputSlots, `Workflow step outputs ${step.stepId}`, issues);
    if (step.dependsOn.includes(step.stepId)) {
      issues.push(`Workflow Step cannot depend on itself: ${definition.workflowId}.${step.stepId}`);
    }
    for (const dependencyId of step.dependsOn) {
      if (!steps.has(dependencyId)) {
        issues.push(`Workflow dependency is missing: ${definition.workflowId}.${step.stepId}.${dependencyId}`);
      }
    }
    const inputBindingIds = new Set<string>();
    for (const binding of step.inputBindings) {
      if (inputBindingIds.has(binding.inputSlotId)) {
        issues.push(`Duplicate Workflow step input binding: ${step.stepId}.${binding.inputSlotId}`);
      }
      inputBindingIds.add(binding.inputSlotId);
      if (binding.source.kind === 'workflow_input') {
        if (!inputSlots.has(binding.source.slotId)) {
          issues.push(`Workflow binding input is missing: ${step.stepId}.${binding.source.slotId}`);
        }
        continue;
      }
      const sourceStep = steps.get(binding.source.stepId);
      if (!sourceStep?.outputSlots.includes(binding.source.outputSlotId)) {
        issues.push(
          `Workflow binding output is missing: ${step.stepId}.${binding.source.stepId}.${binding.source.outputSlotId}`,
        );
      }
      if (!workflowDependencyClosure(step.stepId, steps).has(binding.source.stepId)) {
        issues.push(`Workflow binding source is not a dependency: ${step.stepId}.${binding.source.stepId}`);
      }
    }
  }
  if (hasWorkflowCycle(steps)) issues.push(`Workflow dependency graph has a cycle: ${definition.workflowId}`);

  const outputs = uniqueMap(
    definition.outputSlots,
    (slot) => slot.slotId,
    `Workflow output slot ${definition.workflowId}`,
    issues,
  );
  for (const output of definition.outputSlots) {
    const sourceStep = steps.get(output.source.stepId);
    if (!sourceStep?.outputSlots.includes(output.source.outputSlotId)) {
      issues.push(
        `Workflow output source is missing: ${definition.workflowId}.${output.slotId}`,
      );
    }
  }

  const stages = uniqueMap(
    definition.stages ?? [],
    (stage) => stage.stageId,
    `Workflow stage ${definition.workflowId}`,
    issues,
  );
  for (const step of definition.steps) {
    if ((definition.stages?.length ?? 0) > 0 && !stages.has(step.stageId)) {
      issues.push(`Workflow Step stage is missing: ${definition.workflowId}.${step.stepId}.${step.stageId}`);
    }
  }
  for (const stage of definition.stages ?? []) {
    uniqueNonEmpty(
      stage.outputWorkflowSlotIds,
      `Workflow stage outputs ${stage.stageId}`,
      issues,
      true,
    );
    for (const outputSlotId of stage.outputWorkflowSlotIds) {
      if (!outputs.has(outputSlotId)) {
        issues.push(`Workflow Stage output is missing: ${definition.workflowId}.${stage.stageId}.${outputSlotId}`);
      }
    }
  }

  const gateIds = new Set<string>();
  for (const gate of definition.gates) {
    if (gateIds.has(gate.gateId)) {
      issues.push(`Duplicate Workflow Gate: ${definition.workflowId}.${gate.gateId}`);
    }
    gateIds.add(gate.gateId);
    if (gate.reviewChecklist) {
      uniqueNonEmpty(gate.reviewChecklist, `Workflow Gate checklist ${gate.gateId}`, issues);
    }
    if (gate.subject.kind === 'artifact_revision') {
      if (!outputs.has(gate.subject.workflowOutputSlotId)) {
        issues.push(`Workflow Gate Artifact output is missing: ${gate.gateId}`);
      }
      continue;
    }
    const subjectStep = steps.get(gate.subject.stepId);
    if (!subjectStep?.outputSlots.includes(gate.subject.outputSlotId)) {
      issues.push(`Workflow Gate Step output is missing: ${gate.gateId}`);
    }
  }
}

function validateAgentPresetDefinition(
  definition: DeclarativeAgentPresetDefinition,
  issues: string[],
): void {
  uniqueNonEmpty(
    definition.allowedCapabilityIds,
    `AgentPreset allowed capabilities ${definition.agentPresetId}`,
    issues,
  );
  uniqueNonEmpty(
    definition.reviewResponsibilities,
    `AgentPreset review responsibilities ${definition.agentPresetId}`,
    issues,
  );
  uniqueNonEmpty(
    definition.runtimePreference.compatibleRuntimeKinds,
    `AgentPreset runtime kinds ${definition.agentPresetId}`,
    issues,
  );
  uniqueNonEmpty(
    definition.runtimePreference.requiredFeatures,
    `AgentPreset runtime features ${definition.agentPresetId}`,
    issues,
  );
  uniqueNonEmpty(
    definition.toolPolicy.allowedToolPermissions,
    `AgentPreset tool permissions ${definition.agentPresetId}`,
    issues,
  );
  if (definition.skillPolicy.mode === 'allow_list') {
    uniqueNonEmpty(
      definition.skillPolicy.allowedSkillIds,
      `AgentPreset allowed skills ${definition.agentPresetId}`,
      issues,
    );
  }
  const preferred = definition.runtimePreference.preferredRuntimeKind;
  if (preferred && !definition.runtimePreference.compatibleRuntimeKinds.includes(preferred)) {
    issues.push(`AgentPreset preferred Runtime is not compatible: ${definition.agentPresetId}`);
  }
}

function validateEntrypoints(
  manifest: DeclarativePackageManifest,
  definitions: DeclarativePackageDefinitions,
  issues: string[],
): void {
  for (const entrypoint of manifest.entrypoints) {
    if (entrypoint.kind === 'skill') {
      const definition = definitions.skills.get(entrypoint.ref.skillId);
      const binding = definition?.capabilityBindings.find(
        (candidate) => candidate.capabilityId === entrypoint.ref.capabilityId,
      );
      if (definition && !binding) {
        issues.push(`Package Skill EntryPoint capability mismatch: ${entrypoint.entrypointId}`);
      }
      if (binding && entrypoint.requiredInputSlotIds.some(
        (slotId) => !binding.inputSlots.includes(slotId),
      )) issues.push(`Package Skill EntryPoint input is not declared by the Skill: ${entrypoint.entrypointId}`);
      continue;
    }
    if (entrypoint.kind === 'workflow') {
      const definition = definitions.workflows.get(entrypoint.ref.workflowDefinitionId);
      if (!definition) continue;
      const required = definition.inputSlots
        .filter((slot) => slot.required)
        .map((slot) => slot.slotId);
      if (
        required.length !== entrypoint.requiredInputSlotIds.length
        || required.some((slotId) => !entrypoint.requiredInputSlotIds.includes(slotId))
      ) issues.push(`Package Workflow EntryPoint required inputs mismatch: ${entrypoint.entrypointId}`);
    }
  }
}

function validateLocalDefinitionLocks(
  definitions: DeclarativePackageDefinitions,
  issues: string[],
): void {
  for (const workflow of definitions.workflows.values()) {
    for (const step of workflow.steps) {
      const skill = definitions.skills.get(step.skillLock.skillId);
      if (
        skill
        && (
          skill.version !== step.skillLock.version
          || skill.definitionHash !== step.skillLock.definitionHash
        )
      ) issues.push(`Workflow local Skill lock mismatch: ${workflow.workflowId}.${step.stepId}`);
    }
  }
}

function hasWorkflowCycle<T extends { dependsOn: string[] }>(steps: Map<string, T>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    visiting.add(stepId);
    for (const dependencyId of steps.get(stepId)?.dependsOn ?? []) {
      if (steps.has(dependencyId) && visit(dependencyId)) return true;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  };
  return [...steps.keys()].some(visit);
}

function workflowDependencyClosure<T extends { dependsOn: string[] }>(
  stepId: string,
  steps: Map<string, T>,
): Set<string> {
  const closure = new Set<string>();
  const visit = (candidateId: string) => {
    for (const dependencyId of steps.get(candidateId)?.dependsOn ?? []) {
      if (closure.has(dependencyId)) continue;
      closure.add(dependencyId);
      visit(dependencyId);
    }
  };
  visit(stepId);
  return closure;
}

function uniqueMap<T>(
  values: T[],
  idFor: (value: T) => string,
  label: string,
  issues: string[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = idFor(value);
    if (result.has(id)) issues.push(`Duplicate ${label}: ${id}`);
    result.set(id, value);
  }
  return result;
}

function uniqueNonEmpty(
  values: readonly string[],
  label: string,
  issues: string[],
  allowEmpty = false,
): void {
  if (!allowEmpty && values.length === 0) issues.push(`${label} is empty.`);
  if (values.length !== new Set(values).size) issues.push(`${label} contains duplicates.`);
}

function appendSchemaIssues(
  filePath: string,
  schemaIssues: { message: string; path: PropertyKey[] }[],
  issues: string[],
): void {
  for (const issue of schemaIssues) {
    issues.push(`${filePath}:${issue.path.map(String).join('.') || '$'}: ${issue.message}`);
  }
}
