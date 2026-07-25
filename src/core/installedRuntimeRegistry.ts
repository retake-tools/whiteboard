import type { AgentPresetDefinition } from './agentPresetContracts';
import {
  configureAgentPresetRegistry,
  listAgentPresets,
} from './agentPresetRegistry';
import type { RetakePackageManifest } from './packageContracts';
import {
  configurePackageRegistry,
  listPackages,
} from './packageRegistry';
import {
  configureSkillRegistry,
  listSkills,
  type RetakeSkillDefinition,
} from './skillRegistry';
import {
  configureWorkflowRegistry,
  listWorkflows,
  type WorkflowDefinition,
} from './workflowRegistry';
import { sha256Hex } from './sha256';

export interface InstalledRuntimeRegistrySnapshotV1 {
  agentPresets: AgentPresetDefinition[];
  lockRevision: number;
  packages: RetakePackageManifest[];
  profileId: string;
  schemaVersion: 1;
  skills: RetakeSkillDefinition[];
  snapshotDigest: string;
  workflows: WorkflowDefinition[];
}

export function configureInstalledRuntimeRegistry(
  input: unknown,
): InstalledRuntimeRegistrySnapshotV1 {
  const snapshot = parseInstalledRuntimeRegistrySnapshot(input);
  const previous = currentRuntimeRegistrySnapshot('retake.runtime.previous', -1);
  try {
    configureSkillRegistry(snapshot.skills);
    configureWorkflowRegistry(snapshot.workflows);
    configureAgentPresetRegistry(snapshot.agentPresets);
    configurePackageRegistry(snapshot.packages);
    assertExactComponentOwnership(snapshot);
  } catch (error) {
    restoreRuntimeRegistry(previous);
    throw error;
  }
  return structuredClone(snapshot);
}

export function currentRuntimeRegistrySnapshot(
  profileId: string,
  lockRevision: number,
): InstalledRuntimeRegistrySnapshotV1 {
  return withSnapshotDigest({
    agentPresets: listAgentPresets(),
    lockRevision,
    packages: listPackages(),
    profileId,
    schemaVersion: 1,
    skills: listSkills(),
    workflows: listWorkflows(),
  });
}

export function withSnapshotDigest(
  input: Omit<InstalledRuntimeRegistrySnapshotV1, 'snapshotDigest'>,
): InstalledRuntimeRegistrySnapshotV1 {
  const payload = structuredClone(input);
  return {
    ...payload,
    snapshotDigest: `sha256:${sha256Hex(stableStringify(payload))}`,
  };
}

function parseInstalledRuntimeRegistrySnapshot(
  input: unknown,
): InstalledRuntimeRegistrySnapshotV1 {
  if (!isRecord(input)) throw new Error('Installed Runtime Registry snapshot must be an object.');
  assertExactKeys(input, [
    'agentPresets',
    'lockRevision',
    'packages',
    'profileId',
    'schemaVersion',
    'skills',
    'snapshotDigest',
    'workflows',
  ]);
  if (input.schemaVersion !== 1) {
    throw new Error('Installed Runtime Registry snapshot schemaVersion is unsupported.');
  }
  if (typeof input.profileId !== 'string' || input.profileId.length === 0) {
    throw new Error('Installed Runtime Registry snapshot profileId is invalid.');
  }
  if (!Number.isInteger(input.lockRevision) || (input.lockRevision as number) < 0) {
    throw new Error('Installed Runtime Registry snapshot lockRevision is invalid.');
  }
  if (
    typeof input.snapshotDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(input.snapshotDigest)
  ) throw new Error('Installed Runtime Registry snapshot digest is invalid.');
  if (
    !Array.isArray(input.packages)
    || !Array.isArray(input.skills)
    || !Array.isArray(input.workflows)
    || !Array.isArray(input.agentPresets)
  ) throw new Error('Installed Runtime Registry snapshot collections are invalid.');
  const rawPayload = {
    agentPresets: input.agentPresets,
    lockRevision: input.lockRevision,
    packages: input.packages,
    profileId: input.profileId,
    schemaVersion: input.schemaVersion,
    skills: input.skills,
    workflows: input.workflows,
  };
  const expectedDigest = `sha256:${sha256Hex(stableStringify(rawPayload))}`;
  if (input.snapshotDigest !== expectedDigest) {
    throw new Error('Installed Runtime Registry snapshot digest mismatch.');
  }
  const packages = structuredClone(input.packages) as RetakePackageManifest[];
  for (const manifest of packages) {
    if (
      !manifest
      || manifest.source?.kind !== 'installed'
      || !/^sha256:[a-f0-9]{64}$/.test(manifest.digest)
      || !/^sha256:[a-f0-9]{64}$/.test(manifest.source.archiveDigest)
      || !manifest.source.installationId
    ) throw new Error(`Runtime Package is not backed by an exact Installation: ${manifest?.packageId ?? 'unknown'}`);
  }
  const snapshot: InstalledRuntimeRegistrySnapshotV1 = {
    agentPresets: cloneObjectArray(input.agentPresets, 'AgentPreset') as AgentPresetDefinition[],
    lockRevision: input.lockRevision as number,
    packages,
    profileId: input.profileId,
    schemaVersion: 1,
    skills: cloneObjectArray(input.skills, 'Skill') as RetakeSkillDefinition[],
    snapshotDigest: input.snapshotDigest,
    workflows: cloneObjectArray(input.workflows, 'Workflow') as WorkflowDefinition[],
  };
  return snapshot;
}

function cloneObjectArray(
  values: unknown[],
  label: string,
): unknown[] {
  return values.map((value, index) => {
    if (!isRecord(value)) throw new Error(`${label}[${index}] must be an object.`);
    return structuredClone(value);
  });
}

function assertExactComponentOwnership(
  snapshot: InstalledRuntimeRegistrySnapshotV1,
): void {
  assertSameIds(
    snapshot.skills.map((definition) => definition.skillId),
    snapshot.packages.flatMap((manifest) => (
      manifest.components.skills.map((lock) => lock.skillId)
    )),
    'Skill',
  );
  assertSameIds(
    snapshot.workflows.map((definition) => definition.workflowId),
    snapshot.packages.flatMap((manifest) => (
      manifest.components.workflows.map((lock) => lock.workflowDefinitionId)
    )),
    'Workflow',
  );
  assertSameIds(
    snapshot.agentPresets.map((definition) => definition.agentPresetId),
    snapshot.packages.flatMap((manifest) => (
      manifest.components.agentPresets.map((lock) => lock.agentPresetId)
    )),
    'AgentPreset',
  );
}

function assertSameIds(
  definitions: string[],
  locks: string[],
  label: string,
): void {
  const definitionIds = [...definitions].sort(compareText);
  const lockIds = [...locks].sort(compareText);
  if (
    definitionIds.length !== lockIds.length
    || definitionIds.some((id, index) => id !== lockIds[index])
  ) throw new Error(`Installed Runtime Registry ${label} ownership is incomplete.`);
}

function restoreRuntimeRegistry(
  previous: InstalledRuntimeRegistrySnapshotV1,
): void {
  configureSkillRegistry(previous.skills);
  configureWorkflowRegistry(previous.workflows);
  configureAgentPresetRegistry(previous.agentPresets);
  configurePackageRegistry(previous.packages);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): void {
  const actual = Object.keys(value).sort(compareText);
  const orderedExpected = [...expected].sort(compareText);
  if (
    actual.length !== orderedExpected.length
    || actual.some((key, index) => key !== orderedExpected[index])
  ) throw new Error('Installed Runtime Registry snapshot has unsupported or missing fields.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
