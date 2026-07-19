import type { PointerEvent, ReactElement } from 'react';
import type {
  AnnotationMark,
  AnnotationPoint,
  AnnotationStrokeSize,
} from '../core/imageAnnotations';
import {
  annotationMarkAnchor,
  clamp,
  normalizedBounds,
  strokeBySize,
} from './imageAnnotationGeometry';

export type EndpointHandle = 'start' | 'end' | 'startXEndY' | 'endXStartY';

const endpointHandleRadiusBySize = {
  xs: 0.0065,
  s: 0.0075,
  m: 0.0085,
  l: 0.01,
  xl: 0.012,
} satisfies Record<AnnotationStrokeSize, number>;

export function AnnotationSvgMark({
  brushStrokeWidth,
  fixedShapeYScale,
  mark,
  onEndpointPointerDown,
  onPointerDown,
  selected,
}: {
  brushStrokeWidth: number;
  fixedShapeYScale: number;
  mark: AnnotationMark;
  onEndpointPointerDown: (event: PointerEvent, endpoint: EndpointHandle) => void;
  onPointerDown: (event: PointerEvent) => void;
  selected: boolean;
}): ReactElement | null {
  const screenStrokeWidth = strokeBySize[mark.strokeSize];
  const className = `annotation-svg-mark${selected ? ' is-selected' : ''}`;

  if (mark.kind === 'marker') {
    return (
      <g
        className={`${className} annotation-location-pin`}
        data-annotation-mark-id={mark.id}
        transform={`translate(${mark.point.x} ${mark.point.y}) scale(1 ${fixedShapeYScale})`}
        onPointerDown={onPointerDown}
      >
        {selected ? (
          <path
            className="annotation-marker-selection-outline"
            d="M 0 0 C -0.009 -0.014 -0.027 -0.028 -0.027 -0.047 A 0.027 0.027 0 1 1 0.027 -0.047 C 0.027 -0.028 0.009 -0.014 0 0 Z"
          />
        ) : null}
        <path
          d="M 0 0 C -0.009 -0.014 -0.027 -0.028 -0.027 -0.047 A 0.027 0.027 0 1 1 0.027 -0.047 C 0.027 -0.028 0.009 -0.014 0 0 Z"
          fill={mark.color}
          stroke="#ffffff"
          strokeLinejoin="round"
          strokeWidth={0.004}
        />
        <text
          x={0}
          y={-0.04}
          fill="#ffffff"
          fontSize={mark.id.length > 2 ? 0.016 : 0.019}
          fontWeight={850}
          textAnchor="middle"
        >
          {mark.id}
        </text>
      </g>
    );
  }

  if (mark.kind === 'arrow') {
    const handleRadius = endpointHandleRadiusBySize[mark.strokeSize];

    return (
      <g className={className} data-annotation-mark-id={mark.id} onPointerDown={onPointerDown}>
        {selected ? (
          <line
            className="annotation-selection-halo"
            x1={mark.start.x}
            x2={mark.end.x}
            y1={mark.start.y}
            y2={mark.end.y}
            strokeWidth={screenStrokeWidth + 4}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <line
          x1={mark.start.x}
          x2={mark.end.x}
          y1={mark.start.y}
          y2={mark.end.y}
          stroke={mark.color}
          strokeLinecap="round"
          strokeWidth={screenStrokeWidth}
          vectorEffect="non-scaling-stroke"
          markerEnd={`url(#annotation-arrowhead-${mark.color.slice(1)})`}
        />
        <line
          x1={mark.start.x}
          x2={mark.end.x}
          y1={mark.start.y}
          y2={mark.end.y}
          className="annotation-line-hitbox"
          pointerEvents="stroke"
          vectorEffect="non-scaling-stroke"
        />
        {selected ? (
          <>
            <ellipse
              className="annotation-endpoint-handle"
              cx={mark.start.x}
              cy={mark.start.y}
              rx={handleRadius}
              ry={handleRadius * fixedShapeYScale}
              fill="#ffffff"
              onPointerDown={(event) => onEndpointPointerDown(event, 'start')}
            />
            <ellipse
              className="annotation-endpoint-handle"
              cx={mark.end.x}
              cy={mark.end.y}
              rx={handleRadius}
              ry={handleRadius * fixedShapeYScale}
              fill="#ffffff"
              onPointerDown={(event) => onEndpointPointerDown(event, 'end')}
            />
          </>
        ) : null}
      </g>
    );
  }

  if (mark.kind === 'pen' || mark.kind === 'brush') {
    const markStrokeWidth = mark.kind === 'brush' ? brushStrokeWidth : screenStrokeWidth;
    const points = mark.points.map((point) => `${point.x},${point.y}`).join(' ');
    return (
      <g className={className} data-annotation-mark-id={mark.id} onPointerDown={onPointerDown}>
        {selected ? (
          <polyline
            className="annotation-selection-halo"
            points={points}
            fill="none"
            strokeWidth={markStrokeWidth + 4}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <polyline
          points={points}
          fill="none"
          stroke={mark.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={markStrokeWidth}
          vectorEffect="non-scaling-stroke"
          opacity={mark.kind === 'brush' ? 0.38 : 1}
        />
        <polyline
          className="annotation-line-hitbox"
          points={points}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  if (mark.kind === 'rect' || mark.kind === 'ellipse') {
    const bounds = normalizedBounds(mark.start, mark.end);
    if (mark.kind === 'ellipse') {
      return (
        <g className={className} data-annotation-mark-id={mark.id} onPointerDown={onPointerDown}>
          {selected ? (
            <ellipse
              className="annotation-selection-halo"
              cx={bounds.x + bounds.width / 2}
              cy={bounds.y + bounds.height / 2}
              rx={bounds.width / 2}
              ry={bounds.height / 2}
              strokeWidth={screenStrokeWidth + 4}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <ellipse
            cx={bounds.x + bounds.width / 2}
            cy={bounds.y + bounds.height / 2}
            rx={bounds.width / 2}
            ry={bounds.height / 2}
            fill="none"
            stroke={mark.color}
            strokeWidth={screenStrokeWidth}
            pointerEvents="stroke"
            vectorEffect="non-scaling-stroke"
          />
          <ellipse
            className="annotation-shape-hitbox"
            cx={bounds.x + bounds.width / 2}
            cy={bounds.y + bounds.height / 2}
            rx={bounds.width / 2}
            ry={bounds.height / 2}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    }

    const handleRadius = endpointHandleRadiusBySize[mark.strokeSize];
    const corners: Array<{ endpoint: EndpointHandle; point: AnnotationPoint }> = [
      { endpoint: 'start', point: mark.start },
      { endpoint: 'end', point: mark.end },
      { endpoint: 'startXEndY', point: { x: mark.start.x, y: mark.end.y } },
      { endpoint: 'endXStartY', point: { x: mark.end.x, y: mark.start.y } },
    ];
    return (
      <g className={className} data-annotation-mark-id={mark.id} onPointerDown={onPointerDown}>
        {selected ? (
          <rect
            className="annotation-selection-halo"
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            strokeWidth={screenStrokeWidth + 4}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill="none"
          stroke={mark.color}
          strokeWidth={screenStrokeWidth}
          pointerEvents="stroke"
          vectorEffect="non-scaling-stroke"
        />
        <rect
          className="annotation-shape-hitbox"
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        {selected ? corners.map((corner) => (
          <ellipse
            key={corner.endpoint}
            className="annotation-endpoint-handle"
            cx={corner.point.x}
            cy={corner.point.y}
            rx={handleRadius}
            ry={handleRadius * fixedShapeYScale}
            fill="#ffffff"
            onPointerDown={(event) => onEndpointPointerDown(event, corner.endpoint)}
          />
        )) : null}
      </g>
    );
  }

  return null;
}

export function AnnotationIdBadge({
  fixedShapeYScale,
  mark,
  onPointerDown,
  selected,
}: {
  fixedShapeYScale: number;
  mark: AnnotationMark;
  onPointerDown: (event: PointerEvent) => void;
  selected: boolean;
}): ReactElement | null {
  if (mark.kind === 'marker') return null;
  const anchor = annotationMarkAnchor(mark);
  return (
    <g
      className={`annotation-id-badge${selected ? ' is-selected' : ''}`}
      data-annotation-mark-id={mark.id}
      transform={`translate(${anchor.x} ${anchor.y}) scale(1 ${fixedShapeYScale})`}
      onPointerDown={onPointerDown}
    >
      {selected ? <circle className="annotation-selection-ring" cx={0} cy={0} r={0.029} /> : null}
      <circle cx={0} cy={0} r={0.023} fill={mark.color} stroke="#ffffff" strokeWidth={0.004} />
      <text
        x={0}
        y={0.006}
        fill="#ffffff"
        fontSize={mark.id.length > 2 ? 0.016 : 0.019}
        fontWeight={850}
        textAnchor="middle"
      >
        {mark.id}
      </text>
    </g>
  );
}

export function AnnotationQuickDelete({
  fixedShapeYScale,
  mark,
  onPointerDown,
}: {
  fixedShapeYScale: number;
  mark: AnnotationMark;
  onPointerDown: (event: PointerEvent) => void;
}): ReactElement {
  const badgeCenter = annotationMarkBadgeCenter(mark);
  const radius = 0.014;
  const anchor = {
    x: clamp(badgeCenter.x - 0.018, radius, 1 - radius),
    y: clamp(
      badgeCenter.y - 0.018 * fixedShapeYScale,
      radius * fixedShapeYScale,
      1 - radius * fixedShapeYScale,
    ),
  };
  return (
    <g
      className="annotation-quick-delete"
      data-annotation-mark-id={mark.id}
      onPointerDown={onPointerDown}
    >
      <ellipse cx={anchor.x} cy={anchor.y} rx={radius} ry={radius * fixedShapeYScale} />
      <line
        x1={anchor.x - 0.006}
        x2={anchor.x + 0.006}
        y1={anchor.y}
        y2={anchor.y}
      />
    </g>
  );
}

function annotationMarkBadgeCenter(mark: AnnotationMark): AnnotationPoint {
  if (mark.kind === 'marker') return { x: mark.point.x, y: mark.point.y - 0.04 };
  return annotationMarkAnchor(mark);
}
