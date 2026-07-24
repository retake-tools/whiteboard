import type {
  ProviderCallRecord,
  ProviderCallStatus,
} from '../../src/core/domainVideoGenerationContracts';
import { touchSnapshot } from './context';
import { loadSnapshot, saveSnapshot } from './snapshot-store';

interface ProviderCallPatch {
  completedAt?: string;
  error?: string;
  outputAssetIds?: string[];
  providerTaskId?: string;
  status: ProviderCallStatus;
  usage?: Record<string, unknown>;
}

export async function updateProviderCall(input: {
  boardId: string;
  callIndex: number;
  executionId: string;
  patch: ProviderCallPatch;
  projectId: string;
}): Promise<ProviderCallRecord | undefined> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = snapshot.executions.find(
    (candidate) => candidate.executionId === input.executionId,
  );
  const call = execution?.providerCalls?.find(
    (candidate) => candidate.callIndex === input.callIndex,
  );
  if (!execution?.domainVideoRequestSnapshot || !call) return undefined;
  call.status = input.patch.status;
  if (input.patch.providerTaskId !== undefined) call.providerTaskId = input.patch.providerTaskId;
  if (input.patch.outputAssetIds !== undefined) call.outputAssetIds = [...input.patch.outputAssetIds];
  if (input.patch.usage !== undefined) call.usage = structuredClone(input.patch.usage);
  if (input.patch.error !== undefined) call.error = input.patch.error;
  else delete call.error;
  if (input.patch.completedAt !== undefined) call.completedAt = input.patch.completedAt;
  else if (!['succeeded', 'failed', 'canceled'].includes(input.patch.status)) delete call.completedAt;
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return structuredClone(call);
}

export async function finishUnresolvedProviderCalls(input: {
  boardId: string;
  error?: string;
  executionId: string;
  projectId: string;
  status: Extract<ProviderCallStatus, 'failed' | 'canceled'>;
}): Promise<void> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = snapshot.executions.find(
    (candidate) => candidate.executionId === input.executionId,
  );
  if (!execution?.providerCalls) return;
  const completedAt = new Date().toISOString();
  let changed = false;
  for (const call of execution.providerCalls) {
    if (['succeeded', 'failed', 'canceled'].includes(call.status)) continue;
    call.status = input.status;
    call.completedAt = completedAt;
    if (input.error) call.error = input.error;
    changed = true;
  }
  if (!changed) return;
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
}
