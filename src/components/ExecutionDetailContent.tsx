import { ChevronRight, FileText, ImageIcon, MessageSquareText, RotateCcw, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useState, type ReactElement } from 'react';
import { inputRoleDefinition, isExecutionInputRole } from '../core/inputRoles';
import { executionSourceLineage } from '../core/executionLineage';
import {
  configurationChanges,
  currentOperationConfiguration,
  executionConfiguration,
  executionVersionFor,
  latestExecutionForOperation,
  previousExecutionFor,
} from '../core/executionConfiguration';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionConfigurationChange,
  ExecutionConfigurationChangeKind,
  ExecutionConfigurationInputSnapshot,
  ExecutionInputRole,
  ExecutionRecord,
} from '../core/types';
import { useI18n } from '../i18n';
import type { AnnotationManifest, AnnotationMarkKind } from '../core/imageAnnotations';
import {
  annotationDraftRestoreContext,
  type AnnotationDraftRestoreState,
} from '../core/restoreAnnotationDraft';
import { TooltipIconButton } from './Tooltip';
import {
  ExecutionPromptDetails,
  type ExecutionDetailCopySource,
} from './ExecutionPromptDetails';

export type { ExecutionDetailCopySource } from './ExecutionPromptDetails';

export interface ExecutionDetailContext {
  activity: ExecutionActivityItem[];
  agentPrompt?: string;
  annotatedCompositeAsset?: AssetRecord;
  annotationDraftRestoreState?: AnnotationDraftRestoreState;
  annotationManifest?: AnnotationManifest;
  annotationText?: string;
  execution: ExecutionRecord;
  inputImages: Array<{ asset: AssetRecord; inputRole?: ExecutionInputRole }>;
  operationBlock?: BlockRecord;
  outputAssets: AssetRecord[];
  prompt?: string;
  requestPrompts?: ExecutionRecord['requestPrompts'];
  sourceAssets: AssetRecord[];
  sourceBlock?: BlockRecord;
  sourceExecutionVersion?: number;
  currentDraftChanges: ExecutionConfigurationChange[];
  executionChanges: ExecutionConfigurationChange[];
  executionVersion?: number;
}

export interface ExecutionActivityItem {
  createdAt: string;
  detail?: string;
  kind: 'started' | 'failed' | 'resumed' | 'result_updated' | 'succeeded';
  resultTitles: string[];
}

interface ExecutionDetailContentProps {
  compact?: boolean;
  context: ExecutionDetailContext;
  copiedPromptKey?: string;
  copyKey: string;
  copySource: ExecutionDetailCopySource;
  onSelectAsset?: (asset: AssetRecord) => void;
  onOpenAnnotationEditor?: () => void;
  onRestoreConfiguration?: () => void;
  onCopyPrompt: (input: {
    blockIds?: string[];
    copyKey: string;
    executionId?: string;
    prompt: string;
    source: ExecutionDetailCopySource;
  }) => void | Promise<void>;
}

interface PreviewImage {
  images: PreviewImageItem[];
  index: number;
}

interface PreviewImageItem {
  asset: AssetRecord;
  title: string;
}

