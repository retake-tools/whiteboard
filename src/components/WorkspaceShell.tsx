import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

const sidebarPreferenceKey = 'retake.workspace-sidebar-collapsed.v1';

export function WorkspaceShell({
  sidebar,
  children,
  focusEditorOpen = false,
  hasWorkbench,
  pageOpen = false,
  workbenchMode = 'compact',
}: {
  sidebar: (options: {
    collapsed: boolean;
    onToggleCollapsed: () => void;
  }) => ReactNode;
  children: ReactNode;
  focusEditorOpen?: boolean;
  hasWorkbench: boolean;
  pageOpen?: boolean;
  workbenchMode?: 'compact' | 'wide';
}): ReactElement {
  const [collapsed, setCollapsed] = useState(readSidebarPreference);

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarPreferenceKey, collapsed ? 'true' : 'false');
    } catch {
      // The navigation remains usable when browser preferences are unavailable.
    }
  }, [collapsed]);

  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 1279px)');
    const collapseForCompactViewport = (): void => {
      if (compactViewport.matches) setCollapsed(true);
    };
    collapseForCompactViewport();
    compactViewport.addEventListener('change', collapseForCompactViewport);
    return () => compactViewport.removeEventListener('change', collapseForCompactViewport);
  }, []);

  return (
    <main
      className={`app-shell workspace-shell${collapsed ? ' is-sidebar-collapsed' : ''}${hasWorkbench ? ` has-workbench is-workbench-${workbenchMode}` : ''}${pageOpen ? ' is-page' : ''}${focusEditorOpen ? ' is-focus-editor' : ''}`}
      data-workspace-shell="v0"
    >
      {sidebar({
        collapsed,
        onToggleCollapsed: () => setCollapsed((current) => !current),
      })}
      <div className="workspace-shell-stage">{children}</div>
    </main>
  );
}

function readSidebarPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(sidebarPreferenceKey) === 'true';
  } catch {
    return false;
  }
}
