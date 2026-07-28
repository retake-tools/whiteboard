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

export interface PackageUpdateCandidateV1 {
  archiveDigest: string | null;
  commit: string | null;
  digest: string;
  notices: Array<{
    advisoryId?: string;
    kind: 'deprecated' | 'security_advisory';
    message: string;
  }>;
  version: string;
}

export interface PackageUpdateCheckV1 {
  candidate: PackageUpdateCandidateV1 | null;
  currentDigest: string;
  currentVersion: string;
  detail: string | null;
  packageId: string;
  sourceKind: PackageLifecycleSourceKindV1;
  status: 'available' | 'current' | 'error' | 'pinned' | 'unsupported';
}

export interface PackageUpdateSnapshotV1 {
  checkedAt: string;
  checks: PackageUpdateCheckV1[];
  schemaVersion: 1;
}

export interface PackageDevelopmentLinkV1 {
  candidate: {
    identity: PackageDevelopmentLinkV1['identity'];
    lastGood: PackageDevelopmentLinkV1['lastGood'];
  } | null;
  error: string | null;
  identity: {
    packageId: string;
    pluginModules: Array<{
      permissions: string[];
      pluginModuleId: string;
    }>;
  };
  lastGood: {
    buildDurationMs: number;
    builtAt: string;
    digest: string;
    installationId: string;
    outputDigest: string;
    sourceDigest: string;
  };
  linkId: string;
  sourceLabel: string;
  status: 'failed' | 'idle' | 'needs_confirmation' | 'ready';
  trustedAt: string;
  updatedAt: string;
  watching: boolean;
}

export interface PackageDevelopmentSnapshotV1 {
  links: PackageDevelopmentLinkV1[];
  revision: number;
  schemaVersion: 1;
  updatedAt: string;
}

export type PackageDevelopmentMutationV1 =
  | {
    action: 'link';
    confirmTrust: true;
    sourceRoot: string;
  }
  | {
    action: 'confirm_identity' | 'rebuild' | 'unwatch' | 'watch';
    linkId: string;
  }
  | {
    action: 'accept_candidate' | 'reject_candidate';
    digest: string;
    error?: string;
    linkId: string;
  }
  | {
    action: 'unlink';
    disposition: 'remove' | 'retain';
    linkId: string;
  };

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
