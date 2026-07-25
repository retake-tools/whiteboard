import { createHash, randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  declarativePackageArchiveExtension,
  declarativePackageManifestFile,
  declarativePackageMaxFileBytes,
  declarativePackageMaxFileCount,
  declarativePackageMaxTotalBytes,
  isExactPackageIntegrity,
  isPortablePackagePath,
  parseDeclarativePackageManifest,
  type DeclarativePackageManifest,
} from '../src/core/declarativePackageContracts';
import {
  validateDeclarativePackageDefinitions,
  type DeclarativePackageDefinitions,
} from '../src/core/declarativePackageDefinitionValidation';
import {
  createDeterministicPackageArchive,
  readDeterministicPackageArchive,
} from './deterministic-package-tar';

export interface DeclarativePackageFileSummary {
  digest: string;
  path: string;
  size: number;
}

export interface DeclarativePackageInspection {
  archiveDigest?: string;
  components: {
    agentPresets: number;
    skills: number;
    workflows: number;
  };
  dependencies: number;
  digest: string;
  entrypoints: number;
  files: DeclarativePackageFileSummary[];
  manifest: DeclarativePackageManifest;
  optionalDependencies: number;
  sourceKind: 'archive' | 'directory';
  sourcePath: string;
}

export interface DeclarativePackagePackResult extends DeclarativePackageInspection {
  archiveDigest: string;
  outputPath: string;
}

export interface MaterializedDeclarativePackage {
  archive: Buffer;
  archiveDigest: string;
  definitions: DeclarativePackageDefinitions;
  digest: string;
  inspection: DeclarativePackageInspection;
  manifest: DeclarativePackageManifest;
}

interface LoadedPackage {
  definitions: DeclarativePackageDefinitions;
  digest: string;
  fileBuffers: Map<string, Buffer>;
  inspection: DeclarativePackageInspection;
  manifest: DeclarativePackageManifest;
}

export async function validateDeclarativePackage(
  sourcePath: string,
): Promise<DeclarativePackageInspection> {
  return (await loadDeclarativePackage(sourcePath)).inspection;
}

export async function inspectDeclarativePackage(
  sourcePath: string,
): Promise<DeclarativePackageInspection> {
  return validateDeclarativePackage(sourcePath);
}

export async function packDeclarativePackage(
  sourceDirectory: string,
  outputPath: string,
): Promise<DeclarativePackagePackResult> {
  const source = path.resolve(sourceDirectory);
  const output = path.resolve(outputPath);
  if (!output.endsWith(declarativePackageArchiveExtension)) {
    throw new Error(`Package archive output must end with ${declarativePackageArchiveExtension}.`);
  }
  const sourceRealPath = await realpath(source);
  if (isInsideDirectory(sourceRealPath, output)) {
    throw new Error('Package archive output must be outside the source directory.');
  }
  const loaded = await loadDirectoryPackage(sourceRealPath);
  const exactManifest: DeclarativePackageManifest = {
    ...structuredClone(loaded.manifest),
    integrity: loaded.digest,
  };
  const entries = new Map<string, Buffer>([
    [declarativePackageManifestFile, Buffer.from(`${stableStringify(exactManifest)}\n`, 'utf8')],
    ...loaded.fileBuffers.entries(),
  ]);
  const archive = createDeterministicPackageArchive(entries);
  const archiveDigest = sha256(archive);
  await atomicWriteNewFile(output, archive);
  return {
    ...loaded.inspection,
    archiveDigest,
    manifest: exactManifest,
    outputPath: output,
  };
}

export async function materializeDeclarativePackage(
  sourcePath: string,
): Promise<MaterializedDeclarativePackage> {
  const loaded = await loadDeclarativePackage(sourcePath);
  const exactManifest: DeclarativePackageManifest = {
    ...structuredClone(loaded.manifest),
    integrity: loaded.digest,
  };
  const entries = new Map<string, Buffer>([
    [declarativePackageManifestFile, Buffer.from(`${stableStringify(exactManifest)}\n`, 'utf8')],
    ...loaded.fileBuffers.entries(),
  ]);
  const archive = createDeterministicPackageArchive(entries);
  const archiveDigest = sha256(archive);
  if (
    loaded.inspection.archiveDigest
    && loaded.inspection.archiveDigest !== archiveDigest
  ) {
    throw new Error('Package archive bytes are not in canonical deterministic form.');
  }
  return {
    archive,
    archiveDigest,
    definitions: cloneDefinitions(loaded.definitions),
    digest: loaded.digest,
    inspection: {
      ...structuredClone(loaded.inspection),
      archiveDigest,
      manifest: exactManifest,
    },
    manifest: exactManifest,
  };
}

