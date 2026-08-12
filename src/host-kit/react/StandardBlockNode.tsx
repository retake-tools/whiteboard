import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { memo, useContext, type ReactElement, type ReactNode } from 'react';
import type { BlockType } from '../../core/types';
import { useCanvasHost } from './CanvasHostProvider';
import { CanvasCommandErrorContext } from './CanvasCommandErrorContext';

export interface StandardBlockNodeData extends Record<string, unknown> {
  readonly assetPreviewUrl?: string;
  readonly body?: string;
  readonly pluginBody?: ReactNode;
  readonly title: string;
}

export type StandardCanvasNode = Node<StandardBlockNodeData, BlockType>;

function StandardBlockNodeComponent(props: NodeProps<StandardCanvasNode>): ReactElement {
  const host = useCanvasHost();
  const reportCommandError = useContext(CanvasCommandErrorContext);
  const isMedia = props.type === 'image' || props.type === 'video';
  return (
    <article className={`retake-canvas-host__block is-${props.type}`}>
      <NodeResizer
        color="var(--retake-host-accent)"
        isVisible={props.selected}
        minHeight={72}
        minWidth={140}
        onResizeEnd={(_event, resize) => {
          const command = props.type === 'group'
            ? host.commands.resizeGroup({
                groupId: props.id,
                position: absoluteResizePosition(host, props.id, resize),
                size: { height: resize.height, width: resize.width },
              })
            : host.commands.resizeBlock({
                blockId: props.id,
                size: { height: resize.height, width: resize.width },
              });
          void command.catch(reportCommandError);
        }}
      />
      <Handle position={Position.Left} type="target" />
      <header>{props.data.title}</header>
      {isMedia && props.data.assetPreviewUrl ? (
        props.type === 'video' ? (
          <video aria-label={props.data.title} controls src={props.data.assetPreviewUrl} />
        ) : (
          <img alt={props.data.title} src={props.data.assetPreviewUrl} />
        )
      ) : null}
      {props.data.body ? <p>{props.data.body}</p> : null}
      {props.data.pluginBody ? (
        <div className="retake-canvas-host__plugin-body">{props.data.pluginBody}</div>
      ) : null}
      <Handle position={Position.Right} type="source" />
    </article>
  );
}

export const StandardBlockNode = memo(StandardBlockNodeComponent);

function absoluteResizePosition(
  host: ReturnType<typeof useCanvasHost>,
  blockId: string,
  resize: { x: number; y: number },
): { x: number; y: number } {
  const snapshot = host.readModel.getSnapshot();
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  const parent = block?.parentGroupId
    ? snapshot.blocks.find((candidate) => candidate.blockId === block.parentGroupId)
    : undefined;
  return {
    x: resize.x + (parent?.position.x ?? 0),
    y: resize.y + (parent?.position.y ?? 0),
  };
}
