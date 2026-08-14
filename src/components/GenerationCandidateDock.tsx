import { Check, ImageIcon, LoaderCircle } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from '../core/types';
import { useI18n } from '../i18n';

interface GenerationCandidateDockProps {
  execution: ExecutionRecord;
  onSelectBlock: (blockId: string) => void;
  selectedBlockId?: string;
  snapshot: BoardSnapshot;
}

export const GenerationCandidateDock = memo(function GenerationCandidateDock({
  execution,
  onSelectBlock,
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
            snapshot={snapshot}
          />
        ))}
      </div>
    </section>
  );
});

function Candidate({
  block,
  index,
  locale,
  onSelectBlock,
  selected,
  snapshot,
}: {
  block?: BlockRecord;
  index: number;
  locale: 'en' | 'zh';
  onSelectBlock: (blockId: string) => void;
  selected: boolean;
  snapshot: BoardSnapshot;
}): ReactElement {
  const asset = snapshot.assets.find((candidate) => candidate.assetId === block?.data.assetId);
  const ready = Boolean(block && asset);
  return (
    <button
      type="button"
      className={selected ? 'is-previewing' : undefined}
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
    </button>
  );
}
