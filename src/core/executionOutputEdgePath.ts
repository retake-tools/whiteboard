import { imageResultColumnGap } from './blockSizing';

export interface ExecutionOutputEdgePathInput {
  resultHeight: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  targetLeftGap?: number;
}

export interface EdgeObstacleBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface ExecutionOutputEdgeRoute {
  approachX: number;
  gutterX: number;
  laneSide: 'top' | 'bottom';
  laneY: number;
  path: string;
  targetBottomY: number;
  targetLeftX: number;
  targetLeftY: number;
  targetTopY: number;
}

const laneClearance = imageResultColumnGap;
const maximumCornerRadius = 18;
const defaultResultApproachOffset = Math.round(imageResultColumnGap * 3 / 8);
const minimumRoutableResultGap = 16;
const trunkOffset = 32;

export function shouldUseDirectExecutionOutputBezier(input: {
  obstacles: EdgeObstacleBounds[];
  sourceY: number;
  sourceX: number;
  targetY: number;
  targetX: number;
  targetLeftGap?: number;
}): boolean {
  const blocked = directBezierIntersectsObstacles(input);
  if (!blocked) return true;
  return input.targetLeftGap !== undefined && input.targetLeftGap < minimumRoutableResultGap;
}

export function resultApproachOffsetForGap(targetLeftGap?: number): number {
  if (targetLeftGap === undefined) return defaultResultApproachOffset;
  return clamp(Math.round(Math.max(0, targetLeftGap) * 3 / 8), 6, maximumCornerRadius);
}

export function targetLeftClearance(
  target: EdgeObstacleBounds,
  obstacles: EdgeObstacleBounds[],
): number | undefined {
  const gaps = obstacles.flatMap((obstacle) => {
    const verticallyOverlaps = obstacle.top < target.bottom && obstacle.bottom > target.top;
    if (!verticallyOverlaps || obstacle.left >= target.left) return [];
    return [Math.max(0, target.left - obstacle.right)];
  });
  return gaps.length ? Math.min(...gaps) : undefined;
}

export function directBezierIntersectsObstacles(input: {
  obstacles: EdgeObstacleBounds[];
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}): boolean {
  const controls = horizontalBezierControls(input);
  const pathBounds = {
    bottom: Math.max(input.sourceY, input.targetY, controls.sourceY, controls.targetY),
    left: Math.min(input.sourceX, input.targetX, controls.sourceX, controls.targetX),
    right: Math.max(input.sourceX, input.targetX, controls.sourceX, controls.targetX),
    top: Math.min(input.sourceY, input.targetY, controls.sourceY, controls.targetY),
  };
  const candidates = input.obstacles.filter((obstacle) => rectanglesOverlap(pathBounds, obstacle));
  if (!candidates.length) return false;

  for (let step = 1; step < 20; step += 1) {
    const point = cubicBezierPoint(input, controls, step / 20);
    if (candidates.some((obstacle) => pointInsideExpandedRect(point, obstacle, 4))) return true;
  }
  return false;
}

