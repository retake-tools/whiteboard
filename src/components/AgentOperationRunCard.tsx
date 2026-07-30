import { Activity, MapPin } from 'lucide-react';
import type { ReactElement } from 'react';
import type {
  AgentMessageContextRef,
} from '../core/agentSessionContracts';
import { latestExecutionForOperation } from '../core/executionConfiguration';
import {
  currentExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import type { ExecutionStatus, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';

type OperationReceipt = Extract<
  AgentMessageContextRef,
  { kind: 'operation_receipt' }
>;

export function AgentOperationRunCard({
  onLocateBlock,
  receipt,
  snapshot,
}: {
  onLocateBlock: (blockId: string) => void;
  receipt: OperationReceipt;
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const operation = snapshot.blocks.find(
    (block) => block.blockId === receipt.operationBlockId && block.type === 'operation',
  );
  const execution = operation
    ? latestExecutionForOperation(snapshot, operation.blockId)
    : undefined;
  const settings = currentExecutionProviderSettings();
  const connectionId = execution?.connectionId
    ?? stringValue(operation?.data.connectionId);
  const connection = settings?.connections.find(
    (candidate) => candidate.connectionId === connectionId,
  );
  const status = execution?.status;
  const generationParams = recordValue(operation?.data.generationParams);
  const candidateCount = execution?.resultSummary?.requested
    ?? numberValue(generationParams?.variationCount)
    ?? 1;
  const provider = execution?.provider
    ?? connection?.providerLabel
    ?? connection?.displayName
    ?? '—';
  const model = execution?.model ?? connection?.modelId;

  return (
    <article
      className={`agent-workspace-operation-card${status ? ` is-${status}` : ''}${operation ? ' is-locatable' : ''}`}
      onClick={operation ? () => onLocateBlock(operation.blockId) : undefined}
    >
      <header>
        <span><Activity size={13} />{t('agentWorkspace.operationRun')}</span>
        <strong>{status
          ? t(operationStatusKey(status))
          : t('agentWorkspace.operationPreparing')}</strong>
      </header>
      <p>
        {t(receipt.action === 'created'
          ? 'agentWorkspace.operationCreated'
          : 'agentWorkspace.operationContinued')}
        {' · '}
        {stringValue(operation?.data.title) ?? receipt.operationBlockId}
      </p>
      <dl>
        <div>
          <dt>{t('operationToolbar.capability')}</dt>
          <dd>{stringValue(operation?.data.capabilityId) ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('agentWorkspace.provider')}</dt>
          <dd>{provider}{model ? ` · ${model}` : ''}</dd>
        </div>
        <div>
          <dt>{t('agentWorkspace.candidates')}</dt>
          <dd>{candidateCount}</dd>
        </div>
      </dl>
      {operation ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onLocateBlock(operation.blockId);
          }}
        >
          <MapPin size={12} />
          {t('agentWorkspace.viewOnCanvas')}
        </button>
      ) : null}
    </article>
  );
}

function operationStatusKey(status: ExecutionStatus):
  | 'agentRuntime.status.canceled'
  | 'agentRuntime.status.failed'
  | 'agentRuntime.status.queued'
  | 'agentRuntime.status.running'
  | 'agentRuntime.status.succeeded' {
  return `agentRuntime.status.${status}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
