import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import {
  reduceWorkspaceSurface,
  type WorkspaceSurface,
} from '../src/app/useWorkspaceSurfaceController';
import { WorkspaceShell } from '../src/components/WorkspaceShell';
import { WorkspaceSidebar } from '../src/components/WorkspaceSidebar';
import { WorkspaceWorkbench } from '../src/components/WorkspaceWorkbench';
import { boardThumbnailUrl, projectIdentity } from '../src/components/WorkspaceBoardSwitcher';
import type { WorkspaceSummary } from '../src/core/types';
import { I18nProvider } from '../src/i18n';
import { renderBoardThumbnail } from './board-thumbnail-service';
import { defaultSnapshot } from '../src/core/sampleBoard';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'zh',
    setItem: () => undefined,
  },
});

let surface: WorkspaceSurface = { kind: 'none' };
surface = reduceWorkspaceSurface(surface, {
  type: 'set-workbench',
  kind: 'history',
  open: true,
});
assert.equal(surface.kind, 'history');
surface = reduceWorkspaceSurface(surface, {
  type: 'set-workbench',
  kind: 'agent',
  open: true,
});
assert.equal(surface.kind, 'agent');
surface = reduceWorkspaceSurface(surface, {
  type: 'set-inspector',
  blockId: 'block_inspector',
});
assert.deepEqual(surface, { kind: 'inspector', blockId: 'block_inspector' });
surface = reduceWorkspaceSurface(surface, {
  type: 'set-workbench',
  kind: 'history',
  open: false,
});
assert.deepEqual(surface, { kind: 'inspector', blockId: 'block_inspector' });
surface = reduceWorkspaceSurface(surface, { type: 'set-inspector' });
assert.equal(surface.kind, 'none');

const workspace: WorkspaceSummary = {
  defaultProjectId: 'project_current',
  projects: [{
    projectId: 'project_current',
    name: '商品图项目',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    defaultBoardId: 'board_current',
    boards: [{
      boardId: 'board_current',
      projectId: 'project_current',
      name: '商品海报',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    }],
  }],
};

const sidebarMarkup = renderToStaticMarkup(
  <I18nProvider>
    <WorkspaceSidebar
      artifactLibraryOpen={false}
      collapsed={false}
      currentBoardId="board_current"
      currentProjectId="project_current"
      historyOpen={false}
      workspace={workspace}
      onCreateBoard={() => undefined}
      onCreateProject={() => undefined}
      onOpenArtifactLibrary={() => undefined}
      onOpenHistory={() => undefined}
      onOpenSettings={() => undefined}
      onRenameBoard={() => undefined}
      onSelectBoard={() => undefined}
      onToggleCollapsed={() => undefined}
    />
  </I18nProvider>,
);
assert.match(sidebarMarkup, /Retake Whiteboard/);
assert.match(sidebarMarkup, /商品图项目/);
assert.match(sidebarMarkup, /商品海报/);
assert.match(sidebarMarkup, /aria-current="page"/);
assert.match(sidebarMarkup, /aria-controls="workspace-project-list"/);
assert.match(sidebarMarkup, /Local workspace/);
assert.doesNotMatch(sidebarMarkup, /Token|Plan|登录|Sign in/);
assert.equal(projectIdentity('Retake Demo'), 'RD');
assert.equal(projectIdentity('商品图项目'), '商');

const thumbnailMetadata = await sharp(await renderBoardThumbnail(structuredClone(defaultSnapshot))).metadata();
assert.equal(thumbnailMetadata.format, 'webp');
assert.equal(thumbnailMetadata.width, 168);
assert.equal(thumbnailMetadata.height, 136);

