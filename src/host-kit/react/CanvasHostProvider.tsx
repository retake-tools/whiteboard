import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import type { CanvasHostV1, DeepReadonly } from '../contracts';
import type { BoardSnapshot } from '../../core/types';

const CanvasHostContext = createContext<CanvasHostV1 | undefined>(undefined);

export function CanvasHostProvider(
  props: PropsWithChildren<{ readonly host: CanvasHostV1 }>,
): ReactElement {
  return (
    <CanvasHostContext.Provider value={props.host}>
      {props.children}
    </CanvasHostContext.Provider>
  );
}

export function useCanvasHost(): CanvasHostV1 {
  const host = useContext(CanvasHostContext);
  if (!host) throw new Error('CanvasHostProvider is missing.');
  return host;
}

export function useCanvasHostSnapshot(): DeepReadonly<BoardSnapshot> {
  const host = useCanvasHost();
  return useSyncExternalStore(
    host.readModel.subscribe,
    host.readModel.getSnapshot,
    host.readModel.getSnapshot,
  );
}

export function useCanvasHostScope(): { readonly boardId: string; readonly projectId: string } {
  const snapshot = useCanvasHostSnapshot();
  return useMemo(() => ({
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  }), [snapshot.board.boardId, snapshot.project.projectId]);
}
