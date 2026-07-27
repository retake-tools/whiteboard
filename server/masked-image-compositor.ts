import sharp from 'sharp';

export interface MaskedImageCompositeResult {
  bytes: Buffer;
  height: number;
  width: number;
}

export async function compositeMaskedImage(input: {
  candidateBytes: Buffer;
  maskPath: string;
  sourcePath: string;
}): Promise<MaskedImageCompositeResult> {
  const source = await sharp(input.sourcePath)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = source.info;
  if (!width || !height) {
    throw new Error('Masked image source has no readable dimensions.');
  }

  const maskMetadata = await sharp(input.maskPath).rotate().metadata();
  const maskWidth = orientedWidth(maskMetadata);
  const maskHeight = orientedHeight(maskMetadata);
  if (maskWidth !== width || maskHeight !== height) {
    throw new Error(
      `Masked image input dimensions must match the source (${width}x${height}); received ${maskWidth}x${maskHeight}.`,
    );
  }

  const mask = await sharp(input.maskPath)
    .rotate()
    .flatten({ background: '#000000' })
    .greyscale()
    .raw()
    .toBuffer();
  const candidate = await sharp(input.candidateBytes)
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const output = Buffer.alloc(source.data.length);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const rgbaOffset = pixel * 4;
    const maskAlpha = mask[pixel] / 255;
    const candidateAlpha = candidate[rgbaOffset + 3] / 255;
    const sourceAlpha = source.data[rgbaOffset + 3] / 255;
    const editAlpha = maskAlpha * candidateAlpha;
    const outputAlpha = editAlpha + sourceAlpha * (1 - editAlpha);

    if (editAlpha === 0) {
      source.data.copy(output, rgbaOffset, rgbaOffset, rgbaOffset + 4);
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const color = outputAlpha === 0
        ? 0
        : (
          candidate[rgbaOffset + channel] * editAlpha
          + source.data[rgbaOffset + channel] * sourceAlpha * (1 - editAlpha)
        ) / outputAlpha;
      output[rgbaOffset + channel] = Math.round(color);
    }
    output[rgbaOffset + 3] = Math.round(outputAlpha * 255);
  }

  return {
    bytes: await sharp(output, {
      raw: { channels: 4, height, width },
    }).png().toBuffer(),
    height,
    width,
  };
}

function orientedWidth(metadata: sharp.Metadata): number | undefined {
  return swapsDimensions(metadata.orientation) ? metadata.height : metadata.width;
}

function orientedHeight(metadata: sharp.Metadata): number | undefined {
  return swapsDimensions(metadata.orientation) ? metadata.width : metadata.height;
}

function swapsDimensions(orientation: number | undefined): boolean {
  return orientation === 5
    || orientation === 6
    || orientation === 7
    || orientation === 8;
}
