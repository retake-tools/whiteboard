import { Braces, Eye, FileText, Loader2, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useDocumentStream } from '../core/documentStreamStore';
import { executionImageBrowserItems } from '../core/executionImageBrowser';
import { markdownHeadingAnchorId, markdownHeadings } from '../core/markdownDocument';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import { referenceInputSlotLabel } from './referenceInputLabels';
import {
  ExecutionDetailContent,
  getExecutionDetailContextForBlock,
  type ExecutionDetailCopySource,
} from './ExecutionDetailContent';
import { ExecutionImageViewer } from './ExecutionImageViewer';
import { SafeMarkdown } from './SafeMarkdown';
import { TooltipIconButton } from './Tooltip';
import type {
  PluginContributionRegistryV1,
} from '../host-kit/plugin';

interface CopyPromptInput {
  blockIds?: string[];
  copyKey: string;
  executionId?: string;
  prompt: string;
  source: ExecutionDetailCopySource;
}

interface DocumentOutlineItem {
  anchorId?: string;
  label: string;
}

interface ViewerImage {
  asset: AssetRecord;
  blockId?: string;
  title: string;
}

interface ExecutionInspectorProps {
  copiedPromptKey?: string;
  reserveAgentWorkspace?: boolean;
  selectedBlock?: BlockRecord;
  snapshot: BoardSnapshot;
  onClose: () => void;
  onCopyPrompt: (input: CopyPromptInput) => void | Promise<void>;
  onBeforePluginOperationAction?: (
    operationBlockId: string,
  ) => Promise<void> | void;
  onRestoreConfiguration: (executionId: string) => void;
  onPluginFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  pluginContributionRegistry?: PluginContributionRegistryV1;
}

