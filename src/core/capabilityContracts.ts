import type { AssetKind, BlockType, ExecutionRecord } from './types';

export type CapabilityDataType = 'text' | 'document' | 'structured_data' | 'image' | 'video' | 'audio';

export type CapabilityCardinality = 'one' | 'optional' | 'many';

export type CapabilityBindingKind = 'inline' | 'block' | 'asset' | 'artifact_revision';

export type CapabilityProjectionBlockType = BlockType | 'document' | 'audio';

export interface CapabilityInputSlotDefinition {
  slotId: string;
  semanticRole: string;
  dataTypes: CapabilityDataType[];
  artifactTypes: string[];
  schemaRef?: string;
  cardinality: CapabilityCardinality;
  required: boolean;
  bindingKinds: CapabilityBindingKind[];
  minimumQualityTier?: 'draft' | 'preview' | 'final';
}

export interface CapabilityOutputSlotDefinition {
  slotId: string;
  semanticRole: string;
  dataType: CapabilityDataType;
  artifactType?: string;
  schemaRef?: string;
  cardinality: Exclude<CapabilityCardinality, 'optional'>;
  projectionBlockTypes: CapabilityProjectionBlockType[];
}

export interface CapabilityDefinition {
  schemaVersion: 1;
  capabilityId: string;
  version: string;
  definitionHash: string;
  category: string;
  displayName: string;
  inputSlots: CapabilityInputSlotDefinition[];
  outputSlots: CapabilityOutputSlotDefinition[];
  parametersSchemaRef?: string;
  runtimeRequirements: string[];
  supportedAdapterClasses: string[];
}

export interface DefinitionLock {
  version: string;
  definitionHash: string;
}

export interface CapabilityDefinitionLock extends DefinitionLock {
  capabilityId: string;
}

export interface SkillDefinitionLock extends DefinitionLock {
  skillId: string;
}

export type CapabilityBindingValue =
  | { kind: 'inline'; value: unknown }
  | { kind: 'block'; blockId: string }
  | { kind: 'asset'; assetId: string; blockId?: string }
  | { kind: 'artifact_revision'; artifactRevisionId: string; blockId?: string };

export interface CapabilityInputBinding {
  slotId: string;
  values: CapabilityBindingValue[];
}

export type CapabilityExecutionTriggerKind =
  | 'video_block_shortcut'
  | 'operation_block'
  | 'workflow_step'
  | 'agent'
  | 'direct_api'
  | 'manual_import';

export interface CapabilityExecutionTrigger {
  kind: CapabilityExecutionTriggerKind;
  sourceBlockId?: string;
  workflowRunId?: string;
  stepRunId?: string;
  agentRunId?: string;
}

export interface CapabilityActorRef {
  actorType: 'user' | 'agent' | 'worker' | 'system';
  actorId: string;
  agentRunId?: string | null;
}

export interface CapabilityExecutionScope {
  workspaceId: string;
  projectId: string;
  boardId?: string | null;
}

export interface CapabilityResultProjection {
  mode: 'none' | 'target' | 'target_and_siblings';
  targetBlockId?: string;
}

export interface CapabilityExecutionRequest {
  schemaVersion: 1;
  requestId: string;
  scope: CapabilityExecutionScope;
  trigger: CapabilityExecutionTrigger;
  capabilityLock: CapabilityDefinitionLock;
  skillLock?: SkillDefinitionLock | null;
  executionProfileId: string;
  requestedAdapterId?: string | null;
  requestedConnectionId?: string | null;
  requestedModel?: string | null;
  inputBindings: CapabilityInputBinding[];
  parameters: Record<string, unknown>;
  resultProjection: CapabilityResultProjection;
  actor: CapabilityActorRef;
  idempotencyKey: string;
  createdAt: string;
}

export interface BlockExecutionDraft {
  schemaVersion: 1;
  capabilityId: string;
  skillId?: string | null;
  executionProfileId: string;
  connectionId?: string | null;
  model?: string | null;
  prompt: string;
  parameters: Record<string, unknown>;
}

export type AdapterRouteKind =
  | 'direct_api'
  | 'provider_cli'
  | 'codex_app_server'
  | 'acp'
  | 'mcp_manual'
  | 'cli_agent'
  | 'local'
  | 'manual';

export interface AdapterInputProfile {
  profileId: string;
  requiredSlots: string[];
  optionalSlots: string[];
}

