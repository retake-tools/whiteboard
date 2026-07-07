import { Check, ChevronRight, Clipboard, ImageIcon, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useState, type ReactElement } from 'react';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export type ExecutionDetailCopySource = 'execution_inspector' | 'history_panel';

export interface ExecutionDetailContext {
  annotatedCompositeAsset?: AssetRecord;
  annotationText?: string;
  execution: ExecutionRecord;
  outputAssets: AssetRecord[];
  prompt?: string;
  sourceAssets: AssetRecord[];
  sourceBlock?: BlockRecord;
}

interface ExecutionDetailContentProps {
  compact?: boolean;
  context: ExecutionDetailContext;
  copiedPromptKey?: string;
  copyKey: string;
  copySource: ExecutionDetailCopySource;
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
  onCopyPrompt,
}: ExecutionDetailContentProps): ReactElement {
  const { t } = useI18n();
  const [previewImage, setPreviewImage] = useState<PreviewImage | undefined>();
  const { annotatedCompositeAsset, annotationText, execution, outputAssets, prompt, sourceBlock, sourceAssets } = context;
  const isCopied = copiedPromptKey === copyKey;

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
        <Meta label={t('inspector.adapter')} value={execution.adapter} />
        <Meta label={t('inspector.skill')} value={execution.skillId} />
        <Meta label={t('inspector.source')} value={sourceBlock?.data.title} />
        <Meta label={t('inspector.executionId')} value={execution.executionId} mono />
      </dl>

      <ImageComparison
        annotatedAsset={annotatedCompositeAsset}
        annotatedLabel={t('inspector.annotatedComposite')}
        emptyLabel={t('inspector.none')}
        onPreview={setPreviewImage}
        sourceAsset={sourceAssets.find((asset) => asset.kind === 'image')}
        sourceLabel={t('inspector.inputAssets')}
        title={t('inspector.imageComparison')}
      />
      <AnnotationText emptyLabel={t('inspector.none')} text={annotationText} title={t('inspector.annotationText')} />
      <AssetList assets={outputAssets} emptyLabel={t('inspector.none')} icon={<ImageIcon size={13} />} title={t('inspector.outputAssets')} />

      {prompt ? (
        <section className="execution-inspector-prompt">
          <header>
            <h3>{t('inspector.prompt')}</h3>
            <TooltipIconButton
              label={t(isCopied ? 'feedback.copied' : 'feedback.copyPrompt')}
              onClick={() =>
                onCopyPrompt({
                  blockIds: [...execution.inputBlockIds, ...execution.outputBlockIds],
                  copyKey,
                  executionId: execution.executionId,
                  prompt,
                  source: copySource,
                })
              }
            >
              {isCopied ? <Check size={15} /> : <Clipboard size={15} />}
            </TooltipIconButton>
          </header>
          <pre>{prompt}</pre>
        </section>
      ) : null}

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
  const sourceAssetIds = sourceBlocks
    .map((block) => block.data.assetId)
    .filter((assetId): assetId is string => typeof assetId === 'string');
  const annotatedCompositeAssetId =
    typeof detailBlock?.data.annotatedCompositeAssetId === 'string'
      ? detailBlock.data.annotatedCompositeAssetId
      : undefined;
  const annotationText =
    typeof detailBlock?.data.annotationText === 'string' ? detailBlock.data.annotationText : undefined;
  const blockPrompt =
    typeof detailBlock?.data.agentPrompt === 'string' ? detailBlock.data.agentPrompt : undefined;

  return {
    annotatedCompositeAsset: snapshot.assets.find((asset) => asset.assetId === annotatedCompositeAssetId),
    annotationText,
    execution,
    outputAssets: snapshot.assets.filter((asset) => execution.outputAssetIds.includes(asset.assetId)),
    prompt: execution.agentPrompt ?? blockPrompt ?? execution.prompt,
    sourceAssets: snapshot.assets.filter((asset) => sourceAssetIds.includes(asset.assetId)),
    sourceBlock: sourceBlocks[0],
  };
}

function ImageComparison({
  annotatedAsset,
  annotatedLabel,
  emptyLabel,
  onPreview,
  sourceAsset,
  sourceLabel,
  title,
}: {
  annotatedAsset?: AssetRecord;
  annotatedLabel: string;
  emptyLabel: string;
  onPreview: (image: PreviewImage) => void;
  sourceAsset?: AssetRecord;
  sourceLabel: string;
  title: string;
}): ReactElement {
  const imageItems = [
    sourceAsset ? { asset: sourceAsset, title: sourceLabel } : undefined,
    annotatedAsset ? { asset: annotatedAsset, title: annotatedLabel } : undefined,
  ].filter((item): item is PreviewImageItem => Boolean(item));

  return (
    <section className="execution-inspector-image-comparison">
      <h3>{title}</h3>
      <div className="execution-inspector-image-grid">
        <ImagePreviewCard
          asset={sourceAsset}
          emptyLabel={emptyLabel}
          label={sourceLabel}
          onPreview={() => onPreview({ images: imageItems, index: indexOfPreviewAsset(imageItems, sourceAsset) })}
        />
        <ImagePreviewCard
          asset={annotatedAsset}
          emptyLabel={emptyLabel}
          label={annotatedLabel}
          onPreview={() => onPreview({ images: imageItems, index: indexOfPreviewAsset(imageItems, annotatedAsset) })}
        />
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
  title,
}: {
  assets: AssetRecord[];
  emptyLabel: string;
  icon: ReactElement;
  title: string;
}): ReactElement {
  return (
    <section className="execution-inspector-assets">
      <h3>{title}</h3>
      {assets.length > 0 ? (
        <ul>
          {assets.map((asset) => (
            <li key={asset.assetId}>
              {icon}
              <span>{asset.storageKey}</span>
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

function indexOfPreviewAsset(images: PreviewImageItem[], asset?: AssetRecord): number {
  if (!asset) return 0;
  const index = images.findIndex((item) => item.asset.assetId === asset.assetId);
  return index >= 0 ? index : 0;
}

function nextPreviewImage(current?: PreviewImage): PreviewImage | undefined {
  if (!current || current.images.length < 2) return current;
  return {
    ...current,
    index: (current.index + 1) % current.images.length,
  };
}