export function ExecutionInspector({
  copiedPromptKey,
  onClose,
  onBeforePluginOperationAction,
  reserveAgentWorkspace = false,
  selectedBlock,
  snapshot,
  onCopyPrompt,
  onPluginFatalFailure,
  onRestoreConfiguration,
  pluginContributionRegistry,
}: ExecutionInspectorProps): ReactElement | null {
  const { t } = useI18n();
  const [activeImageBlockId, setActiveImageBlockId] = useState<string | undefined>();
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const chainImages = useMemo(
    () => selectedBlock?.type === 'image'
      ? executionImageBrowserItems(snapshot, selectedBlock.blockId)
      : [],
    [selectedBlock?.blockId, selectedBlock?.type, snapshot],
  );
  const activeImageBlock = snapshot.blocks.find(
    (block) => block.type === 'image' && block.blockId === activeImageBlockId,
  );
  const detailBlock = activeImageBlock ?? selectedBlock;
  const context = detailBlock ? getExecutionDetailContextForBlock(snapshot, detailBlock) : undefined;
  const detailAssetId =
    detailBlock?.type === 'image' && typeof detailBlock.data.assetId === 'string'
      ? detailBlock.data.assetId
      : undefined;
  const detailImageAsset = detailAssetId
    ? snapshot.assets.find(
        (asset) => asset.kind === 'image' && asset.assetId === detailAssetId,
      )
    : undefined;
  const isOpen = Boolean(detailBlock && (context || detailImageAsset));
  const outputImages = context ? executionOutputImages(snapshot, context.execution.outputBlockIds) : [];
  const outputDocuments = context ? executionOutputDocuments(snapshot, context.execution.outputBlockIds) : [];
  const selectedDocument = detailBlock?.type === 'document'
    ? documentOutputForBlock(snapshot, detailBlock)
    : outputDocuments[0];
  const fallbackImages = context?.inputImages.map((inputImage) => ({
    asset: inputImage.asset,
    title: inputImage.referenceIntent?.label
      ?? referenceInputSlotLabel({ inputSlotId: inputImage.inputSlotId }, t),
  })) ?? [];
  const connectedImages: ViewerImage[] = chainImages.map((image) => ({
    asset: image.asset,
    blockId: image.block.blockId,
    title: image.block.data.title,
  }));
  if (
    detailBlock?.type === 'image'
    && detailImageAsset
    && !connectedImages.some((image) => image.blockId === detailBlock.blockId)
  ) {
    connectedImages.unshift({
      asset: detailImageAsset,
      blockId: detailBlock.blockId,
      title: detailBlock.data.title,
    });
  }
  const viewerImages: ViewerImage[] = connectedImages.length
    ? connectedImages
    : outputImages.length
      ? outputImages
      : fallbackImages.length
        ? fallbackImages
        : detailBlock?.type === 'image' && detailImageAsset
          ? [{
              asset: detailImageAsset,
              blockId: detailBlock.blockId,
              title: detailBlock.data.title,
            }]
          : [];
  const selectedViewerImage = viewerImages.find((image) => image.asset.assetId === selectedAssetId);
  const selectedSourceImage = fallbackImages.find((image) => image.asset.assetId === selectedAssetId);
  const selectedImage =
    selectedViewerImage ??
    selectedSourceImage ??
    viewerImages[0];
  const selectedViewerIndex = selectedImage
    ? viewerImages.findIndex((image) => image.asset.assetId === selectedImage.asset.assetId)
    : -1;

  function selectSibling(offset: number): void {
    if (viewerImages.length < 2) return;
    const currentIndex = selectedViewerIndex >= 0 ? selectedViewerIndex : 0;
    const nextIndex = (currentIndex + offset + viewerImages.length) % viewerImages.length;
    selectViewerImage(viewerImages[nextIndex]);
  }

  function selectViewerImage(image: ViewerImage): void {
    setSelectedAssetId(image.asset.assetId);
    if (image.blockId) setActiveImageBlockId(image.blockId);
  }

  useEffect(() => {
    if (!isOpen) return;
    const detailBlockAssetId =
      typeof detailBlock?.data.assetId === 'string' ? detailBlock.data.assetId : undefined;
    setSelectedAssetId(detailBlockAssetId ?? outputImages[0]?.asset.assetId ?? fallbackImages[0]?.asset.assetId);
  }, [context?.execution.executionId, detailBlock?.blockId, isOpen]);

  useEffect(() => {
    setActiveImageBlockId(selectedBlock?.type === 'image' ? selectedBlock.blockId : undefined);
  }, [selectedBlock?.blockId, selectedBlock?.type]);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose();
      return;
    }

    function onViewerKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') return onKeyDown(event);
      if (event.key === 'ArrowLeft') {
        event.stopImmediatePropagation();
        selectSibling(-1);
      }
      if (event.key === 'ArrowRight') {
        event.stopImmediatePropagation();
        selectSibling(1);
      }
    }

    window.addEventListener('keydown', onViewerKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onViewerKeyDown, { capture: true });
  }, [isOpen, onClose, selectedViewerIndex, viewerImages]);

  if (!detailBlock || (!context && !detailImageAsset)) return null;

  return (
    <div
      className={`execution-inspector-backdrop${reserveAgentWorkspace ? ' has-agent-workspace' : ''}`}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="execution-inspector"
        role="dialog"
        aria-modal={!reserveAgentWorkspace}
        aria-label={t(selectedDocument
          ? 'document.reviewWorkspace'
          : context
            ? 'inspector.title'
            : 'inspector.imageDetails')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{selectedDocument
              ? t('document.reviewWorkspace')
              : context
                ? t('inspector.title')
                : t('inspector.imageDetails')}</span>
            <strong>{detailBlock.data.title}</strong>
          </div>
          <div className="execution-inspector-header-actions">
            {viewerImages.length > 1 ? (
              <span className="execution-result-counter">
                {Math.max(0, selectedViewerIndex) + 1} / {viewerImages.length}
              </span>
            ) : null}
            <TooltipIconButton label={t('inspector.close')} onClick={onClose}>
              <X size={17} />
            </TooltipIconButton>
          </div>
        </header>

        <div className="execution-inspector-layout">
          <section className="execution-result-viewer" aria-label={t('inspector.outputAssets')}>
            {selectedDocument ? (
              <ExecutionDocumentViewer document={selectedDocument} />
            ) : (
              <ExecutionImageViewer
                hasSiblings={viewerImages.length > 1}
                image={selectedImage}
                onNext={() => selectSibling(1)}
                onPrevious={() => selectSibling(-1)}
              />
            )}
            {!selectedDocument && viewerImages.length > 1 ? (
              <div className="execution-result-thumbnails">
                {viewerImages.map((image, index) => (
                  <button
                    key={image.asset.assetId}
                    type="button"
                    className={image.asset.assetId === selectedImage?.asset.assetId ? 'is-selected' : undefined}
                    aria-label={`${image.title} ${index + 1}`}
                    onClick={() => selectViewerImage(image)}
                  >
                    <img src={image.asset.previewUrl} alt="" />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="execution-inspector-details">
            {context ? (
              <ExecutionDetailContent
                context={context}
                copiedPromptKey={copiedPromptKey}
                copyKey={`inspector:${context.execution.executionId}`}
                copySource="execution_inspector"
                onCopyPrompt={onCopyPrompt}
                onBeforePluginOperationAction={onBeforePluginOperationAction}
                onPluginFatalFailure={onPluginFatalFailure}
                onRestoreConfiguration={
                  typeof context.executionVersion === 'number'
                    ? () => onRestoreConfiguration(context.execution.executionId)
                    : undefined
                }
                onSelectAsset={(asset) => {
                  const image = viewerImages.find((candidate) => candidate.asset.assetId === asset.assetId);
                  if (image) selectViewerImage(image);
                  else setSelectedAssetId(asset.assetId);
                }}
                pluginContributionRegistry={pluginContributionRegistry}
              />
            ) : (
              <ImageAssetDetails
                asset={detailImageAsset}
                block={detailBlock}
              />
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

function ImageAssetDetails({
  asset,
  block,
}: {
  asset?: AssetRecord;
  block: BlockRecord;
}): ReactElement | null {
  const { t } = useI18n();
  if (!asset) return null;
  const dimensions = asset.width && asset.height
    ? `${asset.width} x ${asset.height}`
    : undefined;
  return (
    <div className="execution-detail-content">
      <dl className="execution-inspector-meta">
        <InspectorMeta label={t('group.media')} value={block.data.title} />
        <InspectorMeta label={t('group.dimensions')} value={dimensions} />
        <InspectorMeta label={t('group.mimeType')} value={asset.mimeType} />
        <InspectorMeta label={t('group.assetId')} value={asset.assetId} mono />
        <InspectorMeta label={t('group.blockId')} value={block.blockId} mono />
      </dl>
    </div>
  );
}

function InspectorMeta({
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
      <dd className={mono ? 'is-mono' : undefined} title={value}>{value}</dd>
    </>
  );
}

function ExecutionDocumentViewer({
  document,
}: {
  document: { asset?: AssetRecord; block: BlockRecord };
}): ReactElement {
  const { t } = useI18n();
  const stream = useDocumentStream(document.block.blockId);
  const [savedMarkdown, setSavedMarkdown] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isOutlineOpen, setIsOutlineOpen] = useState(true);
  const [pendingHeadingAnchorId, setPendingHeadingAnchorId] = useState<string | undefined>();
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const isRunning = document.block.data.status === 'queued' || document.block.data.status === 'running';
  const markdown = isRunning && stream ? stream : savedMarkdown || stream;
  const headingIdPrefix = `execution-document-${document.block.blockId}`;
  const outline = useMemo<DocumentOutlineItem[]>(
    () => markdown
      ? markdownHeadings(markdown).slice(0, 12).map((heading) => ({
        anchorId: markdownHeadingAnchorId(headingIdPrefix, heading.line),
        label: `${'  '.repeat(heading.level - 1)}${heading.text}`,
      }))
      : (document.block.data.documentOutline ?? []).map((label) => ({ label })),
    [document.block.blockId, document.block.data.documentOutline, markdown],
  );
  const assetPreviewUrl = document.asset?.previewUrl;

  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    setSavedMarkdown('');
    if (!assetPreviewUrl) return () => controller.abort();
    void fetch(assetPreviewUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(setSavedMarkdown)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : t('document.loadFailed'));
    });
    return () => controller.abort();
  }, [assetPreviewUrl, t]);

  useEffect(() => {
    if (view !== 'preview' || !pendingHeadingAnchorId) return;
    let retryFrameId: number | undefined;
    const frameId = window.requestAnimationFrame(() => {
      if (focusDocumentHeading(pendingHeadingAnchorId)) {
        setPendingHeadingAnchorId(undefined);
        return;
      }
      retryFrameId = window.requestAnimationFrame(() => {
        if (focusDocumentHeading(pendingHeadingAnchorId)) setPendingHeadingAnchorId(undefined);
      });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      if (retryFrameId !== undefined) window.cancelAnimationFrame(retryFrameId);
    };
  }, [pendingHeadingAnchorId, view]);

  return (
    <div className="execution-document-viewer">
      <div className="execution-document-toolbar">
        <span><FileText size={15} />{t('block.document.title')}</span>
        <div className="execution-document-toolbar-actions">
          <button
            type="button"
            aria-controls="execution-document-outline"
            aria-expanded={isOutlineOpen}
            onClick={() => setIsOutlineOpen((current) => !current)}
          >
            {isOutlineOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            {t(isOutlineOpen ? 'document.hideOutline' : 'document.showOutline')}
          </button>
          <div role="group" aria-label={t('document.viewMode')}>
            <button type="button" className={view === 'preview' ? 'is-active' : undefined} onClick={() => setView('preview')}>
              <Eye size={14} />{t('document.preview')}
            </button>
            <button type="button" className={view === 'source' ? 'is-active' : undefined} onClick={() => setView('source')}>
              <Braces size={14} />{t('document.source')}
            </button>
          </div>
        </div>
      </div>
      <div className={`execution-document-body${isOutlineOpen ? '' : ' is-outline-hidden'}`}>
        {isOutlineOpen ? (
          <aside id="execution-document-outline" className="execution-document-outline" aria-label={t('document.outline')}>
            <strong>{t('document.outline')}</strong>
            {outline.length ? (
              <ol>{outline.map((item, index) => (
                <li key={`${item.label}:${index}`}>
                  {item.anchorId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setView('preview');
                        setPendingHeadingAnchorId(item.anchorId);
                      }}
                    >
                      {item.label}
                    </button>
                  ) : <span>{item.label}</span>}
                </li>
              ))}</ol>
            ) : <p>{t('document.noOutline')}</p>}
          </aside>
        ) : null}
        <article className="execution-document-content">
          {loadError ? <div className="execution-document-error" role="alert">{t('document.loadFailed')}: {loadError}</div> : null}
          {!markdown && isRunning ? <div className="execution-document-loading"><Loader2 size={18} />{t('document.waiting')}</div> : null}
          {!markdown && !isRunning && !loadError ? <div className="execution-result-empty"><FileText size={28} /><span>{t('document.empty')}</span></div> : null}
          {markdown && view === 'source' ? <pre className="execution-document-source">{markdown}</pre> : null}
          {markdown && view === 'preview' ? (
            <div className="execution-document-markdown">
              <SafeMarkdown
                externalImageBlockedLabel={t('document.externalImageBlocked')}
                headingIdPrefix={headingIdPrefix}
                markdown={markdown}
              />
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}

function focusDocumentHeading(anchorId: string): boolean {
  const heading = window.document.getElementById(anchorId);
  if (!heading) return false;
  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  heading.focus({ preventScroll: true });
  return true;
}

function executionOutputImages(
  snapshot: BoardSnapshot,
  outputBlockIds: string[],
): Array<{ asset: AssetRecord; title: string }> {
  return outputBlockIds.flatMap((blockId) => {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'image');
    const assetId = typeof block?.data.assetId === 'string' ? block.data.assetId : undefined;
    const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId);
    return block && asset ? [{ asset, title: block.data.title }] : [];
  });
}

function executionOutputDocuments(
  snapshot: BoardSnapshot,
  outputBlockIds: string[],
): Array<{ asset?: AssetRecord; block: BlockRecord }> {
  return outputBlockIds.flatMap((blockId) => {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'document');
    if (!block) return [];
    const output = documentOutputForBlock(snapshot, block);
    return output ? [output] : [];
  });
}

function documentOutputForBlock(
  snapshot: BoardSnapshot,
  block: BlockRecord,
): { asset?: AssetRecord; block: BlockRecord } | undefined {
  if (block.type !== 'document') return undefined;
  const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
  const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId);
  return { asset, block };
}
