import type { ExecutionRecord } from './types';

export function executionRecordVersion(execution: ExecutionRecord): number {
  return typeof execution.recordVersion === 'number' && execution.recordVersion >= 1
    ? execution.recordVersion
    : 1;
}

export function advanceExecutionRecordVersion(execution: ExecutionRecord): void {
  execution.recordVersion = executionRecordVersion(execution) + 1;
}
