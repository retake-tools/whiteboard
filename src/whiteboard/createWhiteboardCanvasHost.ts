import { loadBoardSnapshot } from '../core/boardStore';
import { createCanvasHost, type CanvasHostV1 } from '../host-kit';
import { createWhiteboardLocalConnectionAdapter } from './adapters/localConnectionAdapter';
import { createWhiteboardLocalStorageAdapter } from './adapters/localStorageAdapter';
import type { WhiteboardPluginHostRuntime } from './runtime/createWhiteboardPluginHostRuntime';

export async function createWhiteboardCanvasHost(
  runtime: WhiteboardPluginHostRuntime,
): Promise<CanvasHostV1> {
  const initial = await loadBoardSnapshot();
  return createCanvasHost({
    connections: createWhiteboardLocalConnectionAdapter(),
    environment: {
      colorScheme: preferredColorScheme(),
      contrast: 'normal',
      direction: 'ltr',
      locale: navigator.language || 'en',
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      themeId: 'retake.whiteboard',
    },
    experience: runtime.experience,
    initialScope: {
      boardId: initial.board.boardId,
      projectId: initial.project.projectId,
    },
    packageRuntime: runtime.packageRuntimeAdapter,
    storage: createWhiteboardLocalStorageAdapter(initial),
  });
}

function preferredColorScheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
