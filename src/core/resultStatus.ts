import type { BlockData } from './types';

export type ManagedResultStatusMessageKey =
  | 'resultStatus.canceled'
  | 'resultStatus.codexQueued'
  | 'resultStatus.codexRunning'
  | 'resultStatus.directApiQueued'
  | 'resultStatus.directApiRunning'
  | 'resultStatus.failed'
  | 'resultStatus.queued'
  | 'resultStatus.running';

export function managedResultStatusMessageKey(data: BlockData): ManagedResultStatusMessageKey | undefined {
  const adapter = typeof data.executionAdapter === 'string'
    ? data.executionAdapter
    : typeof data.adapter === 'string'
      ? data.adapter
      : undefined;
  if (data.status === 'queued') {
    if (adapter === 'mcp_agent') return 'resultStatus.codexQueued';
    if (adapter === 'direct_api') return 'resultStatus.directApiQueued';
    return 'resultStatus.queued';
  }
  if (data.status === 'running') {
    if (adapter === 'mcp_agent') return 'resultStatus.codexRunning';
    if (adapter === 'direct_api') return 'resultStatus.directApiRunning';
    return 'resultStatus.running';
  }
  if (data.status === 'failed') return 'resultStatus.failed';
  if (data.status === 'canceled') return 'resultStatus.canceled';
  return undefined;
}
