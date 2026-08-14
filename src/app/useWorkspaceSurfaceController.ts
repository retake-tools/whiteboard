import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

export type WorkspaceSurface =
  | { kind: 'none' }
  | { kind: 'inspector'; blockId: string }
  | { kind: 'history' }
  | { kind: 'artifact' }
  | { kind: 'agent' };

export type WorkspaceSurfaceAction =
  | { type: 'close' }
  | { type: 'set-inspector'; blockId?: string }
  | {
      type: 'set-workbench';
      kind: 'history' | 'artifact' | 'agent';
      open: boolean;
    };

export function reduceWorkspaceSurface(
  current: WorkspaceSurface,
  action: WorkspaceSurfaceAction,
): WorkspaceSurface {
  if (action.type === 'close') return { kind: 'none' };
  if (action.type === 'set-inspector') {
    if (action.blockId) return { kind: 'inspector', blockId: action.blockId };
    return current.kind === 'inspector' ? { kind: 'none' } : current;
  }
  if (action.open) return { kind: action.kind };
  return current.kind === action.kind ? { kind: 'none' } : current;
}

interface WorkspaceSurfaceController {
  surface: WorkspaceSurface;
  closeSurface: () => void;
  setInspectorBlockId: Dispatch<SetStateAction<string | undefined>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setArtifactLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setAgentWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  inspectorBlockId?: string;
  isHistoryOpen: boolean;
  isArtifactLibraryOpen: boolean;
  isAgentWorkspaceOpen: boolean;
}

export function useWorkspaceSurfaceController({
  initialAgentOpen = false,
}: {
  initialAgentOpen?: boolean;
} = {}): WorkspaceSurfaceController {
  const [surface, setSurface] = useState<WorkspaceSurface>(
    initialAgentOpen ? { kind: 'agent' } : { kind: 'none' },
  );

  const closeSurface = useCallback(() => setSurface((current) => reduceWorkspaceSurface(
    current,
    { type: 'close' },
  )), []);

  const setInspectorBlockId = useCallback<Dispatch<SetStateAction<string | undefined>>>((next) => {
    setSurface((current) => {
      const currentBlockId = current.kind === 'inspector' ? current.blockId : undefined;
      const blockId = typeof next === 'function' ? next(currentBlockId) : next;
      return reduceWorkspaceSurface(current, { type: 'set-inspector', blockId });
    });
  }, []);

  const setHistoryOpen = useBooleanSurfaceSetter('history', setSurface);
  const setArtifactLibraryOpen = useBooleanSurfaceSetter('artifact', setSurface);
  const setAgentWorkspaceOpen = useBooleanSurfaceSetter('agent', setSurface);

  return {
    surface,
    closeSurface,
    setInspectorBlockId,
    setHistoryOpen,
    setArtifactLibraryOpen,
    setAgentWorkspaceOpen,
    inspectorBlockId: surface.kind === 'inspector' ? surface.blockId : undefined,
    isHistoryOpen: surface.kind === 'history',
    isArtifactLibraryOpen: surface.kind === 'artifact',
    isAgentWorkspaceOpen: surface.kind === 'agent',
  };
}

function useBooleanSurfaceSetter(
  kind: Exclude<WorkspaceSurface['kind'], 'none' | 'inspector'>,
  setSurface: Dispatch<SetStateAction<WorkspaceSurface>>,
): Dispatch<SetStateAction<boolean>> {
  return useCallback((next) => {
    setSurface((current) => {
      const isOpen = current.kind === kind;
      const shouldOpen = typeof next === 'function' ? next(isOpen) : next;
      return reduceWorkspaceSurface(current, {
        type: 'set-workbench',
        kind,
        open: shouldOpen,
      });
    });
  }, [kind, setSurface]);
}
