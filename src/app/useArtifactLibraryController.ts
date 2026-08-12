import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type {
  ProjectArtifactLibraryItem,
  ProjectArtifactLibrarySnapshot,
} from '../core/artifactContracts';
import { artifactSemanticKey } from '../core/artifactLibrary';
import {
  loadProjectArtifactLibrary,
  promoteProjectAsset,
} from '../core/artifactLibraryClient';
import type { OperationToast } from '../components/OperationFeedback';
import type { BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

interface ArtifactLibraryControllerOptions {
  centeredBlockPosition: (size: { width: number; height: number }) => { x: number; y: number };
  isOpen: boolean;
  projectId: string;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  selectedBlockId?: string;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
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
    runProductCommand,
    selectedBlockId,
    setOperationToast,
    setSelectedBlock,
    snapshotRef,
    t,
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

  async function insertReference(
    item: ProjectArtifactLibraryItem,
    targetSlotId?: string,
  ): Promise<void> {
    try {
      if (!runProductCommand) {
        throw new Error('Whiteboard Artifact command facade is unavailable.');
      }
      const targetOperationId = targetSlotId && selectedBlockId
        && snapshotRef.current.blocks.some(
          (block) => block.blockId === selectedBlockId && block.type === 'operation',
        )
        ? selectedBlockId
        : undefined;
      const inserted = await runProductCommand(
        (commands) => commands.artifact.insertReference({
          fallbackPosition: centeredBlockPosition({
            width: 300,
            height: item.primaryAsset.kind === 'video' ? 180 : 230,
          }),
          item,
          targetOperationId,
          targetSlotId,
        }),
        { history: true },
      );
      if (!inserted.boundToOperation) {
        setSelectedBlock(snapshotRef.current, inserted.blockId);
      }
      setOperationToast({
        body: t(inserted.boundToOperation ? 'artifactLibrary.boundBody' : 'artifactLibrary.insertedBody'),
        id: `artifact-inserted:${Date.now()}`,
        title: t(inserted.boundToOperation ? 'artifactLibrary.boundTitle' : 'artifactLibrary.insertedTitle'),
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
