import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  compositeOutpaintImage,
  validateOutpaintImageInputs,
} from './outpaint-image-compositor';

const directory = await mkdtemp(
  path.join(tmpdir(), 'retake-outpaint-compositor-'),
);

try {
  const sourcePath = path.join(directory, 'source.png');
  const guidePath = path.join(directory, 'guide.png');
  const maskPath = path.join(directory, 'mask.png');
  const sourcePixels = Buffer.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]);
  await writeFile(
    sourcePath,
    await sharp(sourcePixels, {
      raw: { channels: 4, height: 2, width: 2 },
    }).png().toBuffer(),
  );
  const guidePixels = Buffer.alloc(4 * 2 * 4);
  copyRect(sourcePixels, guidePixels, {
    sourceHeight: 2,
    sourceWidth: 2,
    sourceX: 1,
    sourceY: 0,
    targetWidth: 4,
  });
  await writeFile(
    guidePath,
    await sharp(guidePixels, {
      raw: { channels: 4, height: 2, width: 4 },
    }).png().toBuffer(),
  );
  const maskPixels = Buffer.from([
    255, 0, 0, 255,
    255, 0, 0, 255,
  ]);
  await writeFile(
    maskPath,
    await sharp(maskPixels, {
      raw: { channels: 1, height: 2, width: 4 },
    }).png().toBuffer(),
  );
  const parameters = {
    aspectPreset: '16:9',
    contractVersion: 1,
    guideHeight: 2,
    guideWidth: 4,
    maskEncoding: 'grayscale_white_expand_v1',
    sourceHeight: 2,
    sourceWidth: 2,
    sourceX: 1,
    sourceY: 0,
    targetHeight: 2,
    targetWidth: 4,
  };
  assert.deepEqual(
    await validateOutpaintImageInputs({
      guidePath,
      maskPath,
      parameters,
      sourcePath,
    }),
    parameters,
  );

  const candidateBytes = await sharp({
    create: {
      background: { alpha: 1, b: 240, g: 120, r: 20 },
      channels: 4,
      height: 1,
      width: 2,
    },
  }).png().toBuffer();
  const composite = await compositeOutpaintImage({
    candidateBytes,
    parameters,
    sourcePath,
  });
  assert.equal(composite.width, 4);
  assert.equal(composite.height, 2);
  const output = await sharp(composite.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual(pixel(output, 4, 1, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(output, 4, 2, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(output, 4, 1, 1), [0, 0, 255, 255]);
  assert.deepEqual(pixel(output, 4, 2, 1), [255, 255, 0, 255]);
  assert.deepEqual(pixel(output, 4, 0, 0), [20, 120, 240, 255]);
  assert.deepEqual(pixel(output, 4, 3, 1), [20, 120, 240, 255]);

  const invalidMaskPath = path.join(directory, 'invalid-mask.png');
  await writeFile(
    invalidMaskPath,
    await sharp({
      create: {
        background: '#ffffff',
        channels: 3,
        height: 2,
        width: 4,
      },
    }).png().toBuffer(),
  );
  await assert.rejects(
    validateOutpaintImageInputs({
      guidePath,
      maskPath: invalidMaskPath,
      parameters,
      sourcePath,
    }),
    /black inside the source rectangle/,
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}

function copyRect(
  source: Buffer,
  target: Buffer,
  input: {
    sourceHeight: number;
    sourceWidth: number;
    sourceX: number;
    sourceY: number;
    targetWidth: number;
  },
): void {
  const rowBytes = input.sourceWidth * 4;
  for (let y = 0; y < input.sourceHeight; y += 1) {
    source.copy(
      target,
      ((input.sourceY + y) * input.targetWidth + input.sourceX) * 4,
      y * rowBytes,
      (y + 1) * rowBytes,
    );
  }
}

function pixel(
  bytes: Buffer,
  width: number,
  x: number,
  y: number,
): number[] {
  const offset = (y * width + x) * 4;
  return [...bytes.subarray(offset, offset + 4)];
}