export interface AdapterDefinition {
  schemaVersion: 1;
  adapterId: string;
  version: string;
  definitionHash: string;
  adapterClass: string;
  routeKind: AdapterRouteKind;
  provider?: string;
  model?: string;
  supportedCapabilityIds: string[];
  inputProfiles: AdapterInputProfile[];
  constraints: Record<string, unknown>;
  executionBinding?: {
    pluginId: string;
    executableRef: string;
    transport: 'stdio_json';
  };
  credentialRefType?: string;
  availability: 'installed' | 'unavailable' | 'disabled';
}

export interface CapabilityAdapterProgress {
  phase: string;
  completed?: number;
  total?: number;
  message?: string;
}

export interface CapabilityAdapterProducedFile {
  slotId: string;
  sourcePath: string;
  kind: AssetKind;
  mimeType: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface CapabilityAdapterExecutionResult {
  producedFiles: CapabilityAdapterProducedFile[];
  usage?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
}

export interface CapabilityAdapterPort {
  readonly adapterId: string;
  validate(request: CapabilityExecutionRequest, definition: AdapterDefinition): Promise<void>;
  execute(input: {
    request: CapabilityExecutionRequest;
    execution: ExecutionRecord;
    definition: AdapterDefinition;
    signal: AbortSignal;
    emitProgress: (progress: CapabilityAdapterProgress) => void;
  }): Promise<CapabilityAdapterExecutionResult>;
  cancel(executionId: string): Promise<void>;
}

export interface ContractValidationIssue {
  code: string;
  path: string;
  message: string;
}

const capabilityDataTypes = new Set<CapabilityDataType>([
  'text',
  'document',
  'structured_data',
  'image',
  'video',
  'audio',
]);

const capabilityCardinalities = new Set<CapabilityCardinality>(['one', 'optional', 'many']);
const capabilityBindingKinds = new Set<CapabilityBindingKind>(['inline', 'block', 'asset', 'artifact_revision']);
const capabilityProjectionBlockTypes = new Set<CapabilityProjectionBlockType>([
  'text',
  'document',
  'image',
  'video',
  'audio',
  'operation',
  'group',
]);
const capabilityExecutionTriggerKinds = new Set<CapabilityExecutionTriggerKind>([
  'video_block_shortcut',
  'operation_block',
  'workflow_step',
  'agent',
  'direct_api',
  'manual_import',
]);
const adapterRouteKinds = new Set<AdapterRouteKind>([
  'direct_api',
  'provider_cli',
  'codex_app_server',
  'acp',
  'mcp_manual',
  'cli_agent',
  'local',
  'manual',
]);

export function validateCapabilityDefinition(input: unknown): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (!isRecord(input)) return [issue('definition_invalid', '$', 'CapabilityDefinition must be an object.')];

  requireLiteral(input.schemaVersion, 1, '$.schemaVersion', issues);
  requireString(input.capabilityId, '$.capabilityId', issues);
  requireVersion(input.version, '$.version', issues);
  requireDefinitionHash(input.definitionHash, '$.definitionHash', issues);
  requireString(input.category, '$.category', issues);
  requireString(input.displayName, '$.displayName', issues);
  requireStringArray(input.runtimeRequirements, '$.runtimeRequirements', issues);
  requireStringArray(input.supportedAdapterClasses, '$.supportedAdapterClasses', issues, true);

  const slotIds = new Set<string>();
  validateInputSlots(input.inputSlots, slotIds, issues);
  validateOutputSlots(input.outputSlots, slotIds, issues);
  if (input.parametersSchemaRef !== undefined) requireString(input.parametersSchemaRef, '$.parametersSchemaRef', issues);
  return issues;
}

export function validateAdapterDefinition(input: unknown): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (!isRecord(input)) return [issue('definition_invalid', '$', 'AdapterDefinition must be an object.')];

  requireLiteral(input.schemaVersion, 1, '$.schemaVersion', issues);
  requireString(input.adapterId, '$.adapterId', issues);
  requireVersion(input.version, '$.version', issues);
  requireDefinitionHash(input.definitionHash, '$.definitionHash', issues);
  requireString(input.adapterClass, '$.adapterClass', issues);
  if (!adapterRouteKinds.has(input.routeKind as AdapterRouteKind)) {
    issues.push(issue('route_kind_invalid', '$.routeKind', 'Adapter routeKind is not supported.'));
  }
  requireStringArray(input.supportedCapabilityIds, '$.supportedCapabilityIds', issues, true);
  if (!Array.isArray(input.inputProfiles)) {
    issues.push(issue('input_profiles_invalid', '$.inputProfiles', 'inputProfiles must be an array.'));
  } else {
    const profileIds = new Set<string>();
    input.inputProfiles.forEach((profile, index) => validateInputProfile(profile, index, profileIds, issues));
  }
  if (!isRecord(input.constraints)) issues.push(issue('constraints_invalid', '$.constraints', 'constraints must be an object.'));
  if (!['installed', 'unavailable', 'disabled'].includes(String(input.availability))) {
    issues.push(issue('availability_invalid', '$.availability', 'availability is not supported.'));
  }
  if (input.routeKind === 'provider_cli') validateProviderCliBinding(input.executionBinding, issues);
  return issues;
}

