export const outpaintCapabilityId = 'image.outpaint';
export const outpaintMaskEncoding = 'grayscale_white_expand_v1';
export const outpaintMaxDimension = 4096;
export const outpaintMaxArea = 16_777_216;

export type OutpaintAspectPreset =
  | '1:1'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16';

export interface OutpaintParameters {
  aspectPreset: OutpaintAspectPreset;
  contractVersion: 1;
  guideHeight: number;
  guideWidth: number;
  maskEncoding: typeof outpaintMaskEncoding;
  sourceHeight: number;
  sourceWidth: number;
  sourceX: number;
  sourceY: number;
  targetHeight: number;
  targetWidth: number;
}

const aspectPresets = new Set<OutpaintAspectPreset>([
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
]);

export function readOutpaintParameters(
  value: unknown,
): OutpaintParameters {
  if (!isRecord(value)) {
    throw new Error('Outpaint parameters must be an object.');
  }
  const parameters: OutpaintParameters = {
    aspectPreset: readAspectPreset(value.aspectPreset),
    contractVersion: readContractVersion(value.contractVersion),
    guideHeight: readPositiveInteger(value.guideHeight, 'guideHeight'),
    guideWidth: readPositiveInteger(value.guideWidth, 'guideWidth'),
    maskEncoding: readMaskEncoding(value.maskEncoding),
    sourceHeight: readPositiveInteger(value.sourceHeight, 'sourceHeight'),
    sourceWidth: readPositiveInteger(value.sourceWidth, 'sourceWidth'),
    sourceX: readNonNegativeInteger(value.sourceX, 'sourceX'),
    sourceY: readNonNegativeInteger(value.sourceY, 'sourceY'),
    targetHeight: readPositiveInteger(value.targetHeight, 'targetHeight'),
    targetWidth: readPositiveInteger(value.targetWidth, 'targetWidth'),
  };
  assertOutpaintGeometry(parameters);
  return parameters;
}

export function assertOutpaintGeometry(
  parameters: OutpaintParameters,
): void {
  if (
    parameters.targetWidth > outpaintMaxDimension
    || parameters.targetHeight > outpaintMaxDimension
    || parameters.targetWidth * parameters.targetHeight > outpaintMaxArea
  ) {
    throw new Error(
      `Outpaint target must fit within ${outpaintMaxDimension}px per side and ${outpaintMaxArea} total pixels.`,
    );
  }
  if (
    parameters.guideWidth !== parameters.targetWidth
    || parameters.guideHeight !== parameters.targetHeight
  ) {
    throw new Error(
      'Outpaint guide dimensions must match the target canvas.',
    );
  }
  if (
    parameters.targetWidth < parameters.sourceWidth
    || parameters.targetHeight < parameters.sourceHeight
    || (
      parameters.targetWidth === parameters.sourceWidth
      && parameters.targetHeight === parameters.sourceHeight
    )
  ) {
    throw new Error(
      'Outpaint target must contain and extend the source image.',
    );
  }
  if (
    parameters.sourceX + parameters.sourceWidth > parameters.targetWidth
    || parameters.sourceY + parameters.sourceHeight > parameters.targetHeight
  ) {
    throw new Error(
      'Outpaint source rectangle must stay inside the target canvas.',
    );
  }
}

function readAspectPreset(value: unknown): OutpaintAspectPreset {
  if (
    typeof value !== 'string'
    || !aspectPresets.has(value as OutpaintAspectPreset)
  ) {
    throw new Error('Outpaint aspectPreset is unsupported.');
  }
  return value as OutpaintAspectPreset;
}

function readContractVersion(value: unknown): 1 {
  if (value !== 1) {
    throw new Error('Outpaint contractVersion must be 1.');
  }
  return 1;
}

function readMaskEncoding(
  value: unknown,
): typeof outpaintMaskEncoding {
  if (value !== outpaintMaskEncoding) {
    throw new Error(
      `Outpaint maskEncoding must be ${outpaintMaskEncoding}.`,
    );
  }
  return outpaintMaskEncoding;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`Outpaint ${field} must be a positive integer.`);
  }
  return value as number;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      `Outpaint ${field} must be a non-negative integer.`,
    );
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
