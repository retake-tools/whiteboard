import {
  Check,
  ChevronRight,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import {
  currentExecutionProviderSettings,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import type {
  ExecutionConnectionStatus,
  ExecutionConnectionSummary,
} from '../core/executionProviders';
import { operationDisplayState } from '../core/operationDisplay';
import type { BlockData } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

export function AnnotationOperationInlineControls({
  blockId,
  capabilityName,
  data,
}: {
  blockId: string;
  capabilityName: string;
  data: BlockData;
}): ReactElement {
  const { t } = useI18n();
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const providerSettings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );
  const compatibleConnections = operationExecutionConnections(
    providerSettings?.connections ?? [],
  );
  const selectedConnection = typeof data.connectionId === 'string'
    ? providerSettings?.connections.find(
        (connection) => connection.connectionId === data.connectionId,
      )
    : compatibleConnections[0];
  const params = isRecord(data.generationParams)
    ? data.generationParams
    : {};
  const outputCount = clampVariationCount(params.variationCount);
  const displayState = operationDisplayState(data);
  const automatedPending = selectedConnection?.connectorId !== 'codex-managed'
    && displayState.isQueued;
  const runDisabled = data.groupContentLocked === true
    || displayState.runDisabled
    || automatedPending
    || !selectedConnection
    || selectedConnection.status !== 'ready';

  useDismissiblePopover({
    active: isGeneratorOpen,
    insideSelector: '.operation-option-popover-wrap',
    onDismiss: () => setIsGeneratorOpen(false),
    rootRef: controlsRef,
  });

  return (
    <div
      ref={controlsRef}
      className="operation-inline-controls"
      aria-label={t('operationToolbar.title')}
    >
      <div className="operation-option-row is-read-only">
        <span>{t('operationToolbar.capability')}</span>
        <strong>{capabilityName}</strong>
      </div>
      <div className="operation-option-popover-wrap">
        <button
          type="button"
          className="operation-option-row"
          aria-expanded={isGeneratorOpen}
          disabled={data.groupContentLocked === true}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setIsGeneratorOpen((current) => !current);
          }}
        >
          <span>{t('operationToolbar.generator')}</span>
          <strong>
            {selectedConnection
              ? connectionLabel(selectedConnection)
              : t('settings.noCompatibleConnection')}
          </strong>
          <ChevronRight size={15} />
        </button>
        {isGeneratorOpen && data.groupContentLocked !== true ? (
          <div className="operation-side-popover operation-generator-popover">
            {compatibleConnections.map((option) => (
              <button
                key={option.connectionId}
                type="button"
                className={
                  selectedConnection?.connectionId === option.connectionId
                    ? 'is-selected'
                    : undefined
                }
                disabled={option.status !== 'ready'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchUpdateOperationConnection(
                    blockId,
                    option.connectionId,
                  );
                  setIsGeneratorOpen(false);
                }}
              >
                <span>
                  {connectionLabel(option)}
                  {option.status === 'ready'
                    ? ''
                    : ` · ${connectionStatusText(option.status, t)}`}
                </span>
                {selectedConnection?.connectionId === option.connectionId
                  ? <Check size={14} />
                  : null}
              </button>
            ))}
            {compatibleConnections.length === 0 ? (
              <button type="button" disabled>
                {t('settings.noCompatibleConnection')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <label className="operation-option-row">
        <span>{t('operationToolbar.count')}</span>
        <select
          aria-label={t('operationToolbar.count')}
          disabled={data.groupContentLocked === true}
          value={outputCount}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => dispatchUpdateOperationGenerationParams(
            blockId,
            {
              ...params,
              variationCount: Number(event.target.value),
            },
          )}
        >
          {[1, 2, 3, 4].map((count) => (
            <option key={count} value={count}>{count}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={`operation-run-button ${
          displayState.isRunning ? 'is-running' : ''
        } ${displayState.isQueued ? 'is-queued' : ''}`}
        disabled={runDisabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          dispatchRunOperation(blockId);
        }}
      >
        {displayState.isRunning || automatedPending
          ? <Loader2 size={15} />
          : <RefreshCw size={15} />}
        <span>
          {displayState.isRunning || automatedPending
            ? t('operationToolbar.running')
            : t('operationToolbar.generateAgain')}
        </span>
      </button>
    </div>
  );
}

function operationExecutionConnections(
  connections: ExecutionConnectionSummary[],
): ExecutionConnectionSummary[] {
  return connections.filter((connection) => (
    connection.enabledUseCases.includes('image')
    && connection.supportedCapabilityIds.includes('image.annotation_edit')
  ));
}

function connectionLabel(connection: ExecutionConnectionSummary): string {
  return `${connection.displayName}${
    connection.modelId ? ` · ${connection.modelId}` : ''
  }`;
}

function connectionStatusText(
  status: ExecutionConnectionStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (status === 'not_installed') return t('settings.statusNotInstalled');
  if (status === 'needs_credentials') return t('settings.statusNeedsCredentials');
  if (status === 'needs_login') return t('settings.statusNeedsLogin');
  if (status === 'untested') return t('settings.statusUntested');
  if (status === 'checking') return t('settings.statusChecking');
  if (status === 'ready') return t('settings.statusReady');
  return t('settings.statusUnavailable');
}

function clampVariationCount(value: unknown): 1 | 2 | 3 | 4 {
  return value === 2 || value === 3 || value === 4 ? value : 1;
}

function dispatchRunOperation(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:run-operation', {
    detail: { blockId, queuedConfigurationStale: false },
  }));
}

function dispatchUpdateOperationGenerationParams(
  blockId: string,
  generationParams: Record<string, unknown>,
): void {
  window.dispatchEvent(
    new CustomEvent('retake:update-operation-generation-params', {
      detail: { blockId, generationParams },
    }),
  );
}

function dispatchUpdateOperationConnection(
  blockId: string,
  connectionId: string,
): void {
  window.dispatchEvent(
    new CustomEvent('retake:update-operation-connection', {
      detail: { blockId, connectionId },
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
