import sharp from 'sharp';
import {
  readOutpaintParameters,
  type OutpaintParameters,
} from '../src/core/outpaintContracts';

export interface OutpaintImageCompositeResult {
  bytes: Buffer;
  height: number;
  width: number;
}

export async function validateOutpaintImageInputs(input: {
  guidePath: string;
  maskPath: string;
  parameters: unknown;
  sourcePath: string;
}): Promise<OutpaintParameters> {
  const parameters = readOutpaintParameters(input.parameters);
  const [source, guide, maskMetadata] = await Promise.all([
    readCanonicalRgba(input.sourcePath),
    readCanonicalRgba(input.guidePath),
    sharp(input.maskPath).rotate().metadata(),
  ]);
  assertDimensions(
    'source',
    source.width,
    source.height,
    parameters.sourceWidth,
    parameters.sourceHeight,
  );
  assertDimensions(
    'guide',
    guide.width,
    guide.height,
    parameters.guideWidth,
    parameters.guideHeight,
  );
  if (maskMetadata.format !== 'png') {
    throw new Error('Outpaint mask must be a PNG image.');
  }
  assertDimensions(
    'mask',
    orientedWidth(maskMetadata),
    orientedHeight(maskMetadata),
    parameters.guideWidth,
    parameters.guideHeight,
  );
  assertGuidePixels(guide.data, parameters);
  const mask = await sharp(input.maskPath)
    .rotate()
    .flatten({ background: '#000000' })
    .greyscale()
    .raw()
    .toBuffer();
  assertMaskPixels(mask, parameters);
  return parameters;
}

export async function compositeOutpaintImage(input: {
  candidateBytes: Buffer;
  parameters: unknown;
  sourcePath: string;
}): Promise<OutpaintImageCompositeResult> {
  const parameters = readOutpaintParameters(input.parameters);
  const source = await readCanonicalRgba(input.sourcePath);
  assertDimensions(
    'source',
    source.width,
    source.height,
    parameters.sourceWidth,
    parameters.sourceHeight,
  );
  const candidate = await sharp(input.candidateBytes)
    .rotate()
    .resize(parameters.targetWidth, parameters.targetHeight, {
      fit: 'fill',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.from(candidate.data);
  const sourceRowBytes = parameters.sourceWidth * 4;
  for (let sourceY = 0; sourceY < parameters.sourceHeight; sourceY += 1) {
    const sourceOffset = sourceY * sourceRowBytes;
    const targetOffset = (
      (parameters.sourceY + sourceY) * parameters.targetWidth
      + parameters.sourceX
    ) * 4;
    source.data.copy(
      output,
      targetOffset,
      sourceOffset,
      sourceOffset + sourceRowBytes,
    );
  }
  return {
    bytes: await sharp(output, {
      raw: {
        channels: 4,
        height: parameters.targetHeight,
        width: parameters.targetWidth,
      },
    }).png().toBuffer(),
    height: parameters.targetHeight,
    width: parameters.targetWidth,
  };
}

async function readCanonicalRgba(path: string): Promise<{
  data: Buffer;
  height: number;
  width: number;
}> {
  const result = await sharp(path)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!result.info.width || !result.info.height) {
    throw new Error('Outpaint image has no readable dimensions.');
  }
  return {
    data: result.data,
    height: result.info.height,
    width: result.info.width,
  };
}

function assertGuidePixels(
  guide: Buffer,
  parameters: OutpaintParameters,
): void {
  for (let y = 0; y < parameters.targetHeight; y += 1) {
    for (let x = 0; x < parameters.targetWidth; x += 1) {
      const guideOffset = (y * parameters.targetWidth + x) * 4;
      const inside = x >= parameters.sourceX
        && y >= parameters.sourceY
        && x < parameters.sourceX + parameters.sourceWidth
        && y < parameters.sourceY + parameters.sourceHeight;
      if (!inside && guide[guideOffset + 3] !== 0) {
        throw new Error(
          'Outpaint guide must be transparent outside the source rectangle.',
        );
      }
    }
  }
}

function assertMaskPixels(
  mask: Buffer,
  parameters: OutpaintParameters,
): void {
  for (let y = 0; y < parameters.targetHeight; y += 1) {
    for (let x = 0; x < parameters.targetWidth; x += 1) {
      const inside = x >= parameters.sourceX
        && y >= parameters.sourceY
        && x < parameters.sourceX + parameters.sourceWidth
        && y < parameters.sourceY + parameters.sourceHeight;
      const expected = inside ? 0 : 255;
      if (mask[y * parameters.targetWidth + x] !== expected) {
        throw new Error(
          'Outpaint mask must be black inside the source rectangle and white outside it.',
        );
      }
    }
  }
}

function assertDimensions(
  label: string,
  width: number | undefined,
  height: number | undefined,
  expectedWidth: number,
  expectedHeight: number,
): void {
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `Outpaint ${label} dimensions must be ${expectedWidth}x${expectedHeight}; received ${width ?? 0}x${height ?? 0}.`,
    );
  }
}

function orientedWidth(metadata: sharp.Metadata): number | undefined {
  return swapsDimensions(metadata.orientation)
    ? metadata.height
    : metadata.width;
}

function orientedHeight(metadata: sharp.Metadata): number | undefined {
  return swapsDimensions(metadata.orientation)
    ? metadata.width
    : metadata.height;
}

function swapsDimensions(orientation: number | undefined): boolean {
  return orientation === 5
    || orientation === 6
    || orientation === 7
    || orientation === 8;
}
