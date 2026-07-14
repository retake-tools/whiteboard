import { ChevronLeft, ChevronRight, Download, ImageIcon, Layers3, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { directGroupChildren, descendantBlockIds, groupMediaItems, type GroupMediaItem } from '../core/grouping';
import type { BlockRecord, BoardSnapshot, GroupKind } from '../core/types';
import { useI18n } from '../i18n';
import {
  ExecutionDetailContent,
  getExecutionDetailContextForExecution,
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

interface GroupInspectorProps {
  copiedPromptKey?: string;
  group?: BlockRecord;
  snapshot: BoardSnapshot;
  onClose: () => void;
  onCopyPrompt: (input: CopyPromptInput) => void | Promise<void>;
  onDownloadAll: (groupId: string) => void;
}

export function GroupInspector({
  copiedPromptKey,
  group,
  snapshot,
  onClose,
  onCopyPrompt,
  onDownloadAll,
}: GroupInspectorProps): ReactElement | null {
  const { t } = useI18n();
  const [selectedBlockId, setSelectedBlockId] = useState<string | undefined>();
  const groupId = group?.type === 'group' ? group.blockId : undefined;
  const mediaItems = useMemo(
    () => (groupId ? groupMediaItems(snapshot, groupId) : []),
    [groupId, snapshot.assets, snapshot.blocks],
  );
  const selectedIndex = Math.max(0, mediaItems.findIndex((item) => item.block.blockId === selectedBlockId));
  const selectedItem = mediaItems[selectedIndex];
  const firstMediaBlockId = mediaItems[0]?.block.blockId;
  const directItemCount = groupId ? directGroupChildren(snapshot, groupId).length : 0;
  const descendantCount = groupId ? descendantBlockIds(snapshot, [groupId]).length : 0;
  const executionId = typeof group?.data.groupExecutionId === 'string' ? group.data.groupExecutionId : undefined;
  const execution = executionId
    ? snapshot.executions.find((candidate) => candidate.executionId === executionId)
    : undefined;
  const executionContext = execution ? getExecutionDetailContextForExecution(snapshot, execution) : undefined;

  useEffect(() => {
    setSelectedBlockId(firstMediaBlockId);
  }, [firstMediaBlockId, groupId]);

  useEffect(() => {
    if (!groupId) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        onClose();
      }
      if (event.key === 'ArrowLeft') {
        event.stopImmediatePropagation();
        setSelectedBlockId((current) => siblingBlockId(mediaItems, current, -1));
      }
      if (event.key === 'ArrowRight') {
        event.stopImmediatePropagation();
        setSelectedBlockId((current) => siblingBlockId(mediaItems, current, 1));
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [groupId, mediaItems, onClose]);

  if (!group || group.type !== 'group') return null;

  return (
    <div className="execution-inspector-backdrop" role="presentation" onClick={onClose}>
      <section
        className="execution-inspector group-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={t('group.browserTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{t('group.browserTitle')}</span>
            <strong>{group.data.title}</strong>
          </div>
          <div className="execution-inspector-header-actions">
            {mediaItems.length > 0 ? (
              <span className="execution-result-counter">
                {selectedIndex + 1} / {mediaItems.length}
              </span>
            ) : null}
            <TooltipIconButton
              disabled={mediaItems.length === 0}
              label={t('group.downloadAssets')}
              onClick={() => onDownloadAll(group.blockId)}
            >
              <Download size={17} />
            </TooltipIconButton>
            <TooltipIconButton label={t('group.closeBrowser')} onClick={onClose}>
              <X size={17} />
            </TooltipIconButton>
          </div>
        </header>

        <div className="execution-inspector-layout">
          <section className="execution-result-viewer" aria-label={t('group.media')}>
            <div className="execution-result-stage">
              {selectedItem ? (
                <GroupMedia item={selectedItem} />
              ) : (
                <div className="execution-result-empty">
                  <Layers3 size={28} />
                  <span>{t('group.noMedia')}</span>
                </div>
              )}
              {mediaItems.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="execution-result-navigation is-previous"
                    aria-label={t('inspector.previousPreview')}
                    onClick={() => setSelectedBlockId(siblingBlockId(mediaItems, selectedBlockId, -1))}
                  >
                    <ChevronLeft size={26} />
                  </button>
                  <button
                    type="button"
                    className="execution-result-navigation is-next"
                    aria-label={t('inspector.nextPreview')}
                    onClick={() => setSelectedBlockId(siblingBlockId(mediaItems, selectedBlockId, 1))}
                  >
                    <ChevronRight size={26} />
                  </button>
                </>
              ) : null}
            </div>
            {mediaItems.length > 1 ? (
              <div className="execution-result-thumbnails">
                {mediaItems.map((item, index) => (
                  <button
                    key={item.block.blockId}
                    type="button"
                    className={item.block.blockId === selectedItem?.block.blockId ? 'is-selected' : undefined}
                    aria-label={`${item.block.data.title} ${index + 1}`}
                    onClick={() => setSelectedBlockId(item.block.blockId)}
                  >
                    {item.asset.kind === 'video' ? (
                      <span className="group-media-video-thumbnail"><Video size={20} /></span>
                    ) : (
                      <img src={item.asset.previewUrl} alt="" />
                    )}
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="execution-inspector-details">
            <GroupSummary
              descendantCount={descendantCount}
              directItemCount={directItemCount}
              group={group}
              mediaCount={mediaItems.length}
              selectedItem={selectedItem}
            />
            {executionContext ? (
              <ExecutionDetailContent
                context={executionContext}
                copiedPromptKey={copiedPromptKey}
                copyKey={`group-inspector:${executionContext.execution.executionId}`}
                copySource="group_inspector"
                onCopyPrompt={onCopyPrompt}
                onSelectAsset={(asset) => {
                  const item = mediaItems.find((candidate) => candidate.asset.assetId === asset.assetId);
                  if (item) setSelectedBlockId(item.block.blockId);
                }}
              />
            ) : null}
          </aside>
        </div>
      </section>
    </div>
  );
}

function GroupMedia({ item }: { item: GroupMediaItem }): ReactElement {
  if (item.asset.kind === 'video') {
    return <video src={item.asset.previewUrl} aria-label={item.block.data.title} controls preload="metadata" />;
  }
  return <img src={item.asset.previewUrl} alt={item.block.data.title} />;
}

function GroupSummary({
  descendantCount,
  directItemCount,
  group,
  mediaCount,
  selectedItem,
}: {
  descendantCount: number;
  directItemCount: number;
  group: BlockRecord;
  mediaCount: number;
  selectedItem?: GroupMediaItem;
}): ReactElement {
  const { t } = useI18n();
  const kind = (group.data.groupKind ?? 'manual') as GroupKind;
  const dimensions = selectedItem
    ? mediaDimensions(selectedItem.asset.width, selectedItem.asset.height)
    : undefined;

  return (
    <section className="group-inspector-summary">
      <h3>{t('group.summary')}</h3>
      <dl className="execution-inspector-meta">
        <Meta label={t('group.kind')} value={t(`group.kind.${kind}`)} />
        <Meta label={t('group.directItems')} value={String(directItemCount)} />
        <Meta label={t('group.descendants')} value={String(descendantCount)} />
        <Meta label={t('group.media')} value={String(mediaCount)} />
      </dl>
      {selectedItem ? (
        <>
          <h3>{t('group.mediaInfo')}</h3>
          <dl className="execution-inspector-meta">
            <Meta label={t('group.media')} value={selectedItem.block.data.title} />
            <Meta label={t('group.dimensions')} value={dimensions} />
            <Meta label={t('group.mimeType')} value={selectedItem.asset.mimeType} />
            <Meta label={t('group.assetId')} value={selectedItem.asset.assetId} mono />
            <Meta label={t('group.blockId')} value={selectedItem.block.blockId} mono />
          </dl>
        </>
      ) : null}
    </section>
  );
}

function Meta({ label, mono, value }: { label: string; mono?: boolean; value?: string }): ReactElement | null {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : undefined} title={value}>{value}</dd>
    </>
  );
}

function mediaDimensions(width?: number, height?: number): string | undefined {
  return width && height ? `${width} x ${height}` : undefined;
}

function siblingBlockId(items: GroupMediaItem[], currentBlockId: string | undefined, offset: number): string | undefined {
  if (items.length === 0) return undefined;
  const currentIndex = Math.max(0, items.findIndex((item) => item.block.blockId === currentBlockId));
  return items[(currentIndex + offset + items.length) % items.length]?.block.blockId;
}