export function ExecutionDetailContent({
  compact,
  context,
  copiedPromptKey,
  copyKey,
  copySource,
  onSelectAsset,
  onOpenAnnotationEditor,
  onRestoreConfiguration,
  onCopyPrompt,
}: ExecutionDetailContentProps): ReactElement {
  const { locale, t } = useI18n();
  const [previewImage, setPreviewImage] = useState<PreviewImage | undefined>();
  const {
    annotatedCompositeAsset,
    agentPrompt,
    annotationDraftRestoreState,
    annotationManifest,
    activity,
    annotationText,
    currentDraftChanges,
    execution,
    executionChanges,
    executionVersion,
    inputImages,
    outputAssets,
    prompt,
    requestPrompts,
    sourceBlock,
    sourceExecutionVersion,
  } = context;
  function openImagePreview(image: PreviewImage): void {
    const selected = image.images[image.index];
    if (onSelectAsset && selected) {
      onSelectAsset(selected.asset);
      return;
    }
    setPreviewImage(image);
  }

  useEffect(() => {
    if (!previewImage) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        setPreviewImage(undefined);
      }
      if (event.key === 'ArrowRight') {
        event.stopImmediatePropagation();
        setPreviewImage((current) => nextPreviewImage(current));
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [previewImage]);

  return (
    <div className={`execution-detail-content${compact ? ' is-compact' : ''}`}>
      <dl className="execution-inspector-meta">
        <Meta label={t('inspector.status')} value={t(`status.${execution.status}`)} />
        <Meta label={t('inspector.capability')} value={execution.capabilityId} />
        <Meta label={t('inspector.generator')} value={executionGeneratorLabel(execution)} />
        <Meta label={t('inspector.adapter')} value={execution.adapter} />
        <Meta label={t('inspector.skill')} value={execution.skillId} />
        <Meta
          label={t('inspector.source')}
          value={sourceBlock
            ? `${sourceBlock.data.title}${typeof sourceExecutionVersion === 'number' ? ` · V${sourceExecutionVersion}` : ''}`
            : undefined}
        />
        <Meta label={t('inspector.executionId')} value={execution.executionId} mono />
      </dl>

      {activity.length ? <ExecutionActivity activity={activity} locale={locale} /> : null}

      <ConfigurationChanges
        changes={executionChanges}
        emptyLabel={t(executionVersion === 1 ? 'configuration.initial' : 'configuration.noChanges')}
        title={
          typeof executionVersion === 'number'
            ? `${t('inspector.versionChanges')} · V${executionVersion}`
            : t('inspector.pendingConfiguration')
        }
      />
      {currentDraftChanges.length ? (
        <ConfigurationChanges
          changes={currentDraftChanges}
          emptyLabel={t('inspector.none')}
          title={t('inspector.currentDraftChanges')}
        />
      ) : null}
      {onRestoreConfiguration ? (
        <button
          type="button"
          className="execution-restore-configuration"
          disabled={context.operationBlock?.data.status === 'queued' || context.operationBlock?.data.status === 'running'}
          onClick={onRestoreConfiguration}
        >
          <RotateCcw size={14} />
          <span>{t('inspector.restoreConfiguration')}</span>
        </button>
      ) : null}

      {annotatedCompositeAsset || inputImages.length ? (
        <ImageComparison
          annotatedAsset={annotatedCompositeAsset}
          annotatedLabel={t('inspector.annotatedComposite')}
          emptyLabel={t('inspector.none')}
          inputImages={inputImages}
          onPreview={openImagePreview}
          sourceLabel={t('inspector.inputAssets')}
          title={t('inspector.imageComparison')}
        />
      ) : null}
      {annotationManifest && onOpenAnnotationEditor ? (
        <button
          type="button"
          className="execution-restore-configuration"
          disabled={annotationDraftRestoreState !== 'available'}
          onClick={onOpenAnnotationEditor}
        >
          <MessageSquareText size={14} />
          <span>{t('inspector.restoreAnnotationDraft')}</span>
        </button>
      ) : null}
      <AnnotationText emptyLabel={t('inspector.none')} text={annotationText} title={t('inspector.annotationText')} />
      {annotationManifest ? (
        <AnnotationManifestDetail
          manifest={annotationManifest}
          restoreState={annotationDraftRestoreState}
        />
      ) : null}
      <AssetList
        assets={outputAssets}
        emptyLabel={t('inspector.none')}
        icon={outputAssets.some((asset) => asset.mimeType.startsWith('image/'))
          ? <ImageIcon size={13} />
          : <FileText size={13} />}
        title={t('inspector.outputAssets')}
        onSelect={onSelectAsset}
      />

      <ExecutionPromptDetails
        agentPrompt={agentPrompt}
        blockIds={executionDetailBlockIds(context)}
        copiedPromptKey={copiedPromptKey}
        copyKey={copyKey}
        copySource={copySource}
        executionId={execution.executionId}
        onCopyPrompt={onCopyPrompt}
        prompt={prompt}
        requestPrompts={requestPrompts}
      />

      {previewImage ? (
        <ImageLightbox
          image={previewImage}
          closeLabel={t('inspector.closePreview')}
          nextLabel={t('inspector.nextPreview')}
          onClose={() => setPreviewImage(undefined)}
          onNext={() => setPreviewImage((current) => nextPreviewImage(current))}
        />
      ) : null}
    </div>
  );
}

function executionGeneratorLabel(execution: ExecutionRecord): string | undefined {
  if (execution.adapter === 'codex_app_server') {
    return ['Codex App Server', execution.model].filter(Boolean).join(' · ');
  }
  if (execution.adapter === 'direct_api' || execution.adapter === 'provider_cli') {
    return [execution.provider ?? execution.connectionId, execution.model].filter(Boolean).join(' · ');
  }
  return execution.generationProfile?.name ?? execution.provider ?? execution.connectionId;
}

export function getExecutionDetailContextForBlock(
  snapshot: BoardSnapshot,
  selectedBlock: BlockRecord,
): ExecutionDetailContext | undefined {
  const sourceExecutionId =
    typeof selectedBlock.data.sourceExecutionId === 'string' ? selectedBlock.data.sourceExecutionId : undefined;
  const execution = snapshot.executions.find(
    (candidate) =>
      candidate.executionId === sourceExecutionId ||
      candidate.outputBlockIds.includes(selectedBlock.blockId),
  );
  if (!execution) return undefined;
  return createExecutionDetailContext(snapshot, execution, selectedBlock);
}

export function getExecutionDetailContextForExecution(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): ExecutionDetailContext {
  const outputBlock = snapshot.blocks.find((block) => execution.outputBlockIds.includes(block.blockId));
  return createExecutionDetailContext(snapshot, execution, outputBlock);
}

function createExecutionDetailContext(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  detailBlock?: BlockRecord,
): ExecutionDetailContext {
  const sourceBlocks = snapshot.blocks.filter((block) => execution.inputBlockIds.includes(block.blockId));
  const operationBlock = findOperationBlock(snapshot, execution);
  const inputBindings = readExecutionInputBindings(execution.params?.inputBindings);
  const inputImages: Array<{ asset: AssetRecord; inputRole?: ExecutionInputRole }> = inputBindings.flatMap((binding) => {
    const block = sourceBlocks.find((candidate) => candidate.blockId === binding.blockId);
    const assetId = binding.assetId ?? (typeof block?.data.assetId === 'string' ? block.data.assetId : undefined);
    const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId && candidate.kind === 'image');
    return asset ? [{ asset, inputRole: binding.inputRole }] : [];
  });
  for (const block of sourceBlocks) {
    const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
    const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId && candidate.kind === 'image');
    if (asset && !inputImages.some((inputImage) => inputImage.asset.assetId === asset.assetId)) {
      inputImages.push({ asset });
    }
  }
  inputImages.sort((left, right) => Number(right.inputRole === 'source') - Number(left.inputRole === 'source'));
  const { sourceBlock, sourceExecutionVersion } = executionSourceLineage(snapshot, execution);
  const annotatedCompositeAssetId =
    typeof operationBlock?.data.annotatedCompositeAssetId === 'string'
      ? operationBlock.data.annotatedCompositeAssetId
      : typeof detailBlock?.data.annotatedCompositeAssetId === 'string'
        ? detailBlock.data.annotatedCompositeAssetId
      : undefined;
  const annotationText =
    typeof operationBlock?.data.annotationText === 'string'
      ? operationBlock.data.annotationText
      : typeof detailBlock?.data.annotationText === 'string'
        ? detailBlock.data.annotationText
        : undefined;
  const blockAgentPrompt =
    typeof operationBlock?.data.agentPrompt === 'string'
      ? operationBlock.data.agentPrompt
      : typeof detailBlock?.data.agentPrompt === 'string'
        ? detailBlock.data.agentPrompt
        : undefined;
  const previousExecution = previousExecutionFor(snapshot, execution);
  const executionChanges = previousExecution
    ? configurationChanges(executionConfiguration(previousExecution), executionConfiguration(execution))
    : [];
  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  const latestExecution = operationBlockId
    ? latestExecutionForOperation(snapshot, operationBlockId)
    : undefined;
  const currentDraftChanges =
    operationBlock && latestExecution?.executionId === execution.executionId
      ? configurationChanges(executionConfiguration(execution), currentOperationConfiguration(snapshot, operationBlock))
      : [];
  const annotationRestore = annotationDraftRestoreContext(snapshot, execution);

  return {
    activity: executionActivity(snapshot, execution),
    agentPrompt: execution.agentPrompt ?? blockAgentPrompt,
    annotatedCompositeAsset: snapshot.assets.find((asset) => asset.assetId === annotatedCompositeAssetId),
    annotationDraftRestoreState: annotationRestore.state,
    annotationManifest: annotationRestore.manifest,
    annotationText,
    execution,
    inputImages,
    operationBlock,
    outputAssets: snapshot.assets.filter((asset) => execution.outputAssetIds.includes(asset.assetId)),
    prompt: execution.prompt,
    requestPrompts: execution.requestPrompts,
    sourceAssets: inputImages.map((inputImage) => inputImage.asset),
    sourceBlock,
    sourceExecutionVersion,
    currentDraftChanges,
    executionChanges,
    executionVersion: executionVersionFor(snapshot, execution),
  };
}