export function executionOutputEdgeRoute(input: ExecutionOutputEdgePathInput): ExecutionOutputEdgeRoute {
  const targetTopY = input.targetY - input.resultHeight / 2;
  const targetBottomY = input.targetY + input.resultHeight / 2;
  const targetLeftX = input.targetX;
  const gutterX = input.sourceX + direction(targetLeftX - input.sourceX) * trunkOffset;
  const resultApproachOffset = resultApproachOffsetForGap(input.targetLeftGap);
  const approachX = targetLeftX - direction(targetLeftX - gutterX) * resultApproachOffset;
  const topLaneY = targetTopY - laneClearance;
  const bottomLaneY = targetBottomY + laneClearance;
  const topLength = orthogonalRouteLength(input.sourceY, input.targetY, topLaneY);
  const bottomLength = orthogonalRouteLength(input.sourceY, input.targetY, bottomLaneY);
  const laneSide = topLength <= bottomLength ? 'top' : 'bottom';
  const laneY = laneSide === 'top' ? topLaneY : bottomLaneY;

  const sourceDirection = direction(gutterX - input.sourceX);
  const laneDirection = direction(laneY - input.sourceY);
  const targetDirection = direction(approachX - gutterX);
  const descentDirection = direction(input.targetY - laneY);
  const entryDirection = direction(targetLeftX - approachX);
  const sourceCornerRadius = Math.min(
    maximumCornerRadius,
    Math.abs(gutterX - input.sourceX) / 2,
    Math.abs(laneY - input.sourceY) / 2,
  );
  const laneCornerRadius = Math.min(
    maximumCornerRadius,
    Math.abs(laneY - input.sourceY) / 2,
    Math.abs(approachX - gutterX) / 2,
  );
  const approachCornerRadius = Math.min(
    maximumCornerRadius,
    Math.abs(approachX - gutterX) / 2,
    Math.abs(input.targetY - laneY) / 2,
  );
  const entryCornerRadius = Math.min(
    maximumCornerRadius,
    Math.abs(input.targetY - laneY) / 2,
    Math.abs(targetLeftX - approachX) / 2,
  );

  const path = [
    `M ${input.sourceX} ${input.sourceY}`,
    `L ${gutterX - sourceDirection * sourceCornerRadius} ${input.sourceY}`,
    `Q ${gutterX} ${input.sourceY}, ${gutterX} ${input.sourceY + laneDirection * sourceCornerRadius}`,
    `L ${gutterX} ${laneY - laneDirection * laneCornerRadius}`,
    `Q ${gutterX} ${laneY}, ${gutterX + targetDirection * laneCornerRadius} ${laneY}`,
    `L ${approachX - targetDirection * approachCornerRadius} ${laneY}`,
    `Q ${approachX} ${laneY}, ${approachX} ${laneY + descentDirection * approachCornerRadius}`,
    `L ${approachX} ${input.targetY - descentDirection * entryCornerRadius}`,
    `Q ${approachX} ${input.targetY}, ${approachX + entryDirection * entryCornerRadius} ${input.targetY}`,
    `L ${targetLeftX} ${input.targetY}`,
  ].join(' ');

  return {
    approachX,
    gutterX,
    laneSide,
    laneY,
    path,
    targetBottomY,
    targetLeftX,
    targetLeftY: input.targetY,
    targetTopY,
  };
}

function orthogonalRouteLength(sourceY: number, targetY: number, laneY: number): number {
  return Math.abs(laneY - sourceY) + Math.abs(targetY - laneY);
}

export function executionOutputEdgePath(input: ExecutionOutputEdgePathInput): string {
  return executionOutputEdgeRoute(input).path;
}

function direction(value: number): -1 | 1 {
  return value < 0 ? -1 : 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function horizontalBezierControls(input: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}): { sourceX: number; sourceY: number; targetX: number; targetY: number } {
  const distance = input.targetX - input.sourceX;
  const offset = distance >= 0 ? distance / 2 : 6.25 * Math.sqrt(-distance);
  return {
    sourceX: input.sourceX + offset,
    sourceY: input.sourceY,
    targetX: input.targetX - offset,
    targetY: input.targetY,
  };
}

function cubicBezierPoint(
  input: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  controls: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  t: number,
): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * input.sourceX +
      3 * inverse ** 2 * t * controls.sourceX +
      3 * inverse * t ** 2 * controls.targetX +
      t ** 3 * input.targetX,
    y:
      inverse ** 3 * input.sourceY +
      3 * inverse ** 2 * t * controls.sourceY +
      3 * inverse * t ** 2 * controls.targetY +
      t ** 3 * input.targetY,
  };
}

function rectanglesOverlap(left: EdgeObstacleBounds, right: EdgeObstacleBounds): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function pointInsideExpandedRect(
  point: { x: number; y: number },
  rect: EdgeObstacleBounds,
  padding: number,
): boolean {
  return point.x >= rect.left - padding && point.x <= rect.right + padding &&
    point.y >= rect.top - padding && point.y <= rect.bottom + padding;
}
