import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { readFileAsDataUrl, readImageDimensions } from '../core/imageFile';
import type {
  ProjectAssetCatalogItem,
  ProjectAssetCatalogSnapshot,
} from '../core/projectAssetCatalog';
import {
  loadProjectAssetCatalog,
  relinkProjectMaterial,
  uploadProjectMaterial,
} from '../core/projectAssetCatalogClient';
import type { BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

interface ProjectAssetCatalogControllerOptions {
  centeredBlockPosition: (size: { width: number; height: number }) => { x: number; y: number };
  isOpen: boolean;
  onInserted: (blockId: string) => void;
  onRelinkComplete: () => Promise<void>;
  projectId: string;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useProjectAssetCatalogController(options: ProjectAssetCatalogControllerOptions) {
  const {
    centeredBlockPosition,
    isOpen,
    onInserted,
    onRelinkComplete,
    projectId,
    runProductCommand,
    setOperationToast,
    setSelectedBlock,
    snapshotRef,
    t,
  } = options;
  const [catalog, setCatalog] = useState<ProjectAssetCatalogSnapshot>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAssetId, setPendingAssetId] = useState<string>();

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setIsLoading(true);
    setError(undefined);
    try {
      setCatalog(await loadProjectAssetCatalog(projectId, signal));
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
    setCatalog(undefined);
    setError(undefined);
    setPendingAssetId(undefined);
  }, [projectId]);

  async function upload(file: File): Promise<void> {
    setPendingAssetId('upload');
    setError(undefined);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const dimensions = await readImageDimensions(dataUrl);
      await uploadProjectMaterial({
        dataUrl,
        fileName: file.name,
        height: dimensions?.height,
        projectId,
        width: dimensions?.width,
      });
      await refresh();
      setOperationToast({
        body: t('workspaceMaterials.uploadedBody'),
        id: `material-uploaded:${Date.now()}`,
        title: t('workspaceMaterials.uploadedTitle'),
        tone: 'success',
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setPendingAssetId(undefined);
    }
  }

  async function relink(item: ProjectAssetCatalogItem, file: File): Promise<void> {
    setPendingAssetId(item.asset.assetId);
    setError(undefined);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const dimensions = await readImageDimensions(dataUrl);
      await relinkProjectMaterial({
        assetId: item.asset.assetId,
        dataUrl,
        height: dimensions?.height,
        projectId,
        width: dimensions?.width,
      });
      await onRelinkComplete();
      await refresh();
      setOperationToast({
        body: t('workspaceMaterials.relinkedBody'),
        id: `material-relinked:${Date.now()}`,
        title: t('workspaceMaterials.relinkedTitle'),
        tone: 'success',
      });
    } catch (relinkError) {
      setError(relinkError instanceof Error ? relinkError.message : String(relinkError));
    } finally {
      setPendingAssetId(undefined);
    }
  }

  async function insert(item: ProjectAssetCatalogItem): Promise<void> {
    setPendingAssetId(item.asset.assetId);
    setError(undefined);
    try {
      if (!runProductCommand) throw new Error('Whiteboard Asset command facade is unavailable.');
      const inserted = await runProductCommand(
        (commands) => commands.asset.insertReference({
          item,
          position: centeredBlockPosition({ width: 300, height: 230 }),
        }),
        { history: true },
      );
      setSelectedBlock(snapshotRef.current, inserted.blockId);
      onInserted(inserted.blockId);
      setOperationToast({
        body: t('workspaceMaterials.addedBody'),
        id: `material-added:${Date.now()}`,
        title: t('workspaceMaterials.addedTitle'),
        tone: 'success',
      });
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : String(insertError));
    } finally {
      setPendingAssetId(undefined);
    }
  }

  return {
    catalog,
    error,
    insert,
    isLoading,
    pendingAssetId,
    refresh,
    relink,
    upload,
  };
}
