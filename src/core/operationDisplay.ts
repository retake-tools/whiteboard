import type { BlockData, ExecutionStatus, OperationReadinessIssue } from './types';

export type OperationExecutionBadgeKey =
  | 'operationStatus.canceled'
  | 'operationStatus.failed'
  | 'operationStatus.succeeded'
  | 'status.queued'
  | 'status.running';

export interface OperationDisplayState {
  executionBadge?: {
    historical: boolean;
    labelKey: OperationExecutionBadgeKey;
    status: ExecutionStatus;
  };
  inputState: 'input_required' | 'ready';
  isQueued: boolean;
  isRunning: boolean;
  readinessIssue?: OperationReadinessIssue;
  runDisabled: boolean;
  showReadinessIssue: boolean;
}

export function operationDisplayState(data: BlockData): OperationDisplayState {
  const isQueued = data.status === 'queued';
  const isRunning = data.status === 'running';
  const readinessIssue = data.operationReadinessIssues?.[0];
  const inputState = data.operationCanRun === false ? 'input_required' : 'ready';
  const hasUnexecutedChanges =
    data.operationQueuedConfigurationStale === true ||
    (data.operationChangeCount ?? 0) > 0;

  return {
    executionBadge: data.statusVisualDismissed
      ? undefined
      : executionBadgeFor(data.status, hasUnexecutedChanges),
    inputState,
    isQueued,
    isRunning,
    readinessIssue,
    runDisabled:
      isRunning ||
      data.groupContentLocked === true ||
      (!isQueued && inputState === 'input_required'),
    showReadinessIssue: Boolean(readinessIssue && !isQueued && !isRunning),
  };
}

function executionBadgeFor(
  status?: ExecutionStatus,
  hasUnexecutedChanges = false,
): OperationDisplayState['executionBadge'] {
  if (status === 'queued' || status === 'running') {
    return { historical: false, labelKey: `status.${status}`, status };
  }
  if (hasUnexecutedChanges) return undefined;
  if (status === 'succeeded') {
    return { historical: true, labelKey: 'operationStatus.succeeded', status };
  }
  if (status === 'failed') {
    return { historical: true, labelKey: 'operationStatus.failed', status };
  }
  if (status === 'canceled') {
    return { historical: true, labelKey: 'operationStatus.canceled', status };
  }
  return undefined;
}
