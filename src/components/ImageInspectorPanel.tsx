import {
  ChevronRight,
  Download,
  FileClock,
  MoreHorizontal,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionRecord,
} from '../core/types';
import { useI18n, type Locale } from '../i18n';
import type { PluginContributionRegistryV1 } from '../host-kit/plugin';
import {
  ExecutionDetailContent,
  getExecutionDetailContextForBlock,
  type ExecutionDetailCopySource,
} from './ExecutionDetailContent';
import { ExecutionPromptDetails } from './ExecutionPromptDetails';
import { PluginImageToolbarActions } from './PluginImageToolbarActions';
import { TooltipIconButton } from './Tooltip';

interface ImageInspectorPanelProps {
  asset: AssetRecord;
  block: BlockRecord;
  copiedPromptKey?: string;
  contentLocked: boolean;
  onClose: () => void;
  onBeforePluginOperationAction?: (operationBlockId: string) => Promise<void> | void;
  onCopyPrompt: (input: {
    blockIds?: string[];
    copyKey: string;
    executionId?: string;
    prompt: string;
    source: ExecutionDetailCopySource;
  }) => void | Promise<void>;
  onDownload: () => void;
  onSelectOutput?: (input: {
    assetId: string;
    blockId: string;
    executionId: string;
    expectedSelectionVersion: number;
  }) => void | Promise<void>;
  onPluginFatalFailure?: (pluginModuleId: string, message: string) => Promise<void> | void;
  onRestoreConfiguration: (executionId: string) => void;
  previewUrl: string;
  pluginContributionRegistry?: PluginContributionRegistryV1;
  snapshot: BoardSnapshot;
}

