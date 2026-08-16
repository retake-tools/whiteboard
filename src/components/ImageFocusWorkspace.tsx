import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Image as ImageIcon,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  executionImageBrowserItems,
  focusImageBrowserItems,
} from '../core/executionImageBrowser';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import { ExecutionImageViewer } from './ExecutionImageViewer';
import { isImageFocusEditableTarget } from './imageFocusKeyboard';

interface ImageFocusWorkspaceProps {
  block: BlockRecord;
  compareMode: boolean;
  onBackToCanvas: () => void;
  onCompareModeChange: (open: boolean) => void;
  onSelectBlock: (blockId: string) => void;
  snapshot: BoardSnapshot;
  suspended?: boolean;
}

interface FocusImage {
  asset: AssetRecord;
  block: BlockRecord;
}

export const ImageFocusWorkspace = memo(function ImageFocusWorkspace({
  block,
  compareMode,
  onBackToCanvas,
  onCompareModeChange,
  onSelectBlock,
  snapshot,
  suspended = false,
}: ImageFocusWorkspaceProps): ReactElement | null {
  const { t } = useI18n();
  const images = useMemo(
    () => focusImages(snapshot, block),
    [block, snapshot],
  );
  const comparisonCandidates = useMemo(
    () => executionFocusImages(snapshot, block),
    [block, snapshot],
  );
  const activeIndex = Math.max(0, images.findIndex((item) => item.block.blockId === block.blockId));
  const activeImage = images[activeIndex];
  const candidateStripRef = useRef<HTMLDivElement>(null);
  const preloadedImageUrlsRef = useRef(new Set<string>());
  const onSelectBlockRef = useRef(onSelectBlock);
  onSelectBlockRef.current = onSelectBlock;
  const selectFocusBlock = useCallback((blockId: string): void => {
    onSelectBlockRef.current(blockId);
  }, []);
  const [candidateScroll, setCandidateScroll] = useState({
    next: false,
    overflow: false,
    previous: false,
  });
  const selectedOutputKeys = new Set(
    (snapshot.executionOutputSelections ?? []).map(
      (selection) => `${selection.selectedBlockId}\u0000${selection.selectedAssetId}`,
    ),
  );
  const selectedOutputImage = comparisonCandidates.find((image) => (
    selectedOutputKeys.has(`${image.block.blockId}\u0000${image.asset.assetId}`)
  ));
  const comparisonImages = useMemo(() => {
    if (comparisonCandidates.length < 2) return undefined;
    const current = comparisonCandidates.find(
      (image) => image.block.blockId === block.blockId,
    );
    if (!current) return undefined;
    const baseline = selectedOutputImage ?? comparisonCandidates[0];
    const target = baseline.block.blockId === current.block.blockId
      ? comparisonCandidates.find((image) => image.block.blockId !== baseline.block.blockId)
      : current;
    return target ? { baseline, target } : undefined;
  }, [block.blockId, comparisonCandidates, selectedOutputImage]);

  const syncCandidateScroll = useCallback((): void => {
    const strip = candidateStripRef.current;
    if (!strip) return;
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const nextState = {
      next: strip.scrollLeft < maxScrollLeft - 1,
      overflow: maxScrollLeft > 1,
      previous: strip.scrollLeft > 1,
    };
    setCandidateScroll((current) => (
      current.next === nextState.next
        && current.overflow === nextState.overflow
        && current.previous === nextState.previous
        ? current
        : nextState
    ));
  }, []);

  const scrollCandidateQueue = useCallback((direction: -1 | 1): void => {
    const strip = candidateStripRef.current;
    if (!strip) return;
    strip.scrollBy({
      behavior: 'smooth',
      left: direction * Math.max(114, strip.clientWidth - 114),
    });
  }, []);

  function selectOffset(offset: number): void {
    if (images.length < 2) return;
    const nextIndex = (activeIndex + offset + images.length) % images.length;
    selectFocusBlock(images[nextIndex].block.blockId);
  }

  useEffect(() => {
    if (images.length < 2) return;
    const neighborIndexes = [
      (activeIndex - 1 + images.length) % images.length,
      (activeIndex + 1) % images.length,
    ];
    neighborIndexes.forEach((index) => {
      const previewUrl = images[index]?.asset.previewUrl;
      if (!previewUrl || preloadedImageUrlsRef.current.has(previewUrl)) return;
      preloadedImageUrlsRef.current.add(previewUrl);
      const image = new Image();
      image.decoding = 'async';
      image.src = previewUrl;
      void image.decode?.().catch(() => undefined);
    });
  }, [activeIndex, images]);

  useEffect(() => {
    if (suspended) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing || isImageFocusEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (compareMode) {
          onCompareModeChange(false);
          return;
        }
        onBackToCanvas();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectOffset(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectOffset(1);
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [activeIndex, compareMode, images, onBackToCanvas, onCompareModeChange, selectFocusBlock, suspended]);

  useEffect(() => {
    const strip = candidateStripRef.current;
    if (!strip) return;
    const activeCandidate = strip.querySelector<HTMLElement>(`[data-candidate-index="${activeIndex}"]`);
    if (!activeCandidate) return;
    const candidateLeft = activeCandidate.offsetLeft;
    const candidateRight = candidateLeft + activeCandidate.offsetWidth;
    const visibleLeft = strip.scrollLeft;
    const visibleRight = visibleLeft + strip.clientWidth;
    if (candidateLeft >= visibleLeft && candidateRight <= visibleRight) return;
    const centeredLeft = candidateLeft - ((strip.clientWidth - activeCandidate.offsetWidth) / 2);
    strip.scrollTo({
      behavior: 'smooth',
      left: Math.max(0, centeredLeft),
    });
  }, [activeIndex, images.length]);

  useEffect(() => {
    const strip = candidateStripRef.current;
    if (!strip) return;
    const onScroll = (): void => syncCandidateScroll();
    const observer = new ResizeObserver(syncCandidateScroll);
    strip.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(strip);
    syncCandidateScroll();
    return () => {
      strip.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [images.length, syncCandidateScroll]);

  if (!activeImage) return null;

  return (
    <section className="image-focus-workspace" aria-label={t('imageFocus.title')}>
      <div className="image-focus-stage">
        {compareMode && comparisonImages ? (
          <div className="image-focus-comparison" aria-label={t('imageFocus.compareView')}>
            <ComparisonImage
              image={comparisonImages.baseline}
              label={selectedOutputKeys.has(
                `${comparisonImages.baseline.block.blockId}\u0000${comparisonImages.baseline.asset.assetId}`,
              ) ? t('imageFocus.selectedBaseline') : t('imageFocus.baseline')}
            />
            <ComparisonImage
              image={comparisonImages.target}
              label={t('imageFocus.comparing')}
            />
          </div>
        ) : (
          <ExecutionImageViewer
            hasSiblings={images.length > 1}
            image={{ asset: activeImage.asset, title: activeImage.block.data.title }}
            onNext={() => selectOffset(1)}
            onPrevious={() => selectOffset(-1)}
          />
        )}
        <button
          type="button"
          className="image-focus-back"
          onClick={onBackToCanvas}
        >
          <ArrowLeft size={15} />
          <span>{t('imageFocus.backToCanvas')}</span>
        </button>
        {comparisonImages ? (
          <button
            type="button"
            className={`image-focus-compare-toggle${compareMode ? ' is-active' : ''}`}
            aria-pressed={compareMode}
            onClick={() => onCompareModeChange(!compareMode)}
          >
            {compareMode ? <ImageIcon aria-hidden="true" size={15} /> : <Columns2 aria-hidden="true" size={15} />}
            <span>{compareMode ? t('imageFocus.singleView') : t('imageFocus.compare')}</span>
          </button>
        ) : null}
      </div>

      <div className="image-focus-candidates">
        <header>
          <strong>{t('imageFocus.candidates')} {activeIndex + 1} / {images.length}</strong>
        </header>
        <div className="image-focus-candidate-navigation">
          <button
            type="button"
            className={`image-focus-candidate-scroll is-previous${candidateScroll.overflow ? '' : ' is-hidden'}`}
            aria-label={t('imageFocus.scrollCandidatesPrevious')}
            disabled={!candidateScroll.previous}
            onClick={() => scrollCandidateQueue(-1)}
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <div className="image-focus-candidate-strip" ref={candidateStripRef}>
            {images.map((image, index) => (
              <FocusCandidateButton
                active={index === activeIndex}
                image={image}
                index={index}
                key={image.block.blockId}
                onSelectBlock={selectFocusBlock}
                selectedOutput={selectedOutputKeys.has(
                  `${image.block.blockId}\u0000${image.asset.assetId}`,
                )}
              />
            ))}
          </div>
          <button
            type="button"
            className={`image-focus-candidate-scroll is-next${candidateScroll.overflow ? '' : ' is-hidden'}`}
            aria-label={t('imageFocus.scrollCandidatesNext')}
            disabled={!candidateScroll.next}
            onClick={() => scrollCandidateQueue(1)}
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
});

const ComparisonImage = memo(function ComparisonImage({
  image,
  label,
}: {
  image: FocusImage;
  label: string;
}): ReactElement {
  return (
    <figure>
      <img src={image.asset.previewUrl} alt={image.block.data.title} />
      <figcaption>
        <strong>{label}</strong>
        <span>{image.block.data.title}</span>
      </figcaption>
    </figure>
  );
});

const FocusCandidateButton = memo(function FocusCandidateButton({
  active,
  image,
  index,
  onSelectBlock,
  selectedOutput,
}: {
  active: boolean;
  image: FocusImage;
  index: number;
  onSelectBlock: (blockId: string) => void;
  selectedOutput: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className={`${active ? 'is-active' : ''}${selectedOutput ? ' is-selected-output' : ''}`.trim() || undefined}
      aria-label={`${image.block.data.title} ${index + 1}`}
      aria-pressed={active}
      data-candidate-index={index}
      onClick={() => onSelectBlock(image.block.blockId)}
    >
      <img loading="lazy" src={image.asset.previewUrl} alt="" />
      {selectedOutput ? (
        <span className="image-focus-selected-output">
          <Check aria-hidden="true" size={11} />
        </span>
      ) : null}
      <span>{image.block.data.title}</span>
    </button>
  );
});

function focusImages(snapshot: BoardSnapshot, block: BlockRecord): FocusImage[] {
  return focusImageBrowserItems(snapshot, block.blockId);
}

function executionFocusImages(snapshot: BoardSnapshot, block: BlockRecord): FocusImage[] {
  const activeAssetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
  const activeExecution = activeAssetId ? snapshot.executions.find((execution) => (
    execution.outputBlockIds.includes(block.blockId)
    && execution.outputAssetIds.includes(activeAssetId)
  )) : undefined;
  if (!activeExecution) return [];
  const blockById = new Map(snapshot.blocks.map((candidate) => [candidate.blockId, candidate]));
  const assetById = new Map(snapshot.assets.map((candidate) => [candidate.assetId, candidate]));
  return activeExecution.outputBlockIds.flatMap((blockId) => {
    const outputBlock = blockById.get(blockId);
    const outputAssetId = typeof outputBlock?.data.assetId === 'string'
      ? outputBlock.data.assetId
      : undefined;
    const outputAsset = outputAssetId ? assetById.get(outputAssetId) : undefined;
    return outputBlock?.type === 'image'
      && outputAsset?.kind === 'image'
      && activeExecution.outputAssetIds.includes(outputAsset.assetId)
      ? [{ asset: outputAsset, block: outputBlock }]
      : [];
  });
}