async function loadDeclarativePackage(sourcePath: string): Promise<LoadedPackage> {
  const resolved = path.resolve(sourcePath);
  const sourceStat = await lstat(resolved);
  if (sourceStat.isSymbolicLink()) throw new Error('Package source cannot be a symlink.');
  if (sourceStat.isDirectory()) return loadDirectoryPackage(resolved);
  if (!sourceStat.isFile()) throw new Error('Package source must be a directory or .retakepkg archive.');
  if (!resolved.endsWith(declarativePackageArchiveExtension)) {
    throw new Error(`Package archive must end with ${declarativePackageArchiveExtension}.`);
  }
  return loadArchivePackage(resolved);
}

async function loadDirectoryPackage(sourceDirectory: string): Promise<LoadedPackage> {
  const root = await realpath(sourceDirectory);
  const manifestPath = path.join(root, declarativePackageManifestFile);
  const manifestBuffer = await readBoundedRegularFile(root, manifestPath);
  const manifest = parseManifest(manifestBuffer, 'directory manifest');
  const actualPaths = await listDirectoryFiles(root);
  const expectedPaths = [declarativePackageManifestFile, ...manifest.files].sort(comparePath);
  if (!samePaths(actualPaths, expectedPaths)) {
    throw new Error(describeFileBoundaryMismatch(actualPaths, expectedPaths));
  }
  const fileBuffers = new Map<string, Buffer>();
  let totalBytes = manifestBuffer.byteLength;
  for (const relativePath of manifest.files) {
    const fileBuffer = await readBoundedRegularFile(root, path.join(root, ...relativePath.split('/')));
    totalBytes += fileBuffer.byteLength;
    if (totalBytes > declarativePackageMaxTotalBytes) {
      throw new Error('Package files exceed the total size limit.');
    }
    fileBuffers.set(relativePath, fileBuffer);
  }
  return validateLoadedPackage({
    fileBuffers,
    manifest,
    sourceKind: 'directory',
    sourcePath: root,
  });
}

async function loadArchivePackage(sourcePath: string): Promise<LoadedPackage> {
  const archive = await readFile(sourcePath);
  const archiveEntries = readDeterministicPackageArchive(archive);
  const firstPath = archiveEntries.keys().next().value;
  if (firstPath !== declarativePackageManifestFile) {
    throw new Error(`Package archive must place ${declarativePackageManifestFile} first.`);
  }
  const manifestBuffer = archiveEntries.get(declarativePackageManifestFile);
  if (!manifestBuffer) throw new Error(`Package archive has no ${declarativePackageManifestFile}.`);
  const manifest = parseManifest(manifestBuffer, 'archive manifest');
  if (!isExactPackageIntegrity(manifest.integrity)) {
    throw new Error('Packed Package manifest must contain an exact SHA-256 integrity value.');
  }
  const archivedPaths = [...archiveEntries.keys()];
  const expectedArchivePaths = [declarativePackageManifestFile, ...manifest.files];
  if (!samePaths(archivedPaths, expectedArchivePaths)) {
    throw new Error('Package archive files are not in canonical manifest order.');
  }
  archiveEntries.delete(declarativePackageManifestFile);
  const actualPaths = [...archiveEntries.keys()];
  if (!samePaths(actualPaths, manifest.files)) {
    throw new Error(describeFileBoundaryMismatch(actualPaths, manifest.files));
  }
  const loaded = validateLoadedPackage({
    fileBuffers: archiveEntries,
    manifest,
    sourceKind: 'archive',
    sourcePath,
  });
  loaded.inspection.archiveDigest = sha256(archive);
  return loaded;
}

function validateLoadedPackage(input: {
  fileBuffers: Map<string, Buffer>;
  manifest: DeclarativePackageManifest;
  sourceKind: 'archive' | 'directory';
  sourcePath: string;
}): LoadedPackage {
  const jsonFiles = new Map<string, unknown>();
  for (const definitionPath of componentDefinitionPaths(input.manifest)) {
    const buffer = input.fileBuffers.get(definitionPath);
    if (!buffer) continue;
    try {
      jsonFiles.set(definitionPath, JSON.parse(buffer.toString('utf8')) as unknown);
    } catch (error) {
      throw new Error(`Package component JSON is invalid: ${definitionPath}: ${errorMessage(error)}`);
    }
  }
  const definitionValidation = validateDeclarativePackageDefinitions(
    input.manifest,
    jsonFiles,
  );
  if (definitionValidation.issues.length > 0) {
    throw new Error(definitionValidation.issues.join('\n'));
  }
  const digest = packageContentDigest(input.manifest, input.fileBuffers);
  if (input.manifest.integrity !== 'sha256:auto' && input.manifest.integrity !== digest) {
    throw new Error(`Package integrity mismatch: expected ${input.manifest.integrity}, computed ${digest}.`);
  }
  const files = [...input.fileBuffers.entries()]
    .sort(([left], [right]) => comparePath(left, right))
    .map(([filePath, content]) => ({
      digest: sha256(content),
      path: filePath,
      size: content.byteLength,
    }));
  const inspection: DeclarativePackageInspection = {
    components: {
      agentPresets: input.manifest.components.agentPresets.length,
      skills: input.manifest.components.skills.length,
      workflows: input.manifest.components.workflows.length,
    },
    dependencies: input.manifest.dependencies.length,
    digest,
    entrypoints: input.manifest.entrypoints.length,
    files,
    manifest: structuredClone(input.manifest),
    optionalDependencies: input.manifest.optionalDependencies.length,
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
  };
  return {
    definitions: definitionValidation.definitions,
    digest,
    fileBuffers: input.fileBuffers,
    inspection,
    manifest: input.manifest,
  };
}