export function validateCapabilityExecutionRequest(
  input: unknown,
  definition: CapabilityDefinition,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (!isRecord(input)) return [issue('request_invalid', '$', 'CapabilityExecutionRequest must be an object.')];

  requireLiteral(input.schemaVersion, 1, '$.schemaVersion', issues);
  requireString(input.requestId, '$.requestId', issues);
  requireString(input.executionProfileId, '$.executionProfileId', issues);
  requireString(input.idempotencyKey, '$.idempotencyKey', issues);
  requireIsoTimestamp(input.createdAt, '$.createdAt', issues);
  validateScope(input.scope, issues);
  validateActor(input.actor, issues);
  validateCapabilityLock(input.capabilityLock, definition, issues);
  validateSkillLock(input.skillLock, issues);
  validateTrigger(input.trigger, issues);
  if (input.requestedAdapterId !== undefined && input.requestedAdapterId !== null) {
    requireString(input.requestedAdapterId, '$.requestedAdapterId', issues);
  }
  if (input.requestedConnectionId !== undefined && input.requestedConnectionId !== null) {
    requireString(input.requestedConnectionId, '$.requestedConnectionId', issues);
  }
  if (input.requestedModel !== undefined && input.requestedModel !== null) {
    requireString(input.requestedModel, '$.requestedModel', issues);
  }
  if (!isRecord(input.parameters)) issues.push(issue('parameters_invalid', '$.parameters', 'parameters must be an object.'));
  validateResultProjection(input.resultProjection, issues);
  validateInputBindings(input.inputBindings, definition, issues);
  return issues;
}

export function assertValidCapabilityDefinition(input: unknown): asserts input is CapabilityDefinition {
  const issues = validateCapabilityDefinition(input);
  if (issues.length) throw new Error(formatValidationIssues('Invalid CapabilityDefinition', issues));
}

export function assertValidCapabilityExecutionRequest(
  input: unknown,
  definition: CapabilityDefinition,
): asserts input is CapabilityExecutionRequest {
  const issues = validateCapabilityExecutionRequest(input, definition);
  if (issues.length) throw new Error(formatValidationIssues('Invalid CapabilityExecutionRequest', issues));
}

function validateInputSlots(input: unknown, slotIds: Set<string>, issues: ContractValidationIssue[]): void {
  if (!Array.isArray(input)) {
    issues.push(issue('input_slots_invalid', '$.inputSlots', 'inputSlots must be an array.'));
    return;
  }
  input.forEach((slot, index) => {
    const path = `$.inputSlots[${index}]`;
    if (!isRecord(slot)) {
      issues.push(issue('input_slot_invalid', path, 'Input slot must be an object.'));
      return;
    }
    validateSlotId(slot.slotId, path, slotIds, issues);
    requireString(slot.semanticRole, `${path}.semanticRole`, issues);
    validateEnumArray(slot.dataTypes, capabilityDataTypes, `${path}.dataTypes`, issues, true);
    requireStringArray(slot.artifactTypes, `${path}.artifactTypes`, issues);
    if (!capabilityCardinalities.has(slot.cardinality as CapabilityCardinality)) {
      issues.push(issue('cardinality_invalid', `${path}.cardinality`, 'Input cardinality is not supported.'));
    }
    if (typeof slot.required !== 'boolean') {
      issues.push(issue('required_invalid', `${path}.required`, 'required must be a boolean.'));
    } else if (slot.cardinality === 'one' && !slot.required) {
      issues.push(issue('cardinality_required_mismatch', path, 'cardinality=one requires required=true.'));
    } else if (slot.cardinality === 'optional' && slot.required) {
      issues.push(issue('cardinality_required_mismatch', path, 'cardinality=optional requires required=false.'));
    }
    validateEnumArray(slot.bindingKinds, capabilityBindingKinds, `${path}.bindingKinds`, issues, true);
    if (slot.schemaRef !== undefined) requireString(slot.schemaRef, `${path}.schemaRef`, issues);
    if (slot.minimumQualityTier !== undefined && !['draft', 'preview', 'final'].includes(String(slot.minimumQualityTier))) {
      issues.push(issue('quality_tier_invalid', `${path}.minimumQualityTier`, 'minimumQualityTier is not supported.'));
    }
  });
}