const collapsedSidebarMarkup = renderToStaticMarkup(
  <I18nProvider>
    <WorkspaceSidebar
      artifactLibraryOpen={false}
      collapsed
      currentBoardId="board_current"
      currentProjectId="project_current"
      historyOpen={false}
      workspace={workspace}
      onCreateBoard={() => undefined}
      onCreateProject={() => undefined}
      onOpenArtifactLibrary={() => undefined}
      onOpenHistory={() => undefined}
      onOpenSettings={() => undefined}
      onRenameBoard={() => undefined}
      onSelectBoard={() => undefined}
      onToggleCollapsed={() => undefined}
    />
  </I18nProvider>,
);
assert.match(collapsedSidebarMarkup, /workspace-sidebar-rail/);
assert.match(collapsedSidebarMarkup, /aria-label="商品图项目"/);
assert.match(collapsedSidebarMarkup, /lucide-library/);
assert.doesNotMatch(collapsedSidebarMarkup, /商品海报/);
assert.equal(
  boardThumbnailUrl(workspace.projects[0].boards[0]),
  '/api/local/boards/project_current/board_current/thumbnail.webp?revision=2026-08-14T00%3A00%3A00.000Z',
);

const shellMarkup = renderToStaticMarkup(
  <WorkspaceShell
    hasWorkbench
    sidebar={({ collapsed, onToggleCollapsed }) => (
      <button type="button" data-collapsed={collapsed} onClick={onToggleCollapsed}>Sidebar</button>
    )}
  >
    <div data-canvas-slot="true">Canvas</div>
    <WorkspaceWorkbench surface={{ kind: 'history' }}>
      <section>History</section>
    </WorkspaceWorkbench>
  </WorkspaceShell>,
);
assert.match(shellMarkup, /data-workspace-shell="v0"/);
assert.match(shellMarkup, /has-workbench/);
assert.match(shellMarkup, /data-canvas-slot="true"/);
assert.match(shellMarkup, /data-workspace-surface="history"/);

const [appSource, sidebarSource, shellCss, railCss, pluginPanelSource] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/WorkspaceSidebar.tsx', 'utf8'),
  readFile('src/components/workspace-shell.css', 'utf8'),
  readFile('src/components/workspace-sidebar-rail.css', 'utf8'),
  readFile('src/components/PluginPanelHost.tsx', 'utf8'),
]);
assert.match(appSource, /useWorkspaceSurfaceController/);
assert.match(appSource, /<WorkspaceShell/);
assert.match(appSource, /<WorkspaceWorkbench surface=\{workspaceSurface\}>/);
assert.match(appSource, /workspaceSurface\.kind === 'artifact'/);
assert.match(appSource, /workspaceSurface\.kind === 'history'/);
assert.match(appSource, /workspaceSurface\.kind === 'agent'/);
assert.match(appSource, /<WhiteboardCanvas/);
assert.match(appSource, /<PluginPanelHost/);
assert.match(sidebarSource, /workspace-sidebar-brand[\s\S]*workspace-sidebar-collapse/);
assert.doesNotMatch(sidebarSource, /Token|Plan|Sign in|登录/);
assert.match(shellCss, /grid-template-columns: var\(--workspace-sidebar-width\) minmax\(0, 1fr\)/);
assert.match(shellCss, /--workspace-sidebar-width: 48px/);
assert.match(railCss, /\.workspace-board-switcher/);
assert.match(railCss, /\.workspace-sidebar-rail \{[\s\S]*height: 100%/);
assert.match(railCss, /\.workspace-sidebar-rail-footer \{[\s\S]*align-self: end/);
assert.match(shellCss, /\.workspace-shell\.has-workbench \.workspace-shell-stage/);
assert.match(
  shellCss,
  /\.workspace-shell\.has-workbench \.workspace-shell-stage > \.skill-composer:not\(\.is-agent-workspace\)/,
);
assert.match(shellCss, /left: calc\(\(100% - var\(--workspace-workbench-width\)\) \/ 2\)/);
assert.match(shellCss, /width: min\(720px, calc\(100% - var\(--workspace-workbench-width\) - 32px\)\)/);
assert.match(
  shellCss,
  /@media \(max-width: 960px\)[\s\S]*\.workspace-shell\.has-workbench \.workspace-shell-stage > \.skill-composer:not\(\.is-agent-workspace\) \{[\s\S]*display: none/,
);
assert.match(pluginPanelSource, /\.workspace-sidebar/);
assert.match(pluginPanelSource, /\.workspace-workbench/);

console.log(JSON.stringify({
  canvasAuthorityPreserved: true,
  collapsedNavigationAccessible: true,
  hostedSemanticsExcluded: true,
  pluginOverlayInsetAware: true,
  singleWorkspaceSurface: true,
  workbenchConditional: true,
}));