function AnnotationManifestDetail({
  manifest,
  restoreState,
}: {
  manifest: AnnotationManifest;
  restoreState?: AnnotationDraftRestoreState;
}): ReactElement {
  const { t } = useI18n();
  return (
    <section className="execution-annotation-manifest">
      <h3>{t('inspector.annotationManifest')}</h3>
      <dl>
        <div>
          <dt>{t('inspector.annotationGlobalInstruction')}</dt>
          <dd>{manifest.globalInstruction || t('inspector.none')}</dd>
        </div>
        <div>
          <dt>{t('inspector.annotationMarks')}</dt>
          <dd>{manifest.marks.length}</dd>
        </div>
      </dl>
      {manifest.marks.length ? (
        <ol>
          {manifest.marks.map((mark) => (
            <li key={mark.id}>
              <span className="execution-annotation-color" style={{ backgroundColor: mark.color }} aria-hidden="true" />
              <strong>{mark.id} · {t(annotationMarkLabelKey(mark.kind))}</strong>
              <p>{mark.intent || t('inspector.none')}</p>
            </li>
          ))}
        </ol>
      ) : null}
      <details>
        <summary>{t('inspector.annotationManifestRaw')}</summary>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
      {restoreState === 'source_replaced' ? <p className="execution-annotation-warning">{t('inspector.annotationSourceChanged')}</p> : null}
      {restoreState === 'source_missing' ? <p className="execution-annotation-warning">{t('inspector.annotationSourceMissing')}</p> : null}
    </section>
  );
}

