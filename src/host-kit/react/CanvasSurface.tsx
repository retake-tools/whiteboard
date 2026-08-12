import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import type { BoardSnapshot } from '../../core/types';
import type { DeepReadonly } from '../contracts';
import { useCanvasHost, useCanvasHostSnapshot } from './CanvasHostProvider';
import {
  StandardBlockNode,
  type StandardCanvasNode,
} from './StandardBlockNode';
import type { HostReactPluginSurfaceV1 } from './pluginSurface';
import { createCanvasNodeProjector } from './canvasProjection';
import { CanvasCommandErrorContext } from './CanvasCommandErrorContext';

const nodeTypes = {
  document: StandardBlockNode,
  group: StandardBlockNode,
  image: StandardBlockNode,
  operation: StandardBlockNode,
  text: StandardBlockNode,
  video: StandardBlockNode,
} satisfies NodeTypes;

export interface CanvasSurfaceProps {
  readonly className?: string;
  readonly fitView?: boolean;
  readonly miniMap?: boolean;
  readonly onCommandError?: (error: Error) => void;
  readonly onSelectionChange?: (blockIds: readonly string[]) => void;
  readonly pluginSurface?: HostReactPluginSurfaceV1;
  readonly showBackground?: boolean;
  readonly style?: CSSProperties;
}

export function CanvasSurface(props: CanvasSurfaceProps): ReactElement {
  const host = useCanvasHost();
  const snapshot = useCanvasHostSnapshot();
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const nodeProjector = useRef(createCanvasNodeProjector()).current;
  const assetById = useMemo(
    () => new Map(snapshot.assets.map((asset) => [asset.assetId, asset])),
    [snapshot.assets],
  );
  const nodes = useMemo(
    () => nodeProjector.project({
      assetById,
      pluginSurface: props.pluginSurface,
      selectedIds,
      snapshot,
    }),
    [assetById, nodeProjector, props.pluginSurface, selectedIds, snapshot],
  );
  const edges = useMemo(() => projectEdges(snapshot), [snapshot]);
  const reportError = useCallback((error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (props.onCommandError) props.onCommandError(normalized);
    else console.error(normalized);
  }, [props.onCommandError]);
  const run = useCallback((command: Promise<unknown>) => {
    void command.catch(reportError);
  }, [reportError]);
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    run(host.commands.connectBlocks({
      sourceBlockId: connection.source,
      targetBlockId: connection.target,
    }));
  }, [host, run]);
  const onSelectionChange = useCallback((selection: OnSelectionChangeParams) => {
    const blockIds = selection.nodes.map((node) => node.id);
    setSelectedIds(blockIds);
    props.onSelectionChange?.(blockIds);
  }, [props.onSelectionChange]);

  return (
    <section
      className={['retake-canvas-host', props.className].filter(Boolean).join(' ')}
      style={props.style}
    >
      {props.pluginSurface?.commands.length ? (
        <nav aria-label="Plugin commands" className="retake-canvas-host__plugin-commands">
          {props.pluginSurface.commands.map((command) => (
            <button
              key={command.commandId}
              onClick={() => run(command.run(host.commands))}
              type="button"
            >
              {command.label}
            </button>
          ))}
        </nav>
      ) : null}
      <CanvasCommandErrorContext.Provider value={reportError}>
      <ReactFlow
        deleteKeyCode={['Backspace', 'Delete']}
        edges={edges}
        fitView={props.fitView ?? true}
        nodes={nodes}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onEdgesDelete={(deleted) => {
          run(host.commands.removeConnections({
            edgeIds: deleted.map((edge) => edge.id),
          }));
        }}
        onNodeDragStop={(_event, node) => {
          run(host.commands.moveBlocks({
            moves: [{ blockId: node.id, position: node.position }],
          }));
        }}
        onNodesDelete={(deleted) => {
          run(host.commands.removeBlocks({
            blockIds: deleted.map((node) => node.id),
            includeDescendants: true,
          }));
        }}
        onSelectionChange={onSelectionChange}
      >
        {props.showBackground === false ? null : (
          <Background color="var(--retake-host-grid)" gap={24} variant={BackgroundVariant.Dots} />
        )}
        <Controls />
        {props.miniMap === false ? null : <MiniMap pannable zoomable />}
      </ReactFlow>
      </CanvasCommandErrorContext.Provider>
    </section>
  );
}

function projectEdges(snapshot: DeepReadonly<BoardSnapshot>): Edge[] {
  return snapshot.edges.map((edge) => ({
    data: { kind: edge.kind },
    id: edge.edgeId,
    source: edge.sourceBlockId,
    target: edge.targetBlockId,
  }));
}
