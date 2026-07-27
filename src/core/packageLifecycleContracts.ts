import type { PluginRuntimeSnapshotV1 } from '@retake-tools/package-sdk';
import type {
  InstalledRuntimeRegistrySnapshotV1,
} from './installedRuntimeRegistry';

export type PackageLifecycleSourceKindV1 =
  | 'git'
  | 'local_archive'
  | 'local_directory'
  | 'remote_registry';

export interface PackageLifecycleHistoryEntryV1 {
  digest: string;
  installationId: string;
  installedAt: string;
  sourceKind: PackageLifecycleSourceKindV1;
  version: string;
}

export interface PackageLifecycleRecordV1 {
  componentCounts: {
    agentPresets: number;
    pluginModules: number;
    skills: number;
    workflows: number;
  };
  dependencies: Array<{
    optional: boolean;
    packageId: string;
    range: string;
  }>;
  description: string;
  digest: string;
  history: PackageLifecycleHistoryEntryV1[];
  installationId: string;
  isRoot: boolean;
  name: string;
  packageId: string;
  source: {
    canUpdate: boolean;
    kind: PackageLifecycleSourceKindV1;
    label: string;
  };
  version: string;
}

export interface PackageLifecycleSnapshotV1 {
  lockRevision: number;
  packages: PackageLifecycleRecordV1[];
  pluginRuntime: PluginRuntimeSnapshotV1;
  runtimeRegistry: InstalledRuntimeRegistrySnapshotV1;
  schemaVersion: 1;
  updatedAt: string;
}

export type PackageLifecycleMutationV1 =
  | {
    action: 'install';
    source: string;
  }
  | {
    action: 'remove';
    packageId: string;
  }
  | {
    action: 'rollback';
    packageId: string;
    target?: string;
  }
  | {
    action: 'update';
    packageId: string;
  };