function annotationMarkLabelKey(kind: AnnotationMarkKind) {
  if (kind === 'marker') return 'context.markerTool' as const;
  if (kind === 'arrow') return 'context.arrowTool' as const;
  if (kind === 'pen') return 'context.penTool' as const;
  if (kind === 'brush') return 'context.regionBrushTool' as const;
  if (kind === 'rect') return 'context.rectangleTool' as const;
  return 'context.ellipseTool' as const;
}

function executionActivity(snapshot: BoardSnapshot, execution: ExecutionRecord): ExecutionActivityItem[] {
  const events = (snapshot.historyEvents ?? [])
    .filter((event) => event.executionId === execution.executionId && isExecutionActivityEvent(event))
    .sort((left, right) => {
      const timestampDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return timestampDifference || activityEventOrder(left) - activityEventOrder(right);
    });
  const resumedResultBlockIds = events.flatMap((event) => readStringArray(event.detail?.retriedResultBlockIds));
  const hasFailureRecovery = events.some(
    (event) => event.type === 'execution_failed' || readString(event.detail?.resumedFromStatus) === 'failed',
  );
  if (!hasFailureRecovery) return [];

  return events.map((event): ExecutionActivityItem => {
    const resumed = event.type === 'execution_started' && readString(event.detail?.resumedFromStatus) === 'failed';
    const resultBlockIds = event.type === 'execution_failed'
      ? readStringArray(event.detail?.failedResultBlockIds).length
        ? readStringArray(event.detail?.failedResultBlockIds)
        : resumedResultBlockIds
      : resumed
        ? readStringArray(event.detail?.retriedResultBlockIds)
        : event.type === 'result_block_updated'
          ? [readString(event.detail?.resultBlockId)].filter((value): value is string => Boolean(value))
          : [];
    return {
      createdAt: event.createdAt,
      detail: event.type === 'execution_failed' ? readString(event.detail?.errorMessage) : undefined,
      kind: resumed ? 'resumed' : activityKind(event),
      resultTitles: resultBlockIds.map((blockId) =>
        snapshot.blocks.find((block) => block.blockId === blockId)?.data.title ?? blockId,
      ),
    };
  });
}

