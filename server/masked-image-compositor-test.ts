import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { compositeMaskedImage } from './masked-image-compositor';

const directory = await mkdtemp(path.join(tmpdir(), 'retake-masked-composite-'));
try {
  const sourcePath = path.join(directory, 'source.png');
  const maskPath = path.join(directory, 'mask.png');
  const sourcePixels = Buffer.from([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
    100, 110, 120, 255,
  ]);
  await writeFile(sourcePath, await sharp(sourcePixels, {
    raw: { channels: 4, height: 2, width: 2 },
  }).png().toBuffer());
  await writeFile(maskPath, await sharp(Buffer.from([
    0, 255,
    128, 0,
  ]), {
    raw: { channels: 1, height: 2, width: 2 },
  }).png().toBuffer());
  const candidateBytes = await sharp({
    create: {
      background: { alpha: 1, b: 200, g: 150, r: 200 },
      channels: 4,
      height: 4,
      width: 4,
    },
  }).png().toBuffer();

  const composite = await compositeMaskedImage({
    candidateBytes,
    maskPath,
    sourcePath,
  });
  assert.equal(composite.width, 2);
  assert.equal(composite.height, 2);
  const output = await sharp(composite.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual(
    [...output.subarray(0, 4)],
    [...sourcePixels.subarray(0, 4)],
    'Black mask pixels must remain byte-for-byte equal to the decoded source.',
  );
  assert.deepEqual(
    [...output.subarray(4, 8)],
    [200, 150, 200, 255],
    'White mask pixels must use the generated candidate.',
  );
  assert.deepEqual(
    [...output.subarray(12, 16)],
    [...sourcePixels.subarray(12, 16)],
    'Every black mask region must remain unchanged.',
  );
  assert.ok(
    output[8] > sourcePixels[8] && output[8] < 200,
    'Grey mask pixels must blend source and candidate content.',
  );

  const mismatchedMaskPath = path.join(directory, 'mismatched-mask.png');
  await writeFile(mismatchedMaskPath, await sharp({
    create: {
      background: '#ffffff',
      channels: 3,
      height: 3,
      width: 3,
    },
  }).png().toBuffer());
  await assert.rejects(
    compositeMaskedImage({
      candidateBytes,
      maskPath: mismatchedMaskPath,
      sourcePath,
    }),
    /dimensions must match/,
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}

console.log('masked image compositor test passed');
