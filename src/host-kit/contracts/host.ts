import type { PluginHostExperienceProfileV1 } from '@retake-tools/package-sdk';
import type { BoardSnapshot } from '../../core/types';
import type { CanvasHostCommandsV1 } from './commands';
import type { HostConnectionAdapterV1 } from './connection';
import type { DeepReadonly } from './readonly';
import type { HostPackageRuntimeAdapterV1 } from './runtime';
import type { HostPackageRuntimeReadModelV1 } from './runtime';
import type {
  CanvasHostScopeV1,
  HostBoardRevisionV1,
  HostStorageAdapterV1,
} from './storage';

export const canvasHostApiVersionV1 = 1 as const;
export const canvasHostDomainSchemaVersionV1 = 1 as const;

export interface HostEnvironmentV1 {
  readonly colorScheme: 'dark' | 'light';
  readonly contrast: 'high' | 'normal';
  readonly direction: 'ltr' | 'rtl';
  readonly locale: string;
  readonly reducedMotion: boolean;
  readonly themeId: string;
}

export interface CanvasHostReadModelV1 {
  getRevision(): HostBoardRevisionV1;
  getSnapshot(): DeepReadonly<BoardSnapshot>;
  subscribe(listener: (snapshot: DeepReadonly<BoardSnapshot>) => void): () => void;
}

export interface CreateCanvasHostInputV1 {
  readonly connections: HostConnectionAdapterV1;
  readonly environment: HostEnvironmentV1;
  readonly experience: PluginHostExperienceProfileV1;
  readonly initialScope: CanvasHostScopeV1;
  readonly packageRuntime: HostPackageRuntimeAdapterV1;
  readonly storage: HostStorageAdapterV1;
}

export interface CanvasHostV1 {
  readonly apiVersion: typeof canvasHostApiVersionV1;
  readonly commands: CanvasHostCommandsV1;
  readonly connections: HostConnectionAdapterV1;
  readonly domainSchemaVersion: typeof canvasHostDomainSchemaVersionV1;
  readonly environment: HostEnvironmentV1;
  readonly experience: PluginHostExperienceProfileV1;
  readonly readModel: CanvasHostReadModelV1;
  readonly runtime: HostPackageRuntimeReadModelV1;
  dispose(): Promise<void>;
  setScope(scope: CanvasHostScopeV1): Promise<void>;
}
