import { ChevronLeft, ChevronRight, ImageIcon, X } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { inputRoleDefinition } from '../core/inputRoles';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import {
  ExecutionDetailContent,
  getExecutionDetailContextForBlock,
  type ExecutionDetailCopySource,
} from './ExecutionDetailContent';
import { TooltipIconButton } from './Tooltip';

interface CopyPromptInput {
  blockIds?: string[];
  copyKey: string;
  executionId?: string;
  prompt: string;
  source: ExecutionDetailCopySource;
}

interface ExecutionInspectorProps {
  copiedPromptKey?: string;
  selectedBlock?: BlockRecord;
  snapshot: BoardSnapshot;
  onClose: () => void;
  onCopyPrompt: (input: CopyPromptInput) => void | Promise<void>;
  onOpenAnnotationEditor: (executionId: string) => void;
  onRestoreConfiguration: (executionId: string) => void;
}

export function ExecutionInspector({
  copiedPromptKey,
  onClose,
  selectedBlock,
  snapshot,
  onCopyPrompt,
  onOpenAnnotationEditor,
  onRestoreConfiguration,
}: ExecutionInspectorProps): ReactElement | null {
  const { t } = useI18n();
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const context = selectedBlock ? getExecutionDetailContextForBlock(snapshot, selectedBlock) : undefined;
  const isOpen = Boolean(selectedBlock && context);
  const outputImages = context ? executionOutputImages(snapshot, context.execution.outputBlockIds) : [];
  const fallbackImages = context?.inputImages.map((inputImage) => ({
    asset: inputImage.asset,
    title: inputImage.inputRole ? t(inputRoleDefinition(inputImage.inputRole).titleKey) : t('inspector.inputAssets'),
  })) ?? [];
  const viewerImages = outputImages.length ? outputImages : fallbackImages;
  const selectedViewerImage = viewerImages.find((image) => image.asset.assetId === selectedAssetId);
  const selectedSourceImage = fallbackImages.find((image) => image.asset.assetId === selectedAssetId);
  const selectedImage =
    selectedViewerImage ??
    selectedSourceImage ??
    viewerImages[0];
  const selectedOutputIndex = selectedImage
    ? outputImages.findIndex((image) => image.asset.assetId === selectedImage.asset.assetId)
    : -1;

  function selectSibling(offset: number): void {
    if (outputImages.length < 2) return;
    const currentIndex = selectedOutputIndex >= 0 ? selectedOutputIndex : 0;
    const nextIndex = (currentIndex + offset + outputImages.length) % outputImages.length;
    setSelectedAssetId(outputImages[nextIndex].asset.assetId);
  }

  useEffect(() => {
    if (!isOpen) return;
    const selectedBlockAssetId =
      typeof selectedBlock?.data.assetId === 'string' ? selectedBlock.data.assetId : undefined;
    setSelectedAssetId(selectedBlockAssetId ?? outputImages[0]?.asset.assetId ?? fallbackImages[0]?.asset.assetId);
  }, [context?.execution.executionId, isOpen, selectedBlock?.blockId]);

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
  }, [isOpen, onClose, outputImages, selectedOutputIndex]);

  if (!selectedBlock || !context) return null;

  return (
    <div className="execution-inspector-backdrop" role="presentation" onClick={onClose}>
      <section
        className="execution-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={t('inspector.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{t('inspector.title')}</span>
            <strong>{selectedBlock.data.title}</strong>
          </div>
          <div className="execution-inspector-header-actions">
            {outputImages.length > 1 ? (
              <span className="execution-result-counter">
                {Math.max(0, selectedOutputIndex) + 1} / {outputImages.length}
              </span>
            ) : null}
            <TooltipIconButton label={t('inspector.close')} onClick={onClose}>
              <X size={17} />
            </TooltipIconButton>
          </div>
        </header>

        <div className="execution-inspector-layout">
          <section className="execution-result-viewer" aria-label={t('inspector.outputAssets')}>
            <div className="execution-result-stage">
              {selectedImage ? (
                <img src={selectedImage.asset.previewUrl} alt={selectedImage.title} />
              ) : (
                <div className="execution-result-empty">
                  <ImageIcon size={28} />
                  <span>{t('inspector.none')}</span>
                </div>
              )}
              {outputImages.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="execution-result-navigation is-previous"
                    aria-label={t('inspector.previousPreview')}
                    onClick={() => selectSibling(-1)}
                  >
                    <ChevronLeft size={26} />
                  </button>
                  <button
                    type="button"
                    className="execution-result-navigation is-next"
                    aria-label={t('inspector.nextPreview')}
                    onClick={() => selectSibling(1)}
                  >
                    <ChevronRight size={26} />
                  </button>
                </>
              ) : null}
            </div>
            {outputImages.length > 1 ? (
              <div className="execution-result-thumbnails">
                {outputImages.map((image, index) => (
                  <button
                    key={image.asset.assetId}
                    type="button"
                    className={image.asset.assetId === selectedImage?.asset.assetId ? 'is-selected' : undefined}
                    aria-label={`${image.title} ${index + 1}`}
                    onClick={() => setSelectedAssetId(image.asset.assetId)}
                  >
                    <img src={image.asset.previewUrl} alt="" />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="execution-inspector-details">
            <ExecutionDetailContent
              context={context}
              copiedPromptKey={copiedPromptKey}
              copyKey={`inspector:${context.execution.executionId}`}
              copySource="execution_inspector"
              onCopyPrompt={onCopyPrompt}
              onOpenAnnotationEditor={
                context.annotationManifest
                  ? () => onOpenAnnotationEditor(context.execution.executionId)
                  : undefined
              }
              onRestoreConfiguration={
                typeof context.executionVersion === 'number'
                  ? () => onRestoreConfiguration(context.execution.executionId)
                  : undefined
              }
              onSelectAsset={(asset) => setSelectedAssetId(asset.assetId)}
            />
          </aside>
        </div>
      </section>
    </div>
  );
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
