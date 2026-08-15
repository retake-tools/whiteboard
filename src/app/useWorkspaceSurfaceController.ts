import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

export type WorkspaceSurface =
  | { kind: 'none' }
  | { kind: 'inspector'; blockId: string }
  | { kind: 'deliverable'; blockId: string }
  | { kind: 'task'; blockId: string }
  | { kind: 'history' }
  | { kind: 'artifact' }
  | { kind: 'agent' };

export type WorkspaceSurfaceAction =
  | { type: 'close' }
  | { type: 'set-inspector'; blockId?: string }
  | { type: 'set-deliverable'; blockId?: string }
  | { type: 'set-task'; blockId?: string }
  | {
      type: 'set-workbench';
      kind: 'history' | 'artifact' | 'agent';
      open: boolean;
    };

export interface WorkspaceSurfaceState {
  agentOpen: boolean;
  surface: WorkspaceSurface;
}

export function reduceWorkspaceSurface(
  current: WorkspaceSurfaceState,
  action: WorkspaceSurfaceAction,
): WorkspaceSurfaceState {
  if (action.type === 'close') {
    if (current.surface.kind === 'agent') {
      return { agentOpen: false, surface: { kind: 'none' } };
    }
    return {
      ...current,
      surface: current.agentOpen ? { kind: 'agent' } : { kind: 'none' },
    };
  }
  if (action.type === 'set-inspector') {
    if (action.blockId) {
      return {
        ...current,
        surface: { kind: 'inspector', blockId: action.blockId },
      };
    }
    return current.surface.kind === 'inspector'
      ? {
          ...current,
          surface: current.agentOpen ? { kind: 'agent' } : { kind: 'none' },
        }
      : current;
  }
  if (action.type === 'set-task') {
    if (action.blockId) {
      return {
        ...current,
        surface: { kind: 'task', blockId: action.blockId },
      };
    }
    return current.surface.kind === 'task'
      ? {
          ...current,
          surface: current.agentOpen ? { kind: 'agent' } : { kind: 'none' },
        }
      : current;
  }
  if (action.type === 'set-deliverable') {
    if (action.blockId) {
      return {
        ...current,
        surface: { kind: 'deliverable', blockId: action.blockId },
      };
    }
    return current.surface.kind === 'deliverable'
      ? {
          ...current,
          surface: current.agentOpen ? { kind: 'agent' } : { kind: 'none' },
        }
      : current;
  }
  if (action.kind === 'agent') {
    if (action.open) return { agentOpen: true, surface: { kind: 'agent' } };
    return {
      agentOpen: false,
      surface: current.surface.kind === 'agent' ? { kind: 'none' } : current.surface,
    };
  }
  if (action.open) return { ...current, surface: { kind: action.kind } };
  return current.surface.kind === action.kind
    ? {
        ...current,
        surface: current.agentOpen ? { kind: 'agent' } : { kind: 'none' },
      }
    : current;
}

interface WorkspaceSurfaceController {
  surface: WorkspaceSurface;
  closeSurface: () => void;
  setInspectorBlockId: Dispatch<SetStateAction<string | undefined>>;
  setDeliverableBlockId: Dispatch<SetStateAction<string | undefined>>;
  setTaskBlockId: Dispatch<SetStateAction<string | undefined>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setArtifactLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setAgentWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  inspectorBlockId?: string;
  deliverableBlockId?: string;
  taskBlockId?: string;
  isHistoryOpen: boolean;
  isArtifactLibraryOpen: boolean;
  isAgentWorkspaceOpen: boolean;
}

export function useWorkspaceSurfaceController({
  initialAgentOpen = false,
}: {
  initialAgentOpen?: boolean;
} = {}): WorkspaceSurfaceController {
  const [state, setState] = useState<WorkspaceSurfaceState>(() => ({
    agentOpen: initialAgentOpen,
    surface: initialAgentOpen ? { kind: 'agent' } : { kind: 'none' },
  }));

  const closeSurface = useCallback(() => setState((current) => reduceWorkspaceSurface(
    current,
    { type: 'close' },
  )), []);

  const setInspectorBlockId = useCallback<Dispatch<SetStateAction<string | undefined>>>((next) => {
    setState((current) => {
      const currentBlockId = current.surface.kind === 'inspector' ? current.surface.blockId : undefined;
      const blockId = typeof next === 'function' ? next(currentBlockId) : next;
      return reduceWorkspaceSurface(current, { type: 'set-inspector', blockId });
    });
  }, []);

  const setTaskBlockId = useCallback<Dispatch<SetStateAction<string | undefined>>>((next) => {
    setState((current) => {
      const currentBlockId = current.surface.kind === 'task' ? current.surface.blockId : undefined;
      const blockId = typeof next === 'function' ? next(currentBlockId) : next;
      return reduceWorkspaceSurface(current, { type: 'set-task', blockId });
    });
  }, []);

  const setDeliverableBlockId = useCallback<Dispatch<SetStateAction<string | undefined>>>((next) => {
    setState((current) => {
      const currentBlockId = current.surface.kind === 'deliverable' ? current.surface.blockId : undefined;
      const blockId = typeof next === 'function' ? next(currentBlockId) : next;
      return reduceWorkspaceSurface(current, { type: 'set-deliverable', blockId });
    });
  }, []);

  const setHistoryOpen = useBooleanSurfaceSetter('history', setState);
  const setArtifactLibraryOpen = useBooleanSurfaceSetter('artifact', setState);
  const setAgentWorkspaceOpen = useBooleanSurfaceSetter('agent', setState);

  return {
    surface: state.surface,
    closeSurface,
    setInspectorBlockId,
    setDeliverableBlockId,
    setTaskBlockId,
    setHistoryOpen,
    setArtifactLibraryOpen,
    setAgentWorkspaceOpen,
    inspectorBlockId: state.surface.kind === 'inspector' ? state.surface.blockId : undefined,
    deliverableBlockId: state.surface.kind === 'deliverable' ? state.surface.blockId : undefined,
    taskBlockId: state.surface.kind === 'task' ? state.surface.blockId : undefined,
    isHistoryOpen: state.surface.kind === 'history',
    isArtifactLibraryOpen: state.surface.kind === 'artifact',
    isAgentWorkspaceOpen: state.agentOpen,
  };
}

function useBooleanSurfaceSetter(
  kind: Exclude<WorkspaceSurface['kind'], 'none' | 'inspector' | 'deliverable' | 'task'>,
  setState: Dispatch<SetStateAction<WorkspaceSurfaceState>>,
): Dispatch<SetStateAction<boolean>> {
  return useCallback((next) => {
    setState((current) => {
      const isOpen = kind === 'agent'
        ? current.agentOpen
        : current.surface.kind === kind;
      const shouldOpen = typeof next === 'function' ? next(isOpen) : next;
      return reduceWorkspaceSurface(current, {
        type: 'set-workbench',
        kind,
        open: shouldOpen,
      });
    });
  }, [kind, setState]);
}
