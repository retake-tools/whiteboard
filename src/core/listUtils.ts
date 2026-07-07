export function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function numberedDefaultName(baseName: string, index: number): string {
  const cleanBase = baseName.replace(/\s+\d+$/, '').trim();
  return `${cleanBase} ${Math.max(1, index)}`;
}