function ExecutionActivity({
  activity,
  locale,
}: {
  activity: ExecutionActivityItem[];
  locale: 'en' | 'zh';
}): ReactElement {
  const { t } = useI18n();
  return (
    <section className="execution-activity">
      <h3>{t('inspector.failureRecovery')}</h3>
      <ol>
        {activity.map((item, index) => (
          <li className={`is-${item.kind}`} key={`${item.createdAt}:${item.kind}:${index}`}>
            <span className="execution-activity-marker" aria-hidden="true" />
            <div>
              <header>
                <strong>{t(activityLabelKey(item.kind))}</strong>
                <time dateTime={item.createdAt}>{formatActivityTime(item.createdAt, locale)}</time>
              </header>
              {item.resultTitles.length ? <p>{item.resultTitles.join(' · ')}</p> : null}
              {item.detail ? <p className="execution-activity-error">{item.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function isExecutionActivityEvent(event: BoardHistoryEvent): boolean {
  return event.type === 'execution_started' ||
    event.type === 'execution_failed' ||
    event.type === 'result_block_updated' ||
    event.type === 'execution_succeeded';
}

function activityKind(event: BoardHistoryEvent): ExecutionActivityItem['kind'] {
  if (event.type === 'execution_failed') return 'failed';
  if (event.type === 'result_block_updated') return 'result_updated';
  if (event.type === 'execution_succeeded') return 'succeeded';
  return 'started';
}

function activityEventOrder(event: BoardHistoryEvent): number {
  if (event.type === 'execution_started' && readString(event.detail?.resumedFromStatus) === 'failed') return 2;
  if (event.type === 'result_block_updated') return 3;
  if (event.type === 'execution_succeeded') return 4;
  if (event.type === 'execution_failed') return 1;
  return 0;
}

function activityLabelKey(kind: ExecutionActivityItem['kind']) {
  return `inspector.activity.${kind}` as const;
}

function formatActivityTime(value: string, locale: 'en' | 'zh'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function ConfigurationChanges({
  changes,
  emptyLabel,
  title,
}: {
  changes: ExecutionConfigurationChange[];
  emptyLabel: string;
  title: string;
}): ReactElement {
  const { t } = useI18n();
  return (
    <section className="execution-configuration-changes">
      <h3>{title}</h3>
      {changes.length ? (
        <ul>
          {changes.map((change) => (
            <li key={`${change.kind}:${change.key}`}>
              <strong>
                {t(configurationChangeLabelKey(change.kind))}
                {change.kind === 'parameter' ? ` · ${change.key}` : ''}
                {parameterSchemaTransition(change)}
              </strong>
              <div>
                <span>{formatConfigurationValue(change, change.previous, t('inspector.none'), t)}</span>
                <ChevronRight size={13} />
                <span>{formatConfigurationValue(change, change.current, t('inspector.none'), t)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : <p>{emptyLabel}</p>}
    </section>
  );
}

function configurationChangeLabelKey(kind: ExecutionConfigurationChangeKind) {
  return `configuration.${kind}` as const;
}

function formatConfigurationValue(
  change: ExecutionConfigurationChange,
  value: unknown,
  emptyLabel: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (value === undefined || value === null || value === '') return emptyLabel;
  if (change.kind === 'input' && typeof value === 'object') {
    const input = value as ExecutionConfigurationInputSnapshot;
    return input.title || input.assetId || input.blockId;
  }
  if (change.kind === 'role' && typeof value === 'string' && isExecutionInputRole(value)) {
    return t(inputRoleDefinition(value).titleKey);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function parameterSchemaTransition(change: ExecutionConfigurationChange): string {
  if (change.kind !== 'parameter') return '';
  const previous = change.previousParameter;
  const current = change.currentParameter;
  if (!previous || !current) return '';
  if (previous.valueType === current.valueType && previous.schemaVersion === current.schemaVersion) return '';
  return ` · ${previous.valueType} v${previous.schemaVersion} → ${current.valueType} v${current.schemaVersion}`;
}

function readExecutionInputBindings(
  value: unknown,
): Array<{ assetId?: string; blockId: string; inputRole: ExecutionInputRole }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((binding) => {
    if (!binding || typeof binding !== 'object') return [];
    const candidate = binding as Record<string, unknown>;
    if (typeof candidate.blockId !== 'string' || !isExecutionInputRole(candidate.inputRole)) return [];
    return [{
      assetId: typeof candidate.assetId === 'string' ? candidate.assetId : undefined,
      blockId: candidate.blockId,
      inputRole: candidate.inputRole,
    }];
  });
}

function findOperationBlock(snapshot: BoardSnapshot, execution: ExecutionRecord): BlockRecord | undefined {
  const operationBlockId =
    typeof execution.params?.operationBlockId === 'string' ? execution.params.operationBlockId : undefined;
  if (!operationBlockId) return undefined;
  return snapshot.blocks.find((block) => block.blockId === operationBlockId && block.type === 'operation');
}

function executionDetailBlockIds(context: ExecutionDetailContext): string[] {
  return [
    ...context.execution.inputBlockIds,
    context.operationBlock?.blockId,
    ...context.execution.outputBlockIds,
  ].filter((blockId): blockId is string => typeof blockId === 'string');
}

function ImageComparison({
  annotatedAsset,
  annotatedLabel,
  emptyLabel,
  inputImages,
  onPreview,
  sourceLabel,
  title,
}: {
  annotatedAsset?: AssetRecord;
  annotatedLabel: string;
  emptyLabel: string;
  inputImages: Array<{ asset: AssetRecord; inputRole?: ExecutionInputRole }>;
  onPreview: (image: PreviewImage) => void;
  sourceLabel: string;
  title: string;
}): ReactElement {
  const { t } = useI18n();
  const imageItems = [
    ...inputImages.map((inputImage) => ({
      asset: inputImage.asset,
      title: inputImage.inputRole ? t(inputRoleDefinition(inputImage.inputRole).titleKey) : sourceLabel,
    })),
    annotatedAsset ? { asset: annotatedAsset, title: annotatedLabel } : undefined,
  ].filter((item): item is PreviewImageItem => Boolean(item));

  return (
    <section className="execution-inspector-image-comparison">
      <h3>{title}</h3>
      <div className="execution-inspector-image-grid">
        {imageItems.length ? imageItems.map((item, index) => (
          <ImagePreviewCard
            key={`${item.asset.assetId}-${item.title}`}
            asset={item.asset}
            emptyLabel={emptyLabel}
            label={item.title}
            onPreview={() => onPreview({ images: imageItems, index })}
          />
        )) : (
          <ImagePreviewCard emptyLabel={emptyLabel} label={sourceLabel} onPreview={() => undefined} />
        )}
      </div>
    </section>
  );
}

function ImagePreviewCard({
  asset,
  emptyLabel,
  label,
  onPreview,
}: {
  asset?: AssetRecord;
  emptyLabel: string;
  label: string;
  onPreview: () => void;
}): ReactElement {
  if (!asset) {
    return (
      <div className="execution-inspector-image-card is-empty">
        <span>{label}</span>
        <p>{emptyLabel}</p>
      </div>
    );
  }

  return (
    <button type="button" className="execution-inspector-image-card" onClick={onPreview}>
      <span>{label}</span>
      <img src={asset.previewUrl} alt={label} />
    </button>
  );
}

function ImageLightbox({
  closeLabel,
  image,
  onClose,
  onNext,
  nextLabel,
}: {
  closeLabel: string;
  image: PreviewImage;
  onClose: () => void;
  onNext: () => void;
  nextLabel: string;
}): ReactElement {
  const current = image.images[image.index];

  return createPortal(
    <div className="execution-image-lightbox" role="dialog" aria-modal="true" aria-label={current.title} onClick={onClose}>
      <div className="execution-image-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{current.title}</span>
            <strong>{current.asset.storageKey}</strong>
          </div>
          <TooltipIconButton label={closeLabel} onClick={onClose}>
            <X size={16} />
          </TooltipIconButton>
        </header>
        <div className="execution-image-lightbox-stage">
          <img src={current.asset.previewUrl} alt={current.title} />
          {image.images.length > 1 ? (
            <button
              type="button"
              className="execution-image-lightbox-next"
              aria-label={nextLabel}
              onClick={(event) => {
                event.stopPropagation();
                onNext();
              }}
            >
              <ChevronRight size={28} />
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Meta({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value?: string;
}): ReactElement | null {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : undefined}>{value}</dd>
    </>
  );
}

function AnnotationText({
  emptyLabel,
  text,
  title,
}: {
  emptyLabel: string;
  text?: string;
  title: string;
}): ReactElement | null {
  const items = splitAnnotationText(text);
  if (items.length === 0) return null;

  return (
    <section className="execution-inspector-annotation-text">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ol>
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <p>{emptyLabel}</p>
      )}
    </section>
  );
}

function AssetList({
  assets,
  emptyLabel,
  icon,
  onSelect,
  title,
}: {
  assets: AssetRecord[];
  emptyLabel: string;
  icon: ReactElement;
  onSelect?: (asset: AssetRecord) => void;
  title: string;
}): ReactElement {
  return (
    <section className="execution-inspector-assets">
      <h3>{title}</h3>
      {assets.length > 0 ? (
        <ul>
          {assets.map((asset) => (
            <li key={asset.assetId}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(asset)}>
                  {icon}
                  <span>{asset.storageKey}</span>
                </button>
              ) : (
                <>
                  {icon}
                  <span>{asset.storageKey}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{emptyLabel}</p>
      )}
    </section>
  );
}

function splitAnnotationText(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((line) => line.trim().replace(/^\d+[.)、]\s*/, ''))
    .filter(Boolean);
}

function nextPreviewImage(current?: PreviewImage): PreviewImage | undefined {
  if (!current || current.images.length < 2) return current;
  return {
    ...current,
    index: (current.index + 1) % current.images.length,
  };
}
