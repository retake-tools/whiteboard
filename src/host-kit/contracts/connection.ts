import type {
  CapabilityAdapterExecutionResult,
  CapabilityAdapterProgress,
  CapabilityExecutionRequest,
} from '../../core/capabilityContracts';
import type { ExecutionConnectionSummary } from '../../core/executionProviders';
import type { DeepReadonly } from './readonly';

export interface HostConnectionExecutionInputV1 {
  readonly connectionId: string;
  readonly onProgress?: (progress: CapabilityAdapterProgress) => void;
  readonly request: DeepReadonly<CapabilityExecutionRequest>;
  readonly signal?: AbortSignal;
}

export interface HostConnectionAdapterV1 {
  readonly adapterVersion: 1;
  cancel(executionId: string): Promise<void>;
  execute(input: HostConnectionExecutionInputV1): Promise<CapabilityAdapterExecutionResult>;
  list(input: {
    readonly capabilityId?: string;
    readonly projectId: string;
  }): Promise<readonly ExecutionConnectionSummary[]>;
  resume?(executionId: string): Promise<CapabilityAdapterExecutionResult>;
}