function parseManifest(buffer: Buffer, label: string): DeclarativePackageManifest {
  if (buffer.byteLength > declarativePackageMaxFileBytes) {
    throw new Error(`Package ${label} exceeds the file size limit.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`Package ${label} is invalid JSON: ${errorMessage(error)}`);
  }
  const parsed = parseDeclarativePackageManifest(value);
  if (!parsed.manifest || parsed.issues.length > 0) {
    throw new Error(parsed.issues.join('\n') || `Package ${label} is invalid.`);
  }
  return parsed.manifest;
}

function packageContentDigest(
  manifest: DeclarativePackageManifest,
  files: Map<string, Buffer>,
): string {
  const canonicalManifest = structuredClone(manifest) as Omit<DeclarativePackageManifest, 'integrity'> & {
    integrity?: string;
  };
  delete canonicalManifest.integrity;
  const hash = createHash('sha256');
  updateFramed(hash, 'retake.package.manifest/v1', Buffer.from(stableStringify(canonicalManifest), 'utf8'));
  for (const filePath of manifest.files) {
    const content = files.get(filePath);
    if (!content) throw new Error(`Package file is missing while computing digest: ${filePath}`);
    updateFramed(hash, filePath, content);
  }
  return `sha256:${hash.digest('hex')}`;
}

function updateFramed(
  hash: ReturnType<typeof createHash>,
  filePath: string,
  content: Buffer,
): void {
  const pathBuffer = Buffer.from(filePath, 'utf8');
  const pathLength = Buffer.alloc(4);
  pathLength.writeUInt32BE(pathBuffer.byteLength);
  const contentLength = Buffer.alloc(8);
  contentLength.writeBigUInt64BE(BigInt(content.byteLength));
  hash.update(pathLength);
  hash.update(pathBuffer);
  hash.update(contentLength);
  hash.update(content);
}

async function listDirectoryFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = relativeDirectory
      ? path.join(root, ...relativeDirectory.split('/'))
      : root;
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => comparePath(left.name, right.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.name === '.retake') {
        throw new Error('Package source cannot contain the reserved .retake directory.');
      }
      if (!isPortablePackagePath(relativePath)) {
        throw new Error(`Package source contains a non-portable path: ${relativePath}`);
      }
      if (entry.isSymbolicLink()) throw new Error(`Package source contains a symlink: ${relativePath}`);
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
        if (files.length > declarativePackageMaxFileCount) throw new Error('Package has too many files.');
      } else {
        throw new Error(`Package source contains an unsupported file type: ${relativePath}`);
      }
    }
  };
  await visit('');
  return files.sort(comparePath);
}

async function readBoundedRegularFile(root: string, filePath: string): Promise<Buffer> {
  const stat = await lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Package path is not a regular file: ${path.relative(root, filePath)}`);
  }
  if (stat.size > declarativePackageMaxFileBytes) {
    throw new Error(`Package file exceeds the size limit: ${path.relative(root, filePath)}`);
  }
  const fileRealPath = await realpath(filePath);
  if (!isInsideDirectory(root, fileRealPath)) {
    throw new Error(`Package file escapes the source directory: ${path.relative(root, filePath)}`);
  }
  return readFile(fileRealPath);
}

function componentDefinitionPaths(manifest: DeclarativePackageManifest): string[] {
  return [
    ...manifest.components.skills.map((component) => component.definitionPath),
    ...manifest.components.workflows.map((component) => component.definitionPath),
    ...manifest.components.agentPresets.map((component) => component.definitionPath),
  ];
}

async function atomicWriteNewFile(outputPath: string, content: Buffer): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temporaryPath, content, { flag: 'wx', mode: 0o644 });
    await link(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => comparePath(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function describeFileBoundaryMismatch(actual: string[], expected: string[]): string {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const unlisted = actual.filter((filePath) => !expectedSet.has(filePath));
  const missing = expected.filter((filePath) => !actualSet.has(filePath));
  return [
    unlisted.length > 0 ? `unlisted: ${unlisted.join(', ')}` : '',
    missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
  ].filter(Boolean).join('; ') || 'Package file boundary is invalid.';
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneDefinitions(
  definitions: DeclarativePackageDefinitions,
): DeclarativePackageDefinitions {
  return {
    agentPresets: new Map(
      [...definitions.agentPresets].map(([id, definition]) => [id, structuredClone(definition)]),
    ),
    skills: new Map(
      [...definitions.skills].map(([id, definition]) => [id, structuredClone(definition)]),
    ),
    workflows: new Map(
      [...definitions.workflows].map(([id, definition]) => [id, structuredClone(definition)]),
    ),
  };
}
