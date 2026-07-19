import type { AnnotationMark, AnnotationPoint } from '../core/imageAnnotations';
import {
  annotationBrushStrokeWidthPixels,
  annotationMarkAnchor,
  clamp,
  normalizedBounds,
  strokeBySize,
} from './imageAnnotationGeometry';

export interface AnnotationComposite {
  dataUrl: string;
  width: number;
  height: number;
}

export async function createAnnotatedComposite(
  imageUrl: string,
  marks: AnnotationMark[],
): Promise<AnnotationComposite> {
  const image = await loadImage(imageUrl);
  const width = image.naturalWidth || 1024;
  const height = image.naturalHeight || 768;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create annotation canvas.');

  context.drawImage(image, 0, 0, width, height);
  for (const mark of marks) {
    drawMark(context, mark, width, height);
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
  };
}

function drawMark(
  context: CanvasRenderingContext2D,
  mark: AnnotationMark,
  width: number,
  height: number,
): void {
  context.save();
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = strokeBySize[mark.strokeSize] * Math.max(width, height) / 900;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (mark.kind === 'marker') {
    drawAnnotationLocationPin(context, mark.id, mark.point, width, height, mark.color);
  } else if (mark.kind === 'arrow') {
    drawCanvasArrow(context, scalePoint(mark.start, width, height), scalePoint(mark.end, width, height));
  } else if (mark.kind === 'pen' || mark.kind === 'brush') {
    if (mark.kind === 'brush') {
      context.globalAlpha = 0.38;
      context.lineWidth = annotationBrushStrokeWidthPixels(mark.strokeSize, width, height);
    }
    context.beginPath();
    mark.points.forEach((point, index) => {
      const scaled = scalePoint(point, width, height);
      if (index === 0) context.moveTo(scaled.x, scaled.y);
      else context.lineTo(scaled.x, scaled.y);
    });
    context.stroke();
  } else {
    const bounds = normalizedBounds(scalePoint(mark.start, width, height), scalePoint(mark.end, width, height));
    if (mark.kind === 'ellipse') {
      context.beginPath();
      context.ellipse(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        bounds.width / 2,
        bounds.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    } else {
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  context.restore();
  if (mark.kind !== 'marker') {
    drawAnnotationIdBadge(context, mark.id, annotationMarkAnchor(mark), width, height, mark.color);
  }
}

function drawAnnotationIdBadge(
  context: CanvasRenderingContext2D,
  id: string,
  anchor: AnnotationPoint,
  width: number,
  height: number,
  color: string,
): void {
  const fontSize = Math.max(16, Math.min(28, width / 42));
  const radius = fontSize * 1.12;
  const x = clamp(anchor.x * width, radius + 4, width - radius - 4);
  const y = clamp(anchor.y * height, radius + 4, height - radius - 4);
  context.save();
  context.fillStyle = color;
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(2, fontSize * 0.12);
  context.shadowColor = 'rgba(15, 23, 42, 0.28)';
  context.shadowBlur = fontSize * 0.35;
  context.shadowOffsetY = fontSize * 0.12;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowColor = 'transparent';
  context.fillStyle = '#ffffff';
  context.font = `850 ${id.length > 2 ? fontSize * 0.78 : fontSize}px Inter, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(id, x, y + fontSize * 0.04);
  context.restore();
}

function drawAnnotationLocationPin(
  context: CanvasRenderingContext2D,
  id: string,
  anchor: AnnotationPoint,
  width: number,
  height: number,
  color: string,
): void {
  const radius = Math.max(18, Math.min(32, width / 34));
  const tip = {
    x: clamp(anchor.x * width, radius + 4, width - radius - 4),
    y: clamp(anchor.y * height, radius * 2.9 + 4, height - 4),
  };
  const center = { x: tip.x, y: tip.y - radius * 1.7 };
  context.save();
  context.fillStyle = color;
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(2.5, radius * 0.12);
  context.lineJoin = 'round';
  context.shadowColor = 'rgba(15, 23, 42, 0.3)';
  context.shadowBlur = radius * 0.45;
  context.shadowOffsetY = radius * 0.18;
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(center.x - radius * 0.62, center.y + radius * 0.5);
  context.lineTo(center.x + radius * 0.62, center.y + radius * 0.5);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowColor = 'transparent';
  const fontSize = radius * (id.length > 2 ? 0.68 : 0.82);
  context.fillStyle = '#ffffff';
  context.font = `850 ${fontSize}px Inter, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(id, center.x, center.y + fontSize * 0.04);
  context.restore();
}

function drawCanvasArrow(
  context: CanvasRenderingContext2D,
  start: AnnotationPoint,
  end: AnnotationPoint,
): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(14, context.lineWidth * 4);

  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 6),
    end.y - headLength * Math.sin(angle - Math.PI / 6),
  );
  context.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 6),
    end.y - headLength * Math.sin(angle + Math.PI / 6),
  );
  context.closePath();
  context.fill();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('Could not load annotation source image.')));
    image.src = src;
  });
}

function scalePoint(point: AnnotationPoint, width: number, height: number): AnnotationPoint {
  return { x: point.x * width, y: point.y * height };
}