export const ImageInspectorPanel = memo(function ImageInspectorPanel({
  asset,
  block,
  copiedPromptKey,
  contentLocked,
  onClose,
  onBeforePluginOperationAction,
  onCopyPrompt,
  onDownload,
  onSelectOutput,
  onPluginFatalFailure,
  onRestoreConfiguration,
  previewUrl,
  pluginContributionRegistry,
  snapshot,
}: ImageInspectorPanelProps): ReactElement {
  const { locale, t } = useI18n();
  const relatedExecutions = useMemo(
    () => imageExecutions(snapshot, block, asset),
    [asset.assetId, asset.sourceExecutionId, block.blockId, snapshot.executions],
  );
  const relatedHistory = useMemo(
    () => imageHistory(snapshot, block, asset, relatedExecutions),
    [asset.assetId, block.blockId, relatedExecutions, snapshot.historyEvents],
  );
  const sourceExecution = relatedExecutions.find(
    (execution) => execution.executionId === asset.sourceExecutionId,
  );
  const selectableExecution = relatedExecutions.find((execution) => (
    execution.outputBlockIds.includes(block.blockId)
    && execution.outputAssetIds.includes(asset.assetId)
  ));
  const outputSelection = selectableExecution
    ? snapshot.executionOutputSelections?.find(
        (selection) => selection.executionId === selectableExecution.executionId,
      )
    : undefined;
  const selectableCandidateCount = selectableExecution
    ? Math.max(
        selectableExecution.outputAssetIds.length,
        selectableExecution.outputBlockIds.length,
      )
    : 0;
  const isSelectedOutput = outputSelection?.selectedAssetId === asset.assetId
    && outputSelection.selectedBlockId === block.blockId;
  const executionContext = useMemo(
    () => getExecutionDetailContextForBlock(snapshot, block),
    [block, snapshot],
  );
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  useEffect(() => {
    setExecutionDetailsOpen(false);
  }, [block.blockId, executionContext?.execution.executionId]);
  const promptBlockIds = executionContext ? [
    ...executionContext.execution.inputBlockIds,
    executionContext.operationBlock?.blockId,
    ...executionContext.execution.outputBlockIds,
  ].filter((blockId): blockId is string => typeof blockId === 'string') : [];
  const sourceLabel = sourceExecution?.capabilityId
    ?? (asset.storageProvider === 'local' || asset.storageProvider === 'local_mock'
      ? t('imageInspector.importedSource')
      : asset.storageProvider);
  return (
    <section className="image-inspector-panel" aria-label={t('imageInspector.title')}>
      <header className="image-inspector-header">
        <div>
          <span>{t('imageInspector.eyebrow')}</span>
          <h2>{t('imageInspector.title')}</h2>
        </div>
        <TooltipIconButton
          className="image-inspector-close"
          label={t('imageInspector.close')}
          onClick={onClose}
        >
          <X size={17} />
        </TooltipIconButton>
      </header>

      <div className="image-inspector-scroll">
        <section className="image-inspector-selection" aria-labelledby="image-inspector-selection-title">
          <img src={previewUrl} alt="" />
          <div>
            <h3 id="image-inspector-selection-title">{block.data.title}</h3>
            <p>{asset.width ?? Math.round(block.size.width)} × {asset.height ?? Math.round(block.size.height)} px</p>
          </div>
          {contentLocked ? <span>{t('imageInspector.locked')}</span> : null}
        </section>

        <InspectorSection title={t('imageInspector.tools')}>
          <div className="image-inspector-actions" data-retake-plugin-ui="image-inspector-actions">
            <PluginImageToolbarActions
              assetId={asset.assetId}
              blockId={block.blockId}
              onFatalFailure={onPluginFatalFailure}
              onInvoke={() => onBeforePluginOperationAction?.(block.blockId)}
              previewUrl={previewUrl}
              registry={pluginContributionRegistry}
              title={block.data.title}
            />
            <details className="image-inspector-more-actions">
              <summary>
                <MoreHorizontal size={16} />
                <span>{t('context.more')}</span>
              </summary>
              <div>
                <button type="button" className="image-context-menu-action" onClick={onDownload}>
                  <Download size={17} />
                  <span>{t('context.downloadImage')}</span>
                </button>
                <PluginImageToolbarActions
                  assetId={asset.assetId}
                  blockId={block.blockId}
                  onFatalFailure={onPluginFatalFailure}
                  onInvoke={() => onBeforePluginOperationAction?.(block.blockId)}
                  onOpenSettings={() => window.dispatchEvent(new CustomEvent('retake:open-settings'))}
                  previewUrl={previewUrl}
                  registry={pluginContributionRegistry}
                  title={block.data.title}
                  variant="menu"
                />
              </div>
            </details>
          </div>
        </InspectorSection>

        {selectableExecution && selectableCandidateCount > 1 ? (
          <InspectorSection title={t('imageInspector.outputSelection')}>
            <div className={`image-inspector-output-selection${isSelectedOutput ? ' is-selected' : ''}`}>
              <div>
                <strong>{isSelectedOutput
                  ? t('imageInspector.selectedOutput')
                  : t('imageInspector.outputNotSelected')}</strong>
                <span>{t('imageInspector.outputSelectionHint')}</span>
              </div>
              <button
                type="button"
                disabled={isSelectedOutput || !onSelectOutput}
                onClick={() => onSelectOutput?.({
                  assetId: asset.assetId,
                  blockId: block.blockId,
                  executionId: selectableExecution.executionId,
                  expectedSelectionVersion: outputSelection?.recordVersion ?? 0,
                })}
              >
                {isSelectedOutput
                  ? t('imageInspector.selectedOutput')
                  : outputSelection
                    ? t('imageInspector.reselectOutput')
                    : t('imageInspector.selectOutput')}
              </button>
            </div>
          </InspectorSection>
        ) : null}

        <InspectorSection title={t('imageInspector.position')}>
          <dl className="image-inspector-metric-grid">
            <Metric label="X" value={Math.round(block.position.x)} />
            <Metric label="Y" value={Math.round(block.position.y)} />
            <Metric label="W" value={Math.round(block.size.width)} />
            <Metric label="H" value={Math.round(block.size.height)} />
          </dl>
        </InspectorSection>

        <InspectorSection title={t('imageInspector.imageInfo')}>
          <dl className="image-inspector-facts">
            <div>
              <dt>{t('imageInspector.source')}</dt>
              <dd>{sourceLabel}</dd>
            </div>
            <div>
              <dt>{t('imageInspector.format')}</dt>
              <dd>{asset.mimeType.replace('image/', '').toUpperCase()}</dd>
            </div>
          </dl>
        </InspectorSection>

        {executionContext ? (
          <InspectorSection title={t('imageInspector.sourceAndGeneration')}>
            <dl className="image-inspector-facts">
              <div>
                <dt>{t('inspector.status')}</dt>
                <dd>{t(`status.${executionContext.execution.status}`)}</dd>
              </div>
              <div>
                <dt>{t('inspector.capability')}</dt>
                <dd>{executionContext.execution.capabilityId}</dd>
              </div>
              <div>
                <dt>{t('inspector.generator')}</dt>
                <dd>{executionContext.execution.model ?? executionContext.execution.provider ?? executionContext.execution.adapter}</dd>
              </div>
            </dl>
          </InspectorSection>
        ) : null}

        {executionContext && (
          executionContext.prompt
          || executionContext.agentPrompt
          || executionContext.requestPrompts?.length
        ) ? (
          <InspectorSection title={t('imageInspector.prompt')}>
            <ExecutionPromptDetails
              agentPrompt={executionContext.agentPrompt}
              blockIds={promptBlockIds}
              copiedPromptKey={copiedPromptKey}
              copyKey={`image-inspector:${executionContext.execution.executionId}`}
              copySource="image_inspector"
              executionId={executionContext.execution.executionId}
              onCopyPrompt={onCopyPrompt}
              prompt={executionContext.prompt}
              requestPrompts={executionContext.requestPrompts}
            />
          </InspectorSection>
        ) : null}

        {executionContext?.inputImages.length ? (
          <InspectorSection title={t('imageInspector.inputsAndReferences')}>
            <div className="image-inspector-references">
              {executionContext.inputImages.map((input) => (
                <figure key={`${input.asset.assetId}:${input.inputSlotId ?? 'image'}`}>
                  <img src={input.asset.previewUrl} alt="" />
                  <figcaption>{input.referenceIntent?.label ?? input.inputSlotId ?? t('inspector.inputAssets')}</figcaption>
                </figure>
              ))}
            </div>
          </InspectorSection>
        ) : null}

        <InspectorSection title={t('imageInspector.history')}>
          {relatedHistory.length ? (
            <ol className="image-inspector-history-list">
              {relatedHistory.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <span className={`is-${item.status}`} aria-hidden="true" />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{formatInspectorTime(item.createdAt, locale)}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="image-inspector-empty-history">
              <FileClock size={20} />
              <span>{t('imageInspector.noHistory')}</span>
            </div>
          )}
          {executionContext && typeof executionContext.executionVersion === 'number' ? (
            <button
              type="button"
              className="image-inspector-details-button"
              disabled={executionContext.operationBlock?.data.status === 'queued'
                || executionContext.operationBlock?.data.status === 'running'}
              onClick={() => onRestoreConfiguration(executionContext.execution.executionId)}
            >
              <RotateCcw size={15} />
              <span>{t('inspector.restoreConfiguration')}</span>
            </button>
          ) : null}
        </InspectorSection>

        {executionContext ? (
          <details
            className="image-inspector-execution-details"
            open={executionDetailsOpen}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setExecutionDetailsOpen(open);
              if (!open) return;
              const details = event.currentTarget;
              requestAnimationFrame(() => {
                details.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              });
            }}
          >
            <summary>
              <span>
                <strong>{t('imageInspector.executionDetails')}</strong>
                <small>{t('imageInspector.executionDetailsHint')}</small>
              </span>
              <ChevronRight aria-hidden="true" size={16} />
            </summary>
            {executionDetailsOpen ? (
              <ExecutionDetailContent
                compact
                context={executionContext}
                copiedPromptKey={copiedPromptKey}
                copyKey={`image-inspector-details:${executionContext.execution.executionId}`}
                copySource="image_inspector"
                hideImageInputs
                hideOutputAssets
                hidePromptDetails
                onBeforePluginOperationAction={onBeforePluginOperationAction}
                onCopyPrompt={onCopyPrompt}
                onPluginFatalFailure={onPluginFatalFailure}
                pluginContributionRegistry={pluginContributionRegistry}
              />
            ) : null}
          </details>
        ) : null}
      </div>
    </section>
  );
});

function InspectorSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}): ReactElement {
  return (
    <section className="image-inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface ImageHistoryItem {
  createdAt: string;
  id: string;
  status: 'failed' | 'neutral' | 'succeeded';
  title: string;
}

function imageExecutions(
  snapshot: BoardSnapshot,
  block: BlockRecord,
  asset: AssetRecord,
): ExecutionRecord[] {
  return snapshot.executions
    .filter((execution) => (
      execution.executionId === asset.sourceExecutionId
      || execution.inputBlockIds.includes(block.blockId)
      || execution.outputBlockIds.includes(block.blockId)
      || execution.inputAssetIds?.includes(asset.assetId)
      || execution.outputAssetIds.includes(asset.assetId)
    ))
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
}

function imageHistory(
  snapshot: BoardSnapshot,
  block: BlockRecord,
  asset: AssetRecord,
  executions: ExecutionRecord[],
): ImageHistoryItem[] {
  const executionIds = new Set(executions.map((execution) => execution.executionId));
  const eventItems = (snapshot.historyEvents ?? [])
    .filter((event) => historyReferencesImage(event, block, asset, executionIds))
    .map((event) => historyItemFromEvent(event));
  const representedExecutionIds = new Set(
    (snapshot.historyEvents ?? []).flatMap((event) => event.executionId ? [event.executionId] : []),
  );
  const executionItems = executions
    .filter((execution) => !representedExecutionIds.has(execution.executionId))
    .map((execution): ImageHistoryItem => ({
      createdAt: execution.completedAt ?? execution.startedAt,
      id: `execution:${execution.executionId}`,
      status: execution.status === 'failed'
        ? 'failed'
        : execution.status === 'succeeded'
          ? 'succeeded'
          : 'neutral',
      title: execution.capabilityId,
    }));
  return [...eventItems, ...executionItems]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function historyReferencesImage(
  event: BoardHistoryEvent,
  block: BlockRecord,
  asset: AssetRecord,
  executionIds: Set<string>,
): boolean {
  return Boolean(
    event.blockIds?.includes(block.blockId)
    || event.assetIds?.includes(asset.assetId)
    || (event.executionId && executionIds.has(event.executionId)),
  );
}

function historyItemFromEvent(event: BoardHistoryEvent): ImageHistoryItem {
  return {
    createdAt: event.createdAt,
    id: event.eventId,
    status: event.type === 'execution_failed'
      ? 'failed'
      : event.type === 'execution_succeeded' || event.type === 'result_block_updated'
        ? 'succeeded'
        : 'neutral',
    title: event.summary,
  };
}

function formatInspectorTime(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(date);
}
