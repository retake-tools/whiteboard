import { gunzipSync, gzipSync } from 'node:zlib';
import {
  declarativePackageManifestFile,
  declarativePackageMaxFileBytes,
  declarativePackageMaxFileCount,
  declarativePackageMaxTotalBytes,
  isPortablePackagePath,
} from '../src/core/declarativePackageContracts';

const tarBlockBytes = 512;
const maximumArchiveBytes = declarativePackageMaxTotalBytes + 8 * 1024 * 1024;

export function createDeterministicPackageArchive(entries: Map<string, Buffer>): Buffer {
  const tar = createTar(entries);
  const archive = gzipSync(tar, { level: 9 });
  archive.writeUInt32LE(0, 4);
  archive[9] = 0xff;
  return archive;
}

export function readDeterministicPackageArchive(archive: Buffer): Map<string, Buffer> {
  if (archive.byteLength > maximumArchiveBytes) throw new Error('Package archive exceeds the size limit.');
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: maximumArchiveBytes });
  } catch (error) {
    throw new Error(`Package archive gzip is invalid: ${errorMessage(error)}`);
  }
  return parseTar(tar);
}

function createTar(entries: Map<string, Buffer>): Buffer {
  const orderedEntries = [
    [declarativePackageManifestFile, entries.get(declarativePackageManifestFile)!] as const,
    ...[...entries.entries()]
      .filter(([filePath]) => filePath !== declarativePackageManifestFile)
      .sort(([left], [right]) => comparePath(left, right)),
  ];
  const chunks: Buffer[] = [];
  for (const [filePath, content] of orderedEntries) {
    if (!isPortablePackagePath(filePath)) throw new Error(`Invalid Package archive path: ${filePath}`);
    const header = Buffer.alloc(tarBlockBytes);
    writeTarString(header, 0, 100, filePath);
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, content.byteLength);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    writeTarString(header, 257, 6, 'ustar');
    header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, value) => sum + value, 0);
    writeTarChecksum(header, checksum);
    chunks.push(header, content);
    const padding = (tarBlockBytes - (content.byteLength % tarBlockBytes)) % tarBlockBytes;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(tarBlockBytes * 2));
  return Buffer.concat(chunks);
}

function parseTar(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  let sawTerminator = false;
  while (offset + tarBlockBytes <= buffer.byteLength) {
    const header = buffer.subarray(offset, offset + tarBlockBytes);
    if (header.every((value) => value === 0)) {
      sawTerminator = true;
      break;
    }
    verifyTarHeader(header);
    const filePath = readTarString(header, 0, 100);
    if (!isPortablePackagePath(filePath)) throw new Error(`Package archive path is unsafe: ${filePath}`);
    if (entries.has(filePath)) throw new Error(`Package archive contains a duplicate path: ${filePath}`);
    const typeFlag = header[156];
    if (typeFlag !== 0 && typeFlag !== 0x30) {
      throw new Error(`Package archive contains a non-regular file: ${filePath}`);
    }
    if (
      readTarOctal(header, 100, 8) !== 0o644
      || readTarOctal(header, 108, 8) !== 0
      || readTarOctal(header, 116, 8) !== 0
      || readTarOctal(header, 136, 12) !== 0
      || readTarString(header, 257, 6) !== 'ustar'
    ) throw new Error(`Package archive metadata is not deterministic: ${filePath}`);
    const size = readTarOctal(header, 124, 12);
    if (size > declarativePackageMaxFileBytes) {
      throw new Error(`Package archive file exceeds the size limit: ${filePath}`);
    }
    const contentStart = offset + tarBlockBytes;
    const contentEnd = contentStart + size;
    if (contentEnd > buffer.byteLength) throw new Error(`Package archive file is truncated: ${filePath}`);
    entries.set(filePath, Buffer.from(buffer.subarray(contentStart, contentEnd)));
    if (entries.size > declarativePackageMaxFileCount) {
      throw new Error('Package archive has too many files.');
    }
    offset = contentStart + Math.ceil(size / tarBlockBytes) * tarBlockBytes;
  }
  if (!sawTerminator) throw new Error('Package archive has no tar terminator.');
  if (buffer.byteLength - offset < tarBlockBytes * 2) {
    throw new Error('Package archive must end with two tar terminator blocks.');
  }
  if (!buffer.subarray(offset).every((value) => value === 0)) {
    throw new Error('Package archive has non-zero trailing data.');
  }
  const totalBytes = [...entries.values()].reduce((sum, content) => sum + content.byteLength, 0);
  if (totalBytes > declarativePackageMaxTotalBytes) {
    throw new Error('Package archive files exceed the total size limit.');
  }
  return entries;
}

function verifyTarHeader(header: Buffer): void {
  const expected = readTarOctal(header, 148, 8);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, value) => sum + value, 0);
  if (actual !== expected) throw new Error('Package archive tar checksum is invalid.');
}

function writeTarString(
  buffer: Buffer,
  offset: number,
  length: number,
  value: string,
): void {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.byteLength >= length) throw new Error(`Package archive path is too long: ${value}`);
  encoded.copy(buffer, offset);
}

function writeTarOctal(
  buffer: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const encoded = value.toString(8).padStart(length - 1, '0');
  if (encoded.length >= length) throw new Error('Package archive numeric field is too large.');
  buffer.write(`${encoded}\0`, offset, length, 'ascii');
}

function writeTarChecksum(buffer: Buffer, checksum: number): void {
  const encoded = checksum.toString(8).padStart(6, '0');
  if (encoded.length > 6) throw new Error('Package archive checksum is too large.');
  buffer.write(`${encoded}\0 `, 148, 8, 'ascii');
}

function readTarString(
  buffer: Buffer,
  offset: number,
  length: number,
): string {
  const end = buffer.indexOf(0, offset);
  const boundedEnd = end === -1 || end > offset + length ? offset + length : end;
  return buffer.subarray(offset, boundedEnd).toString('utf8');
}

function readTarOctal(
  buffer: Buffer,
  offset: number,
  length: number,
): number {
  const value = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/s, '').trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('Package archive has an invalid tar numeric field.');
  return Number.parseInt(value, 8);
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
