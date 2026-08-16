import { Check, ImageIcon, LoaderCircle } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from '../core/types';
import { useI18n } from '../i18n';

interface GenerationCandidateDockProps {
  execution: ExecutionRecord;
  onSelectBlock: (blockId: string) => void;
  onSelectOutput?: (input: {
    assetId: string;
    blockId: string;
    executionId: string;
    expectedSelectionVersion: number;
  }) => void | Promise<void>;
  selectedBlockId?: string;
  snapshot: BoardSnapshot;
}

export function generationCandidatePreviewBlockIds(
  execution: ExecutionRecord | undefined,
): string[] {
  if (!execution) return [];
  return [...new Set([
    ...execution.inputBlockIds,
    ...execution.outputBlockIds,
  ])];
}

export const GenerationCandidateDock = memo(function GenerationCandidateDock({
  execution,
  onSelectBlock,
  onSelectOutput,
  selectedBlockId,
  snapshot,
}: GenerationCandidateDockProps): ReactElement | null {
  const { locale } = useI18n();
  const requested = execution.resultSummary?.requested ?? execution.outputBlockIds.length;
  if (requested < 2) return null;
  const outputById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const sourceBlock = execution.inputBlockIds
    .map((blockId) => outputById.get(blockId))
    .find((block) => block?.type === 'image' && typeof block.data.assetId === 'string');
  const slots = Array.from({ length: requested }, (_, index) => {
    const blockId = execution.outputBlockIds[index];
    return blockId ? outputById.get(blockId) : undefined;
  });
  const selectedOutput = snapshot.executionOutputSelections?.find(
    (selection) => selection.executionId === execution.executionId,
  );
  const previewedOutputBlock = slots.find((block) => block?.blockId === selectedBlockId);
  const previewedOutputAsset = snapshot.assets.find(
    (asset) => asset.assetId === previewedOutputBlock?.data.assetId,
  );
  const previewedOutputIsSelected = Boolean(
    previewedOutputBlock
    && previewedOutputAsset
    && selectedOutput?.selectedBlockId === previewedOutputBlock.blockId
    && selectedOutput.selectedAssetId === previewedOutputAsset.assetId
  );

  return (
    <section className="generation-candidate-dock" aria-label={locale === 'zh' ? '候选结果' : 'Candidate results'}>
      <header>
        <strong>{locale === 'zh' ? '候选结果' : 'Candidates'}</strong>
        <span>
          {execution.resultSummary?.succeeded ?? execution.outputAssetIds.length}/{requested}
        </span>
      </header>
      <div className="generation-candidate-strip">
        {sourceBlock ? (
          <Candidate
            block={sourceBlock}
            index={-1}
            key={`source:${sourceBlock.blockId}`}
            locale={locale}
            onSelectBlock={onSelectBlock}
            selected={sourceBlock.blockId === selectedBlockId}
            selectedOutput={false}
            snapshot={snapshot}
          />
        ) : null}
        {slots.map((block, index) => (
          <Candidate
            block={block}
            index={index}
            key={block?.blockId ?? `candidate:${index}`}
            locale={locale}
            onSelectBlock={onSelectBlock}
            selected={block?.blockId === selectedBlockId}
            selectedOutput={Boolean(
              block
              && selectedOutput?.selectedBlockId === block.blockId
              && selectedOutput.selectedAssetId === block.data.assetId
            )}
            snapshot={snapshot}
          />
        ))}
      </div>
      <footer>
        <small>{locale === 'zh'
          ? '预览不会改变已选结果，确认后仍保留全部候选。'
          : 'Previewing does not change the selected output. All candidates remain available.'}</small>
        <button
          type="button"
          disabled={!previewedOutputBlock || !previewedOutputAsset || previewedOutputIsSelected || !onSelectOutput}
          onClick={() => {
            if (!previewedOutputBlock || !previewedOutputAsset) return;
            void onSelectOutput?.({
              assetId: previewedOutputAsset.assetId,
              blockId: previewedOutputBlock.blockId,
              executionId: execution.executionId,
              expectedSelectionVersion: selectedOutput?.recordVersion ?? 0,
            });
          }}
        >
          {previewedOutputIsSelected
            ? (locale === 'zh' ? '已选用' : 'Selected')
            : selectedOutput
              ? (locale === 'zh' ? '改选为当前方案' : 'Select current instead')
              : (locale === 'zh' ? '选用当前方案' : 'Select current')}
        </button>
      </footer>
    </section>
  );
});

function Candidate({
  block,
  index,
  locale,
  onSelectBlock,
  selected,
  selectedOutput,
  snapshot,
}: {
  block?: BlockRecord;
  index: number;
  locale: 'en' | 'zh';
  onSelectBlock: (blockId: string) => void;
  selected: boolean;
  selectedOutput: boolean;
  snapshot: BoardSnapshot;
}): ReactElement {
  const asset = snapshot.assets.find((candidate) => candidate.assetId === block?.data.assetId);
  const ready = Boolean(block && asset);
  return (
    <button
      type="button"
      className={`${selected ? 'is-previewing' : ''}${selectedOutput ? ' is-selected-output' : ''}`.trim() || undefined}
      disabled={!ready}
      onClick={() => block && onSelectBlock(block.blockId)}
    >
      <span className="generation-candidate-preview">
        {asset ? <img src={asset.previewUrl} alt="" /> : (
          block?.data.status === 'failed'
            ? <ImageIcon size={20} />
            : <LoaderCircle className="is-spinning" size={20} />
        )}
      </span>
      <span className="generation-candidate-label">
        {index < 0
          ? (locale === 'zh' ? '原图' : 'Source')
          : (locale === 'zh' ? `方案 ${index + 1}` : `Option ${index + 1}`)}
      </span>
      {selected ? (
        <span className="generation-candidate-previewing">
          <Check size={10} />
          {locale === 'zh' ? '预览中' : 'Previewing'}
        </span>
      ) : null}
      {selectedOutput ? (
        <span className="generation-candidate-selected-output">
          <Check size={10} />
          {locale === 'zh' ? '已选用' : 'Selected'}
        </span>
      ) : null}
    </button>
  );
}
