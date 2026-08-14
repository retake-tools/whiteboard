import type { ReactElement, ReactNode } from 'react';
import type { WorkspaceSurface } from '../app/useWorkspaceSurfaceController';

export function WorkspaceWorkbench({
  children,
  surface,
}: {
  children: ReactNode;
  surface: WorkspaceSurface;
}): ReactElement | null {
  if (surface.kind === 'none') return null;

  return (
    <aside
      className={`workspace-workbench is-${surface.kind}`}
      aria-label="Workspace workbench"
      data-workspace-surface={surface.kind}
    >
      {children}
    </aside>
  );
}
