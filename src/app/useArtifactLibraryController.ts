import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type {
  ProjectArtifactLibraryItem,
  ProjectArtifactLibrarySnapshot,
} from '../core/artifactContracts';
import {
  artifactSemanticKey,
  insertArtifactReference,
} from '../core/artifactLibrary';
import {
  loadProjectArtifactLibrary,
  promoteProjectAsset,
} from '../core/artifactLibraryClient';
import type { OperationToast } from '../components/OperationFeedback';
import type { BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';

interface ArtifactLibraryControllerOptions {
  centeredBlockPosition: (size: { width: number; height: number }) => { x: number; y: number };
  isOpen: boolean;
  projectId: string;
  selectedBlockId?: string;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

interface PendingPromotion {
  fingerprint: string;
  idempotencyKey: string;
}

export function useArtifactLibraryController(options: ArtifactLibraryControllerOptions) {
  const {
    centeredBlockPosition,
    isOpen,
    projectId,
    selectedBlockId,
    setOperationToast,
    setSelectedBlock,
    snapshotRef,
    t,
    updateSnapshot,
  } = options;
  const [library, setLibrary] = useState<ProjectArtifactLibrarySnapshot>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const pendingPromotionRef = useRef<PendingPromotion | undefined>(undefined);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setIsLoading(true);
    setError(undefined);
    try {
      setLibrary(await loadProjectArtifactLibrary(projectId, signal));
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [isOpen, refresh]);

  useEffect(() => {
    setLibrary(undefined);
    setError(undefined);
    pendingPromotionRef.current = undefined;
  }, [projectId]);

  async function promoteSelectedAsset(input: {
    artifactType: string;
    name: string;
  }): Promise<void> {
    const snapshot = snapshotRef.current;
    const block = selectedBlockId
      ? snapshot.blocks.find((candidate) => candidate.blockId === selectedBlockId)
      : undefined;
    const assetId = typeof block?.data.assetId === 'string' ? block.data.assetId : undefined;
    if (!block || !assetId) {
      setError(t('artifactLibrary.promotionSourceMissing'));
      return;
    }
    const semanticKey = artifactSemanticKey(input.artifactType, input.name);
    const existing = library?.items.find(
      (item) => item.artifact.artifactType === input.artifactType
        && item.artifact.semanticKey === semanticKey,
    );
    if (existing?.currentRevision.primaryAssetId === assetId) {
      setError(t('artifactLibrary.alreadyCurrent'));
      return;
    }
    const fingerprint = [
      snapshot.project.projectId,
      snapshot.board.boardId,
      block.blockId,
      assetId,
      input.artifactType,
      semanticKey,
      existing?.currentRevision.artifactRevisionId ?? '',
    ].join(':');
    const pending = pendingPromotionRef.current;
    const idempotencyKey = pending?.fingerprint === fingerprint
      ? pending.idempotencyKey
      : `artifact-promotion:${crypto.randomUUID()}`;
    pendingPromotionRef.current = { fingerprint, idempotencyKey };
    setIsPromoting(true);
    setError(undefined);
    try {
      await promoteProjectAsset({
        artifactType: input.artifactType,
        assetId,
        blockId: block.blockId,
        boardId: snapshot.board.boardId,
        expectedCurrentRevisionId: existing?.currentRevision.artifactRevisionId ?? null,
        idempotencyKey,
        projectId: snapshot.project.projectId,
        semanticKey,
        sourceArtifactRevisionId: typeof block.data.artifactRevisionId === 'string'
          ? block.data.artifactRevisionId
          : undefined,
      });
      pendingPromotionRef.current = undefined;
      await refresh();
      setOperationToast({
        body: t('artifactLibrary.promotedBody'),
        id: `artifact-promoted:${Date.now()}`,
        title: t('artifactLibrary.promotedTitle'),
        tone: 'success',
      });
    } catch (promotionError) {
      setError(promotionError instanceof Error ? promotionError.message : String(promotionError));
    } finally {
      setIsPromoting(false);
    }
  }

  function insertReference(item: ProjectArtifactLibraryItem, targetSlotId?: string): void {
    let insertedBlockId = '';
    let boundToOperation = false;
    try {
      const next = updateSnapshot((current) => {
        const targetOperation = targetSlotId && selectedBlockId
          ? current.blocks.find((block) => block.blockId === selectedBlockId && block.type === 'operation')
          : undefined;
        const position = targetOperation
          ? {
              x: targetOperation.position.x - 360,
              y: targetOperation.position.y,
            }
          : centeredBlockPosition({ width: 300, height: item.primaryAsset.kind === 'video' ? 180 : 230 });
        const block = insertArtifactReference(current, {
          item,
          position,
          targetOperationId: targetOperation?.blockId,
          targetSlotId,
        });
        insertedBlockId = block.blockId;
        boundToOperation = Boolean(targetOperation && targetSlotId);
        return current;
      }, { history: true, persist: true });
      if (!insertedBlockId) return;
      if (!boundToOperation) setSelectedBlock(next, insertedBlockId);
      setOperationToast({
        body: t(boundToOperation ? 'artifactLibrary.boundBody' : 'artifactLibrary.insertedBody'),
        id: `artifact-inserted:${Date.now()}`,
        title: t(boundToOperation ? 'artifactLibrary.boundTitle' : 'artifactLibrary.insertedTitle'),
        tone: 'success',
      });
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : String(insertError));
    }
  }

  return {
    error,
    insertReference,
    isLoading,
    isPromoting,
    library,
    promoteSelectedAsset,
    refresh,
  };
}
