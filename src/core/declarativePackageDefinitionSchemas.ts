import { z } from 'zod';

const namespacedId = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/);
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const definitionHash = z.string().regex(/^sha256:[A-Za-z0-9._-]+$/);
const nonEmptyStringArray = z.array(z.string().min(1));

const definitionIdentity = {
  definitionHash,
  schemaVersion: z.literal(1),
  version,
};

const skillCapabilityBindingSchema = z.object({
  capabilityId: namespacedId,
  inputSlots: nonEmptyStringArray,
  outputSlots: nonEmptyStringArray,
}).strict();

export const declarativeSkillDefinitionSchema = z.object({
  ...definitionIdentity,
  capabilityBindings: z.array(skillCapabilityBindingSchema).min(1),
  category: z.enum([
    'media_generation',
    'previsualization',
    'production_design',
    'screenplay',
  ]),
  description: z.string().min(1),
  instructionTemplate: z.string().min(1),
  name: z.string().min(1),
  outputRequirements: nonEmptyStringArray,
  skillId: namespacedId,
  source: z.object({
    kind: z.enum(['builtin', 'catmeme_migration', 'package']),
    paths: z.array(z.string().min(1)).optional(),
  }).strict(),
}).strict();

const workflowInputSlotSchema = z.object({
  artifactTypes: z.array(z.string().min(1)),
  cardinality: z.enum(['many', 'one', 'optional']),
  dataTypes: z.array(z.enum([
    'audio',
    'document',
    'image',
    'structured_data',
    'text',
    'video',
  ])).min(1),
  required: z.boolean(),
  schemaRef: z.string().min(1).optional(),
  slotId: z.string().min(1),
}).strict();

const workflowBindingSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('workflow_input'),
    slotId: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('step_output'),
    outputSlotId: z.string().min(1),
    stepId: z.string().min(1),
  }).strict(),
]);

const workflowStepSchema = z.object({
  capabilityLock: z.object({
    capabilityId: namespacedId,
    definitionHash,
    version,
  }).strict(),
  dependsOn: nonEmptyStringArray,
  inputBindings: z.array(z.object({
    inputSlotId: z.string().min(1),
    source: workflowBindingSourceSchema,
  }).strict()),
  optional: z.boolean(),
  outputAcceptancePolicy: z.enum([
    'automatic',
    'manual_selection',
    'manual_single',
  ]).optional(),
  outputSlots: nonEmptyStringArray,
  runPolicy: z.literal('manual'),
  skillLock: z.object({
    definitionHash,
    skillId: namespacedId,
    version,
  }).strict(),
  stageId: z.string().min(1),
  stepId: z.string().min(1),
  type: z.literal('capability'),
}).strict();

const workflowOutputSlotSchema = z.object({
  exposedAsIntermediate: z.boolean(),
  slotId: z.string().min(1),
  source: z.object({
    kind: z.literal('step_output'),
    outputSlotId: z.string().min(1),
    stepId: z.string().min(1),
  }).strict(),
}).strict();

const workflowStageSchema = z.object({
  completionPolicy: z.literal('all_required_steps'),
  description: z.string().min(1).optional(),
  name: z.string().min(1),
  outputWorkflowSlotIds: z.array(z.string().min(1)),
  stageId: z.string().min(1),
  stageTypeId: namespacedId,
}).strict();

const workflowGateSubjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step_output'),
    outputSlotId: z.string().min(1),
    stepId: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('artifact_revision'),
    workflowOutputSlotId: z.string().min(1),
  }).strict(),
]);

const workflowGateSchema = z.object({
  definitionHash,
  gateId: z.string().min(1),
  kind: z.literal('human_approval'),
  name: z.string().min(1).optional(),
  required: z.literal(true),
  reviewChecklist: nonEmptyStringArray.optional(),
  subject: workflowGateSubjectSchema,
}).strict();

export const declarativeWorkflowDefinitionSchema = z.object({
  ...definitionIdentity,
  defaultRunMode: z.literal('manual'),
  description: z.string().min(1),
  gates: z.array(workflowGateSchema),
  inputSlots: z.array(workflowInputSlotSchema),
  name: z.string().min(1),
  outputSlots: z.array(workflowOutputSlotSchema),
  stages: z.array(workflowStageSchema).optional(),
  steps: z.array(workflowStepSchema).min(1),
  workflowId: namespacedId,
}).strict();

export const declarativeAgentPresetDefinitionSchema = z.object({
  ...definitionIdentity,
  agentPresetId: namespacedId,
  allowedCapabilityIds: nonEmptyStringArray,
  description: z.string().min(1),
  instructions: z.string().min(1),
  name: z.string().min(1),
  permissionPolicy: z.object({
    canCreateBlocks: z.literal(false),
    canDeleteAssets: z.literal(false),
    canInstallPackages: z.literal(false),
    canModifyWorkflow: z.literal(false),
  }).strict(),
  reviewResponsibilities: z.array(z.enum([
    'input_readiness',
    'output_traceability',
    'scope_drift',
    'stage_handoff',
  ])).min(1),
  roleLabel: z.string().min(1).optional(),
  runtimePreference: z.object({
    compatibleRuntimeKinds: z.array(z.literal('codex_app_server')).min(1),
    preferredRuntimeKind: z.literal('codex_app_server').optional(),
    requiredFeatures: z.array(z.enum([
      'persistent_session',
      'streaming_events',
      'structured_output',
    ])).min(1),
  }).strict(),
  skillPolicy: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('any_compatible') }).strict(),
    z.object({
      allowedSkillIds: nonEmptyStringArray,
      mode: z.literal('allow_list'),
    }).strict(),
  ]),
  source: z.object({
    kind: z.enum(['builtin', 'catmeme_migration', 'package']),
    paths: z.array(z.string().min(1)).optional(),
  }).strict(),
  toolPolicy: z.object({
    allowedToolPermissions: z.array(z.enum([
      'retake.execute_capability',
      'retake.read',
    ])).min(1),
  }).strict(),
}).strict();

export type DeclarativeSkillDefinition = z.infer<typeof declarativeSkillDefinitionSchema>;
export type DeclarativeWorkflowDefinition = z.infer<typeof declarativeWorkflowDefinitionSchema>;
export type DeclarativeAgentPresetDefinition = z.infer<typeof declarativeAgentPresetDefinitionSchema>;
