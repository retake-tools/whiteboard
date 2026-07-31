import { getViewportForBounds, type Viewport } from '@xyflow/react';

interface CanvasFocusInput {
  bounds: { height: number; width: number; x: number; y: number };
  canvas: { height: number; width: number };
  maxZoom: number;
  minZoom: number;
  padding?: number;
}

const minimumStableCanvasWidth = 160;
const minimumStableCanvasHeight = 120;

export function safeViewportForBounds(input: CanvasFocusInput): Viewport | undefined {
  if (
    input.canvas.width < minimumStableCanvasWidth
    || input.canvas.height < minimumStableCanvasHeight
    || input.bounds.width <= 0
    || input.bounds.height <= 0
    || !valuesAreFinite([
      input.bounds.x,
      input.bounds.y,
      input.bounds.width,
      input.bounds.height,
      input.canvas.width,
      input.canvas.height,
      input.minZoom,
      input.maxZoom,
    ])
  ) return undefined;
  const viewport = getViewportForBounds(
    input.bounds,
    input.canvas.width,
    input.canvas.height,
    input.minZoom,
    input.maxZoom,
    input.padding ?? 0.2,
  );
  if (!valuesAreFinite([viewport.x, viewport.y, viewport.zoom]) || viewport.zoom <= 0) {
    return undefined;
  }
  return viewport;
}

function valuesAreFinite(values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}
