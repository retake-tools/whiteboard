export interface LocalImageAdjustments {
  [key: string]: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface RenderedLocalImage {
  dataUrl: string;
  height: number;
  width: number;
}

export function imageAdjustmentFilter(adjustments: LocalImageAdjustments): string {
  return [
    `brightness(${percentage(adjustments.brightness)}%)`,
    `contrast(${percentage(adjustments.contrast)}%)`,
    `saturate(${percentage(adjustments.saturation)}%)`,
  ].join(' ');
}

export function hasImageAdjustments(adjustments: LocalImageAdjustments): boolean {
  return adjustments.brightness !== 0 || adjustments.contrast !== 0 || adjustments.saturation !== 0;
}

export async function renderAdjustedImage(
  imageUrl: string,
  adjustments: LocalImageAdjustments,
): Promise<RenderedLocalImage> {
  const image = await loadImage(imageUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) throw new Error('The source image has no usable dimensions.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas image processing is unavailable in this browser.');

  context.filter = imageAdjustmentFilter(adjustments);
  context.drawImage(image, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    height,
    width,
  };
}

function percentage(value: number): number {
  return Math.max(0, Math.min(200, 100 + value));
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The source image could not be loaded for local processing.'));
    image.src = imageUrl;
  });
}
