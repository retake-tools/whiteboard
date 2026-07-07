import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Clock, FileText, ImageIcon, Info, Layers3, Play, Video } from 'lucide-react';
import type { ReactElement } from 'react';
import type { BlockData, BlockType, RetakeNode } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from '../components/Tooltip';

const iconByType = {
  text: FileText,
  image: ImageIcon,
  video: Video,
  task: Play,
  frame: Layers3,
} satisfies Record<BlockType, typeof FileText>;

export function BlockNode({ data, id, type, selected }: NodeProps<RetakeNode>): ReactElement {
  const { t } = useI18n();
  const blockType = (type ?? 'text') as BlockType;
  const Icon = iconByType[blockType];
  const status = visibleBlockStatus(data as BlockData);
  const hasImagePreview = blockType === 'image' && typeof (data as BlockData).previewUrl === 'string';
  const title = displayBlockTitle(data as BlockData, blockType, t);

  if (blockType === 'frame') {
    return (
      <div className={`frame-node ${selected ? 'is-selected' : ''}`}>
        <div className="frame-title">
          <Icon size={16} />
          <span>{title}</span>
        </div>
        {data.body ? <p>{data.body}</p> : null}
      </div>
    );
  }

  return (
    <div
      className={[
        'block-node',
        `block-node-${blockType}`,
        hasImagePreview ? 'has-media-preview' : '',
        status ? `has-status-${status}` : '',
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Left} />
      <div className="block-heading">
        <Icon size={16} />
        <span>{title}</span>
      </div>
      <BlockBody blockId={id} data={data as BlockData} title={title} type={blockType} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function BlockBody({
  blockId,
  data,
  title,
  type,
}: {
  blockId: string;
  data: BlockData;
  title: string;
  type: BlockType;
}): ReactElement {
  const { t } = useI18n();

  if (type === 'image') {
    const status = visibleBlockStatus(data);
    if (!data.previewUrl) {
      return (
        <div className="image-empty-state">
          {status ? (
            <div className={`status-pill status-${status}`}>
              <Clock size={14} />
              <span>{t(`status.${status}`)}</span>
            </div>
          ) : null}
          {data.body ? <p>{data.body}</p> : <p>{t('block.image.body')}</p>}
        </div>
      );
    }

    return (
      <div className="image-preview">
        <img src={data.previewUrl} alt={title} />
        {hasExecutionDetails(data) ? <ImageInfoButton blockId={blockId} label={t('inspector.openDetails')} /> : null}
        {status ? (
          <div className={`status-pill image-status-pill status-${status}`}>
            <Clock size={14} />
            <span>{t(`status.${status}`)}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (type === 'video') {
    return (
      <div className="video-placeholder">
        <Video size={28} />
        <span>{t('block.videoPlaceholder')}</span>
      </div>
    );
  }

  if (type === 'task') {
    const status = data.status ?? 'queued';

    return (
      <div className="task-body">
        <div className={`status-pill status-${status}`}>
          <Clock size={14} />
          <span>{t(`status.${status}`)}</span>
        </div>
        {data.body ? <p>{data.body}</p> : null}
      </div>
    );
  }

  return <p className="text-body">{data.body}</p>;
}

function ImageInfoButton({ blockId, label }: { blockId: string; label: string }): ReactElement {
  return (
    <TooltipIconButton
      className="image-info-button nodrag nopan"
      label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent('retake:open-execution-inspector', { detail: { blockId } }));
      }}
    >
      <Info size={15} />
    </TooltipIconButton>
  );
}

function hasExecutionDetails(data: BlockData): boolean {
  return typeof data.sourceExecutionId === 'string' || typeof data.agentPrompt === 'string';
}

function visibleBlockStatus(data: BlockData): BlockData['status'] | undefined {
  if (!data.status) return undefined;
  if (data.statusVisualDismissed) return undefined;
  return data.status;
}

type Translate = ReturnType<typeof useI18n>['t'];

function displayBlockTitle(data: BlockData, type: BlockType, t: Translate): string {
  if (type !== 'image') return data.title;

  const capabilityId = typeof data.capabilityId === 'string' ? data.capabilityId : undefined;
  if (capabilityId === 'image.annotation_edit') return t('operation.annotationEdit.title');
  if (capabilityId === 'image.generate') return t('operation.generateImage.title');
  if (capabilityId === 'image.edit') return t('operation.quickEdit.title');
  if (capabilityId === 'image.generate.similar') return t('operation.createSimilar.title');
  return data.title;
}
