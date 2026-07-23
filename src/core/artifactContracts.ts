import type { CapabilityDefinitionLock, SkillDefinitionLock } from './capabilityContracts';
import type { AssetRecord } from './types';
import type { WorkflowDefinitionLock } from './workflowRuntimeContracts';

export type ArtifactScope = 'project' | 'workflow_run' | 'step_run';

export type ArtifactLibraryVisibility = 'hidden' | 'listed';

export type ArtifactActorType = 'agent' | 'system' | 'user';

export interface ArtifactActorRef {
  actorId: string;
  actorType: ArtifactActorType;
  agentRunId?: string;
}

export interface ArtifactSourceContext {
  boardId?: string;
  operationBlockId?: string;
  outputSlotId?: string;
  stepRunId?: string;
  workflowOutputSlotId?: string;
  workflowRunId?: string;
}

export interface ArtifactDefinitionLocks {
  capability?: CapabilityDefinitionLock;
  skill?: SkillDefinitionLock;
  workflow?: WorkflowDefinitionLock;
}

export interface ArtifactRecord {
  artifactId: string;
  artifactType: string;
  createdAt: string;
  currentRevisionId: string;
  libraryVisibility: ArtifactLibraryVisibility;
  projectId: string;
  recordVersion: number;
  scope: ArtifactScope;
  semanticKey: string;
  sourceContext?: ArtifactSourceContext;
  updatedAt: string;
}

export interface ArtifactRevision {
  artifactId: string;
  artifactRevisionId: string;
  assetIds: string[];
  createdAt: string;
  createdByActor: ArtifactActorRef;
  createdByExecutionId?: string;
  definitionLocks?: ArtifactDefinitionLocks;
  primaryAssetId: string;
  projectId: string;
  revision: number;
  sourceArtifactRevisionIds: string[];
  sourceAssetIds: string[];
  sourceContext?: ArtifactSourceContext;
}

export interface ProjectArtifactSnapshot {
  artifacts: ArtifactRecord[];
  projectId: string;
  revisions: ArtifactRevision[];
  schemaVersion: 1;
}

export interface ProjectArtifactLibraryItem {
  artifact: ArtifactRecord;
  currentRevision: ArtifactRevision;
  primaryAsset: AssetRecord;
  revisions: ArtifactRevision[];
}

export interface ProjectArtifactLibrarySnapshot {
  items: ProjectArtifactLibraryItem[];
  projectId: string;
  schemaVersion: 1;
}

export interface PromoteProjectAssetCommand {
  artifactType: string;
  assetId: string;
  boardId: string;
  blockId: string;
  expectedCurrentRevisionId: string | null;
  idempotencyKey: string;
  projectId: string;
  semanticKey: string;
  sourceArtifactRevisionId?: string;
}

export interface CreateOrAdvanceArtifactCommand {
  artifactType: string;
  assetIds: string[];
  createdByActor: ArtifactActorRef;
  createdByExecutionId?: string;
  definitionLocks?: ArtifactDefinitionLocks;
  expectedCurrentRevisionId: string | null;
  idempotencyKey: string;
  libraryVisibility: ArtifactLibraryVisibility;
  primaryAssetId: string;
  projectId: string;
  schemaVersion: 1;
  scope: ArtifactScope;
  semanticKey: string;
  sourceArtifactRevisionIds: string[];
  sourceAssetIds: string[];
  sourceContext?: ArtifactSourceContext;
}

export interface CreateOrAdvanceArtifactResult {
  artifact: ArtifactRecord;
  created: boolean;
  revision: ArtifactRevision;
}

export interface ArtifactStorePort {
  createOrAdvance(command: CreateOrAdvanceArtifactCommand): Promise<CreateOrAdvanceArtifactResult>;
  getRevision(projectId: string, artifactRevisionId: string): Promise<ArtifactRevision | undefined>;
  readProject(projectId: string): Promise<ProjectArtifactSnapshot>;
}

export function artifactOwnerKey(input: Pick<CreateOrAdvanceArtifactCommand, 'scope' | 'sourceContext'>): string {
  if (input.scope === 'project') return 'project';
  if (input.scope === 'workflow_run') {
    return `workflow_run:${requiredContextId(input.sourceContext?.workflowRunId, 'workflowRunId')}`;
  }
  return `step_run:${requiredContextId(input.sourceContext?.stepRunId, 'stepRunId')}`;
}

export function artifactIdentityKey(
  input: Pick<CreateOrAdvanceArtifactCommand, 'scope' | 'semanticKey' | 'sourceContext'>,
): string {
  return `${input.scope}:${artifactOwnerKey(input)}:${input.semanticKey}`;
}

