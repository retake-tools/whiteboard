import type {
  PluginHostExperienceProfileV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import type { CanvasHostScopeV1 } from './storage';
import type { DeepReadonly } from './readonly';

export interface HostPackageFailureV1 {
  readonly message: string;
  readonly packageId?: string;
}

export interface HostPackageRuntimeSnapshotV1 {
  readonly failures: readonly HostPackageFailureV1[];
  readonly pluginRuntime: PluginRuntimeSnapshotV1;
  readonly revision: string;
  readonly schemaVersion: 1;
}

export interface HostPackageRuntimeReadModelV1 {
  getSnapshot(): DeepReadonly<HostPackageRuntimeSnapshotV1>;
  subscribe(listener: (snapshot: DeepReadonly<HostPackageRuntimeSnapshotV1>) => void): () => void;
}

export interface HostRuntimeDemandV1 {
  readonly boardBound: boolean;
  readonly hasBlocks: boolean;
  readonly hasOperationBlocks: boolean;
  readonly managerOpen: boolean;
  readonly selectedBlockCount: number;
}

export interface HostPackageRuntimeAdapterV1 {
  readonly adapterVersion: 1;
  bootstrap(input: {
    readonly experience: PluginHostExperienceProfileV1;
    readonly scope: CanvasHostScopeV1;
  }): Promise<HostPackageRuntimeSnapshotV1>;
  dispose(): Promise<void>;
  setScope(input: {
    readonly demand: HostRuntimeDemandV1;
    readonly scope: CanvasHostScopeV1;
  }): Promise<HostPackageRuntimeSnapshotV1>;
  subscribe(listener: (snapshot: HostPackageRuntimeSnapshotV1) => void): () => void;
}