function validateOutputSlots(input: unknown, slotIds: Set<string>, issues: ContractValidationIssue[]): void {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push(issue('output_slots_invalid', '$.outputSlots', 'outputSlots must contain at least one slot.'));
    return;
  }
  input.forEach((slot, index) => {
    const path = `$.outputSlots[${index}]`;
    if (!isRecord(slot)) {
      issues.push(issue('output_slot_invalid', path, 'Output slot must be an object.'));
      return;
    }
    validateSlotId(slot.slotId, path, slotIds, issues);
    requireString(slot.semanticRole, `${path}.semanticRole`, issues);
    if (!capabilityDataTypes.has(slot.dataType as CapabilityDataType)) {
      issues.push(issue('data_type_invalid', `${path}.dataType`, 'Output dataType is not supported.'));
    }
    if (slot.cardinality !== 'one' && slot.cardinality !== 'many') {
      issues.push(issue('cardinality_invalid', `${path}.cardinality`, 'Output cardinality must be one or many.'));
    }
    validateEnumArray(slot.projectionBlockTypes, capabilityProjectionBlockTypes, `${path}.projectionBlockTypes`, issues, true);
    if (slot.artifactType !== undefined) requireString(slot.artifactType, `${path}.artifactType`, issues);
    if (slot.schemaRef !== undefined) requireString(slot.schemaRef, `${path}.schemaRef`, issues);
  });
}

function validateInputBindings(
  input: unknown,
  definition: CapabilityDefinition,
  issues: ContractValidationIssue[],
): void {
  if (!Array.isArray(input)) {
    issues.push(issue('input_bindings_invalid', '$.inputBindings', 'inputBindings must be an array.'));
    return;
  }
  const slotById = new Map(definition.inputSlots.map((slot) => [slot.slotId, slot]));
  const boundSlotIds = new Set<string>();
  input.forEach((binding, index) => {
    const path = `$.inputBindings[${index}]`;
    if (!isRecord(binding) || !isNonEmptyString(binding.slotId) || !Array.isArray(binding.values)) {
      issues.push(issue('input_binding_invalid', path, 'Binding requires slotId and values.'));
      return;
    }
    const slot = slotById.get(binding.slotId);
    if (!slot) {
      issues.push(issue('input_slot_unknown', `${path}.slotId`, `Unknown input slot ${binding.slotId}.`));
      return;
    }
    if (boundSlotIds.has(binding.slotId)) {
      issues.push(issue('input_slot_duplicate', `${path}.slotId`, `Input slot ${binding.slotId} is bound more than once.`));
      return;
    }
    boundSlotIds.add(binding.slotId);
    validateBindingCardinality(binding.values.length, slot, path, issues);
    binding.values.forEach((value, valueIndex) => validateBindingValue(value, slot, `${path}.values[${valueIndex}]`, issues));
  });
  for (const slot of definition.inputSlots) {
    if (slot.required && !boundSlotIds.has(slot.slotId)) {
      issues.push(issue('required_input_missing', '$.inputBindings', `Required input slot ${slot.slotId} is missing.`));
    }
  }
}

function validateBindingValue(
  input: unknown,
  slot: CapabilityInputSlotDefinition,
  path: string,
  issues: ContractValidationIssue[],
): void {
  if (!isRecord(input) || !capabilityBindingKinds.has(input.kind as CapabilityBindingKind)) {
    issues.push(issue('binding_value_invalid', path, 'Binding value kind is not supported.'));
    return;
  }
  if (!slot.bindingKinds.includes(input.kind as CapabilityBindingKind)) {
    issues.push(issue('binding_kind_not_allowed', `${path}.kind`, `Binding kind ${String(input.kind)} is not allowed.`));
  }
  if (input.kind === 'inline' && !Object.hasOwn(input, 'value')) requireBindingField(path, 'value', issues);
  if (input.kind === 'block' && !isNonEmptyString(input.blockId)) requireBindingField(path, 'blockId', issues);
  if (input.kind === 'asset' && !isNonEmptyString(input.assetId)) requireBindingField(path, 'assetId', issues);
  if (input.kind === 'artifact_revision' && !isNonEmptyString(input.artifactRevisionId)) {
    requireBindingField(path, 'artifactRevisionId', issues);
  }
}