export function assertValidCreateOrAdvanceArtifactCommand(
  command: CreateOrAdvanceArtifactCommand,
): void {
  if (command.schemaVersion !== 1) throw new Error('Artifact command schemaVersion must be 1.');
  requireText(command.projectId, 'projectId');
  requireText(command.semanticKey, 'semanticKey');
  requireText(command.artifactType, 'artifactType');
  requireText(command.primaryAssetId, 'primaryAssetId');
  requireText(command.idempotencyKey, 'idempotencyKey');
  if (command.expectedCurrentRevisionId !== null) {
    requireText(command.expectedCurrentRevisionId, 'expectedCurrentRevisionId');
  }
  if (command.createdByExecutionId !== undefined) {
    requireText(command.createdByExecutionId, 'createdByExecutionId');
  }
  if (!['project', 'workflow_run', 'step_run'].includes(command.scope)) {
    throw new Error(`Unsupported Artifact scope: ${String(command.scope)}`);
  }
  if (!['hidden', 'listed'].includes(command.libraryVisibility)) {
    throw new Error(`Unsupported Artifact library visibility: ${String(command.libraryVisibility)}`);
  }
  if (command.scope !== 'project' && command.libraryVisibility !== 'hidden') {
    throw new Error('Only Project-scope Artifacts can be listed in the Project Asset Library.');
  }
  requireUniqueTextArray(command.assetIds, 'assetIds', true);
  requireUniqueTextArray(command.sourceAssetIds, 'sourceAssetIds');
  requireUniqueTextArray(command.sourceArtifactRevisionIds, 'sourceArtifactRevisionIds');
  if (!command.assetIds.includes(command.primaryAssetId)) {
    throw new Error('Artifact primaryAssetId must be included in assetIds.');
  }
  requireText(command.createdByActor.actorId, 'createdByActor.actorId');
  if (!['agent', 'system', 'user'].includes(command.createdByActor.actorType)) {
    throw new Error(`Unsupported Artifact actor type: ${String(command.createdByActor.actorType)}`);
  }
  if (command.createdByActor.actorType === 'agent') {
    requireText(command.createdByActor.agentRunId, 'createdByActor.agentRunId');
  } else if (command.createdByActor.agentRunId !== undefined) {
    throw new Error('Only an agent actor can include agentRunId.');
  }
  validateDefinitionLocks(command.definitionLocks);
  validateSourceContext(command.scope, command.sourceContext);
  artifactOwnerKey(command);
}

function validateDefinitionLocks(locks?: ArtifactDefinitionLocks): void {
  if (!locks) return;
  if (locks.capability) {
    requireText(locks.capability.capabilityId, 'definitionLocks.capability.capabilityId');
    requireText(locks.capability.version, 'definitionLocks.capability.version');
    requireText(locks.capability.definitionHash, 'definitionLocks.capability.definitionHash');
  }
  if (locks.skill) {
    requireText(locks.skill.skillId, 'definitionLocks.skill.skillId');
    requireText(locks.skill.version, 'definitionLocks.skill.version');
    requireText(locks.skill.definitionHash, 'definitionLocks.skill.definitionHash');
  }
  if (locks.workflow) {
    requireText(locks.workflow.workflowId, 'definitionLocks.workflow.workflowId');
    requireText(locks.workflow.version, 'definitionLocks.workflow.version');
    requireText(locks.workflow.definitionHash, 'definitionLocks.workflow.definitionHash');
  }
}

function validateSourceContext(scope: ArtifactScope, context?: ArtifactSourceContext): void {
  if (!context) {
    if (scope !== 'project') throw new Error(`${scope} Artifact scope requires sourceContext.`);
    return;
  }
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) requireText(value, `sourceContext.${key}`);
  }
  if (scope === 'workflow_run') requireText(context.workflowRunId, 'sourceContext.workflowRunId');
  if (scope === 'step_run') {
    requireText(context.workflowRunId, 'sourceContext.workflowRunId');
    requireText(context.stepRunId, 'sourceContext.stepRunId');
  }
}

function requireUniqueTextArray(input: string[], field: string, requireValue = false): void {
  if (!Array.isArray(input) || (requireValue && input.length === 0)) {
    throw new Error(`Artifact ${field} must be${requireValue ? ' a non-empty' : ' an'} array.`);
  }
  input.forEach((value, index) => requireText(value, `${field}[${index}]`));
  if (new Set(input).size !== input.length) throw new Error(`Artifact ${field} must not contain duplicates.`);
}

function requireText(input: unknown, field: string): asserts input is string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`Artifact ${field} must be a non-empty string.`);
  }
}

function requiredContextId(input: string | undefined, field: string): string {
  requireText(input, `sourceContext.${field}`);
  return input;
}
