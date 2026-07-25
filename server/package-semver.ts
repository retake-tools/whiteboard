export interface ParsedPackageVersion {
  build: string[];
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
  raw: string;
}

const exactVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const comparatorPattern = /^(>=|<=|>|<)?(.+)$/;

export function parsePackageVersion(value: string): ParsedPackageVersion {
  const match = exactVersionPattern.exec(value);
  if (!match) throw new Error(`Invalid exact Package version: ${value}`);
  return {
    build: match[5]?.split('.') ?? [],
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.').map(parsePrereleaseIdentifier) ?? [],
    raw: value,
  };
}

export function comparePackageVersions(left: string, right: string): number {
  const a = parsePackageVersion(left);
  const b = parsePackageVersion(right);
  const core = compareNumbers(a.major, b.major)
    || compareNumbers(a.minor, b.minor)
    || compareNumbers(a.patch, b.patch);
  if (core !== 0) return core;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return compareNumbers(leftPart, rightPart);
    }
    if (typeof leftPart === 'number') return -1;
    if (typeof rightPart === 'number') return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function packageVersionSatisfies(version: string, range: string): boolean {
  parsePackageVersion(version);
  if (range === '*') return true;
  if (range.startsWith('^')) return satisfiesCaret(version, range.slice(1));
  if (range.startsWith('~')) return satisfiesTilde(version, range.slice(1));
  return range.split(/\s+/).every((part) => satisfiesComparator(version, part));
}

function satisfiesCaret(version: string, minimum: string): boolean {
  const parsed = parsePackageVersion(minimum);
  const maximum = parsed.major > 0
    ? `${parsed.major + 1}.0.0`
    : parsed.minor > 0
      ? `0.${parsed.minor + 1}.0`
      : `0.0.${parsed.patch + 1}`;
  return comparePackageVersions(version, minimum) >= 0
    && comparePackageVersions(version, maximum) < 0;
}

function satisfiesTilde(version: string, minimum: string): boolean {
  const parsed = parsePackageVersion(minimum);
  const maximum = `${parsed.major}.${parsed.minor + 1}.0`;
  return comparePackageVersions(version, minimum) >= 0
    && comparePackageVersions(version, maximum) < 0;
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const match = comparatorPattern.exec(comparator);
  if (!match) throw new Error(`Invalid Package version comparator: ${comparator}`);
  const operator = match[1] ?? '=';
  const target = match[2]!;
  const compared = comparePackageVersions(version, target);
  if (operator === '>') return compared > 0;
  if (operator === '>=') return compared >= 0;
  if (operator === '<') return compared < 0;
  if (operator === '<=') return compared <= 0;
  return compared === 0;
}

function parsePrereleaseIdentifier(value: string): number | string {
  if (/^(0|[1-9]\d*)$/.test(value)) return Number(value);
  return value;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
