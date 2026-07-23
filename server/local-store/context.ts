import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSnapshot } from '../../src/core/sampleBoard';
import type { BoardSnapshot } from '../../src/core/types';

export const workspaceRoot = process.cwd();
const retakeWorkspaceDir = process.env.RETAKE_WORKSPACE_DIR ?? '.retake';
export const retakeRoot = path.isAbsolute(retakeWorkspaceDir)
  ? retakeWorkspaceDir
  : path.join(workspaceRoot, retakeWorkspaceDir);
export const projectsRoot = path.join(retakeRoot, 'projects');

export async function ensureWorkspace(): Promise<void> {
  await mkdir(projectsRoot, { recursive: true });
  await writeJson(path.join(retakeRoot, 'workspace.json'), {
    schemaVersion: 1,
    defaultProjectId: defaultSnapshot.project.projectId,
    createdFor: 'retake-whiteboard-local',
  });
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function touchSnapshot(snapshot: BoardSnapshot): void {
  const now = new Date().toISOString();
  snapshot.project.updatedAt = now;
  snapshot.board.updatedAt = now;
}

export function compareOrderedRecords<T extends { order?: number; updatedAt: string; name: string }>(
  left: T,
  right: T,
): number {
  const leftOrder = typeof left.order === 'number' ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = typeof right.order === 'number' ? right.order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) return updated;
  return left.name.localeCompare(right.name);
}
