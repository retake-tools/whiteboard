import type {
  AssetRecord,
  BoardSnapshot,
  WorkspaceProjectSummary,
  WorkspaceSummary,
} from '../../core/types';
import type {
  CanvasHostScopeV1,
  DeepReadonly,
  HostPersistAssetOptionsV1,
  HostStorageAdapterV1,
  HostStorageSaveInputV1,
} from '../contracts';

export class InMemoryHostStorageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InMemoryHostStorageConflictError';
  }
}

export class InMemoryHostStorageAdapter implements HostStorageAdapterV1 {
  readonly adapterVersion = 1 as const;
  readonly #assets = new Map<string, AssetRecord>();
  readonly #snapshots = new Map<string, BoardSnapshot>();
  #lastPersistAssetOptions?: HostPersistAssetOptionsV1;

  constructor(snapshots: readonly BoardSnapshot[] = []) {
    for (const snapshot of snapshots) this.seed(snapshot);
  }

  async listWorkspace(): Promise<WorkspaceSummary> {
    const projects = new Map<string, WorkspaceProjectSummary>();
    for (const snapshot of this.#snapshots.values()) {
      const current = projects.get(snapshot.project.projectId) ?? {
        boards: [],
        createdAt: snapshot.project.createdAt,
        defaultBoardId: snapshot.project.defaultBoardId,
        name: snapshot.project.name,
        order: snapshot.project.order,
        projectId: snapshot.project.projectId,
        updatedAt: snapshot.project.updatedAt,
      };
      current.boards.push({
        boardId: snapshot.board.boardId,
        createdAt: snapshot.board.createdAt,
        name: snapshot.board.name,
        order: snapshot.board.order,
        projectId: snapshot.board.projectId,
        updatedAt: snapshot.board.updatedAt,
      });
      if (snapshot.project.updatedAt > current.updatedAt) {
        current.name = snapshot.project.name;
        current.updatedAt = snapshot.project.updatedAt;
      }
      projects.set(snapshot.project.projectId, current);
    }
    const ordered = [...projects.values()]
      .map((project) => ({
        ...project,
        boards: project.boards.sort(compareOrdered),
      }))
      .sort(compareOrdered);
    return structuredClone({
      defaultProjectId: ordered[0]?.projectId ?? '',
      projects: ordered,
    });
  }

  async loadBoard(scope: CanvasHostScopeV1): Promise<BoardSnapshot> {
    const snapshot = this.#snapshots.get(scopeKey(scope));
    if (!snapshot) {
      throw new Error(`Board not found: ${scope.projectId}/${scope.boardId}.`);
    }
    return structuredClone(snapshot);
  }

  async persistAsset(
    asset: DeepReadonly<AssetRecord>,
    options?: HostPersistAssetOptionsV1,
  ): Promise<AssetRecord> {
    this.#lastPersistAssetOptions = options ? structuredClone(options) : undefined;
    const key = assetKey(asset.projectId, asset.assetId);
    const current = this.#assets.get(key);
    if (current && !sameValue(current, asset)) {
      throw new InMemoryHostStorageConflictError(
        `Asset identity already has different content: ${asset.assetId}.`,
      );
    }
    const persisted = structuredClone(asset) as AssetRecord;
    this.#assets.set(key, persisted);
    return structuredClone(persisted);
  }

  readLastPersistAssetOptions(): HostPersistAssetOptionsV1 | undefined {
    return this.#lastPersistAssetOptions
      ? structuredClone(this.#lastPersistAssetOptions)
      : undefined;
  }

  async saveBoard(input: HostStorageSaveInputV1): Promise<BoardSnapshot> {
    const snapshot = structuredClone(input.snapshot) as BoardSnapshot;
    const key = scopeKey({
      boardId: snapshot.board.boardId,
      projectId: snapshot.project.projectId,
    });
    const current = this.#snapshots.get(key);
    if (!input.expectedRevision) {
      if (current) {
        throw new InMemoryHostStorageConflictError(
          `Board already exists: ${snapshot.project.projectId}/${snapshot.board.boardId}.`,
        );
      }
    } else if (
      !current
      || input.expectedRevision.projectId !== snapshot.project.projectId
      || input.expectedRevision.boardId !== snapshot.board.boardId
      || input.expectedRevision.updatedAt !== current.board.updatedAt
    ) {
      throw new InMemoryHostStorageConflictError(
        `Board revision conflict: ${snapshot.project.projectId}/${snapshot.board.boardId}.`,
      );
    }
    this.#snapshots.set(key, snapshot);
    return structuredClone(snapshot);
  }

  readAsset(projectId: string, assetId: string): AssetRecord | undefined {
    const asset = this.#assets.get(assetKey(projectId, assetId));
    return asset ? structuredClone(asset) : undefined;
  }

  seed(snapshot: BoardSnapshot): void {
    const clone = structuredClone(snapshot);
    this.#snapshots.set(scopeKey({
      boardId: clone.board.boardId,
      projectId: clone.project.projectId,
    }), clone);
    for (const asset of clone.assets) {
      this.#assets.set(assetKey(asset.projectId, asset.assetId), structuredClone(asset));
    }
  }
}

function scopeKey(scope: CanvasHostScopeV1): string {
  return `${scope.projectId}\u0000${scope.boardId}`;
}

function assetKey(projectId: string, assetId: string): string {
  return `${projectId}\u0000${assetId}`;
}

function compareOrdered(
  left: { name: string; order?: number },
  right: { name: string; order?: number },
): number {
  return (left.order ?? Number.MAX_SAFE_INTEGER)
    - (right.order ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
