import type { Viewport } from '@xyflow/react';
import type { BlockRecord } from './types';

export interface ViewportBasis {
  canvasWidth: number;
  canvasHeight: number;
}

export interface BoardViewState {
  schemaVersion: 1;
  projectId: string;
  boardId: string;
  viewport: Viewport;
  viewportBasis: ViewportBasis;
  updatedAt: string;
}

interface ViewStateStorage {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export const defaultBoardViewport: Viewport = { x: 0, y: 0, zoom: 1 };
export const minBoardZoom = 0.05;
export const maxBoardZoom = 5;

const boardViewStatePrefix = 'retake.whiteboard.boardViewState.v1';

export function loadBoardViewState(
  projectId: string,
  boardId: string,
  storage = browserStorage(),
): BoardViewState | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(boardViewStateKey(projectId, boardId));
    if (!raw) return undefined;
    return parseBoardViewState(JSON.parse(raw), projectId, boardId);
  } catch {
    return undefined;
  }
}

export function saveBoardViewState(
  state: BoardViewState,
  storage = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(boardViewStateKey(state.projectId, state.boardId), JSON.stringify(state));
  } catch {
    // Restricted previews can run without persisted view state.
  }
}

export function removeBoardViewState(
  projectId: string,
  boardId: string,
  storage = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(boardViewStateKey(projectId, boardId));
  } catch {
    // Restricted previews can run without persisted view state.
  }
}

export function removeProjectBoardViewStates(projectId: string, storage = browserStorage()): void {
  if (!storage) return;
  try {
    const projectKeyPrefix = `${boardViewStatePrefix}:${encodeURIComponent(projectId)}:`;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(projectKeyPrefix)));
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Restricted previews can run without persisted view state.
  }
}

export function adaptViewportToBasis(
  viewport: Viewport,
  savedBasis: ViewportBasis,
  nextBasis: ViewportBasis,
  minZoom = minBoardZoom,
  maxZoom = maxBoardZoom,
): Viewport {
  const savedZoom = viewport.zoom;
  const zoom = clamp(savedZoom, minZoom, maxZoom);
  const centerX = (savedBasis.canvasWidth / 2 - viewport.x) / savedZoom;
  const centerY = (savedBasis.canvasHeight / 2 - viewport.y) / savedZoom;
  return {
    x: nextBasis.canvasWidth / 2 - centerX * zoom,
    y: nextBasis.canvasHeight / 2 - centerY * zoom,
    zoom,
  };
}

export function viewportShowsAnyBlock(
  viewport: Viewport,
  basis: ViewportBasis,
  blocks: readonly BlockRecord[],
): boolean {
  if (blocks.length === 0) return true;
  const zoom = viewport.zoom;
  if (!Number.isFinite(zoom) || zoom <= 0) return false;
  const visible = {
    left: -viewport.x / zoom,
    right: (basis.canvasWidth - viewport.x) / zoom,
    top: -viewport.y / zoom,
    bottom: (basis.canvasHeight - viewport.y) / zoom,
  };
  return blocks.some((block) =>
    block.position.x < visible.right &&
    block.position.x + block.size.width > visible.left &&
    block.position.y < visible.bottom &&
    block.position.y + block.size.height > visible.top,
  );
}

export function viewportBasisFromElement(element: HTMLElement | null): ViewportBasis {
  const bounds = element?.getBoundingClientRect();
  return {
    canvasWidth: Math.max(1, bounds?.width ?? window.innerWidth),
    canvasHeight: Math.max(1, bounds?.height ?? window.innerHeight),
  };
}

function parseBoardViewState(value: unknown, projectId: string, boardId: string): BoardViewState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Partial<BoardViewState>;
  if (
    state.schemaVersion !== 1 ||
    state.projectId !== projectId ||
    state.boardId !== boardId ||
    !isFiniteViewport(state.viewport) ||
    !isFiniteBasis(state.viewportBasis) ||
    typeof state.updatedAt !== 'string'
  ) return undefined;
  return state as BoardViewState;
}

function isFiniteViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== 'object') return false;
  const viewport = value as Partial<Viewport>;
  return Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.zoom) && viewport.zoom! > 0;
}

function isFiniteBasis(value: unknown): value is ViewportBasis {
  if (!value || typeof value !== 'object') return false;
  const basis = value as Partial<ViewportBasis>;
  return Number.isFinite(basis.canvasWidth) && basis.canvasWidth! > 0 && Number.isFinite(basis.canvasHeight) && basis.canvasHeight! > 0;
}

function boardViewStateKey(projectId: string, boardId: string): string {
  return `${boardViewStatePrefix}:${encodeURIComponent(projectId)}:${encodeURIComponent(boardId)}`;
}

function browserStorage(): ViewStateStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
