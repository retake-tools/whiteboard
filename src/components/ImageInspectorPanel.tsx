import {
  FileClock,
  Maximize2,
  X,
} from 'lucide-react';
import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionRecord,
} from '../core/types';
import { useI18n, type Locale } from '../i18n';
import { TooltipIconButton } from './Tooltip';

interface ImageInspectorPanelProps {
  asset: AssetRecord;
  block: BlockRecord;
  contentLocked: boolean;
  onClose: () => void;
  onOpenExecutionDetails: () => void;
  previewUrl: string;
  snapshot: BoardSnapshot;
}

export const ImageInspectorPanel = memo(function ImageInspectorPanel({
  asset,
  block,
  contentLocked,
  onClose,
  onOpenExecutionDetails,
  previewUrl,
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
              <dt>{t('imageInspector.version')}</dt>
              <dd>V{Math.max(1, relatedExecutions.length)}</dd>
            </div>
            <div>
              <dt>{t('imageInspector.format')}</dt>
              <dd>{asset.mimeType.replace('image/', '').toUpperCase()}</dd>
            </div>
          </dl>
        </InspectorSection>

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
          {relatedExecutions.length ? (
            <button
              type="button"
              className="image-inspector-details-button"
              onClick={onOpenExecutionDetails}
            >
              <Maximize2 size={15} />
              <span>{t('imageInspector.executionDetails')}</span>
            </button>
          ) : null}
        </InspectorSection>
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