function validateBindingCardinality(
  count: number,
  slot: CapabilityInputSlotDefinition,
  path: string,
  issues: ContractValidationIssue[],
): void {
  if (slot.cardinality === 'one' && count !== 1) {
    issues.push(issue('binding_cardinality_invalid', path, `Input slot ${slot.slotId} requires exactly one value.`));
  } else if (slot.cardinality === 'optional' && count > 1) {
    issues.push(issue('binding_cardinality_invalid', path, `Input slot ${slot.slotId} accepts at most one value.`));
  } else if (slot.cardinality === 'many' && slot.required && count === 0) {
    issues.push(issue('binding_cardinality_invalid', path, `Input slot ${slot.slotId} requires at least one value.`));
  }
}

function validateCapabilityLock(
  input: unknown,
  definition: CapabilityDefinition,
  issues: ContractValidationIssue[],
): void {
  if (!isRecord(input)) {
    issues.push(issue('capability_lock_invalid', '$.capabilityLock', 'capabilityLock must be an object.'));
    return;
  }
  if (input.capabilityId !== definition.capabilityId) {
    issues.push(issue('capability_lock_mismatch', '$.capabilityLock.capabilityId', 'Capability id does not match Definition.'));
  }
  if (input.version !== definition.version || input.definitionHash !== definition.definitionHash) {
    issues.push(issue('capability_lock_mismatch', '$.capabilityLock', 'Capability version lock does not match Definition.'));
  }
}

function validateSkillLock(input: unknown, issues: ContractValidationIssue[]): void {
  if (input === undefined || input === null) return;
  if (!isRecord(input)) {
    issues.push(issue('skill_lock_invalid', '$.skillLock', 'skillLock must be an object or null.'));
    return;
  }
  requireString(input.skillId, '$.skillLock.skillId', issues);
  requireVersion(input.version, '$.skillLock.version', issues);
  requireDefinitionHash(input.definitionHash, '$.skillLock.definitionHash', issues);
}

function validateTrigger(input: unknown, issues: ContractValidationIssue[]): void {
  if (!isRecord(input) || !capabilityExecutionTriggerKinds.has(input.kind as CapabilityExecutionTriggerKind)) {
    issues.push(issue('trigger_invalid', '$.trigger.kind', 'trigger.kind is not supported.'));
    return;
  }
  validateOptionalString(input.sourceBlockId, '$.trigger.sourceBlockId', issues);
  validateOptionalString(input.workflowRunId, '$.trigger.workflowRunId', issues);
  validateOptionalString(input.stepRunId, '$.trigger.stepRunId', issues);
  validateOptionalString(input.agentRunId, '$.trigger.agentRunId', issues);
}

function validateScope(input: unknown, issues: ContractValidationIssue[]): void {
  if (!isRecord(input)) {
    issues.push(issue('scope_invalid', '$.scope', 'scope must be an object.'));
    return;
  }
  requireString(input.workspaceId, '$.scope.workspaceId', issues);
  requireString(input.projectId, '$.scope.projectId', issues);
  if (input.boardId !== undefined && input.boardId !== null) requireString(input.boardId, '$.scope.boardId', issues);
}

function validateActor(input: unknown, issues: ContractValidationIssue[]): void {
  if (!isRecord(input)) {
    issues.push(issue('actor_invalid', '$.actor', 'actor must be an object.'));
    return;
  }
  if (!['user', 'agent', 'worker', 'system'].includes(String(input.actorType))) {
    issues.push(issue('actor_type_invalid', '$.actor.actorType', 'actorType is not supported.'));
  }
  requireString(input.actorId, '$.actor.actorId', issues);
  if (input.agentRunId !== undefined && input.agentRunId !== null) {
    requireString(input.agentRunId, '$.actor.agentRunId', issues);
  }
}

function validateResultProjection(input: unknown, issues: ContractValidationIssue[]): void {
  if (!isRecord(input) || !['none', 'target', 'target_and_siblings'].includes(String(input.mode))) {
    issues.push(issue('result_projection_invalid', '$.resultProjection', 'resultProjection.mode is not supported.'));
    return;
  }
  if (input.mode !== 'none' && !isNonEmptyString(input.targetBlockId)) {
    issues.push(issue('result_target_missing', '$.resultProjection.targetBlockId', 'A target block is required.'));
  }
}

