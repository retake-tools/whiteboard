import {
  Check,
  ChevronRight,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  useEffect,
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
  const [isParamsOpen, setIsParamsOpen] = useState(false);
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

  useEffect(() => {
    if (data.groupContentLocked !== true) return;
    setIsGeneratorOpen(false);
    setIsParamsOpen(false);
  }, [data.groupContentLocked]);

  useDismissiblePopover({
    active: isGeneratorOpen || isParamsOpen,
    insideSelector: '.operation-option-popover-wrap',
    onDismiss: () => {
      setIsGeneratorOpen(false);
      setIsParamsOpen(false);
    },
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
            setIsParamsOpen(false);
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
      <div className="operation-option-popover-wrap">
        <button
          type="button"
          className="operation-option-row"
          aria-expanded={isParamsOpen}
          disabled={data.groupContentLocked === true}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setIsParamsOpen((current) => !current);
            setIsGeneratorOpen(false);
          }}
        >
          <span>{t('operationToolbar.params')}</span>
          <strong>{outputCount}x</strong>
          <ChevronRight size={15} />
        </button>
        {isParamsOpen && data.groupContentLocked !== true ? (
          <div className="operation-side-popover operation-param-popover">
            <div className="operation-param-group">
              <div className="operation-param-heading">
                <span className="operation-param-title">
                  {t('operationToolbar.count')}
                </span>
              </div>
              <div className="operation-param-options">
                {[1, 2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={outputCount === count ? 'is-selected' : undefined}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchUpdateOperationGenerationParams(
                        blockId,
                        {
                          ...params,
                          variationCount: count,
                        },
                      );
                    }}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
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