function validateInputProfile(
  input: unknown,
  index: number,
  profileIds: Set<string>,
  issues: ContractValidationIssue[],
): void {
  const path = `$.inputProfiles[${index}]`;
  if (!isRecord(input) || !isNonEmptyString(input.profileId)) {
    issues.push(issue('input_profile_invalid', path, 'Input profile requires profileId.'));
    return;
  }
  if (profileIds.has(input.profileId)) issues.push(issue('input_profile_duplicate', `${path}.profileId`, 'profileId must be unique.'));
  profileIds.add(input.profileId);
  requireStringArray(input.requiredSlots, `${path}.requiredSlots`, issues);
  requireStringArray(input.optionalSlots, `${path}.optionalSlots`, issues);
}

function validateProviderCliBinding(input: unknown, issues: ContractValidationIssue[]): void {
  if (!isRecord(input)) {
    issues.push(issue('provider_cli_binding_missing', '$.executionBinding', 'provider_cli requires an executionBinding.'));
    return;
  }
  requireString(input.pluginId, '$.executionBinding.pluginId', issues);
  requireString(input.executableRef, '$.executionBinding.executableRef', issues);
  requireLiteral(input.transport, 'stdio_json', '$.executionBinding.transport', issues);
}

function validateSlotId(
  input: unknown,
  path: string,
  slotIds: Set<string>,
  issues: ContractValidationIssue[],
): void {
  if (!isNonEmptyString(input)) {
    issues.push(issue('slot_id_invalid', `${path}.slotId`, 'slotId is required.'));
  } else if (slotIds.has(input)) {
    issues.push(issue('slot_id_duplicate', `${path}.slotId`, `slotId ${input} must be unique.`));
  } else {
    slotIds.add(input);
  }
}

function validateEnumArray<T extends string>(
  input: unknown,
  allowed: Set<T>,
  path: string,
  issues: ContractValidationIssue[],
  requireValue = false,
): void {
  if (!Array.isArray(input) || (requireValue && input.length === 0)) {
    issues.push(issue('enum_array_invalid', path, 'Expected a non-empty array.'));
    return;
  }
  input.forEach((value, index) => {
    if (!allowed.has(value as T)) issues.push(issue('enum_value_invalid', `${path}[${index}]`, `Unsupported value ${String(value)}.`));
  });
}

function requireStringArray(
  input: unknown,
  path: string,
  issues: ContractValidationIssue[],
  requireValue = false,
): void {
  if (!Array.isArray(input) || (requireValue && input.length === 0) || input.some((value) => !isNonEmptyString(value))) {
    issues.push(issue('string_array_invalid', path, requireValue ? 'Expected a non-empty string array.' : 'Expected a string array.'));
  }
}

function requireString(input: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isNonEmptyString(input)) issues.push(issue('string_required', path, 'A non-empty string is required.'));
}

function validateOptionalString(input: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (input !== undefined && input !== null) requireString(input, path, issues);
}

function requireIsoTimestamp(input: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isNonEmptyString(input) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input)) {
    issues.push(issue('timestamp_invalid', path, 'Expected an ISO 8601 UTC timestamp.'));
  }
}

function requireVersion(input: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isNonEmptyString(input) || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input)) {
    issues.push(issue('version_invalid', path, 'Expected a semantic version.'));
  }
}

function requireDefinitionHash(input: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isNonEmptyString(input) || (!input.startsWith('sha256:') && !input.startsWith('legacy:'))) {
    issues.push(issue('definition_hash_invalid', path, 'definitionHash must use sha256: or legacy:.'));
  }
}

function requireLiteral(
  input: unknown,
  expected: string | number,
  path: string,
  issues: ContractValidationIssue[],
): void {
  if (input !== expected) issues.push(issue('literal_invalid', path, `Expected ${String(expected)}.`));
}

function requireBindingField(path: string, field: string, issues: ContractValidationIssue[]): void {
  issues.push(issue('binding_field_missing', `${path}.${field}`, `${field} is required for this binding kind.`));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input);
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function issue(code: string, path: string, message: string): ContractValidationIssue {
  return { code, path, message };
}

function formatValidationIssues(prefix: string, issues: ContractValidationIssue[]): string {
  return `${prefix}: ${issues.map((entry) => `${entry.path} ${entry.message}`).join('; ')}`;
}
