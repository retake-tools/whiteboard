import { useEffect, type RefObject } from 'react';
import { blockLockedByGroup } from '../core/grouping';
import { saveUiPreferences } from '../core/uiPreferences';
import type { BlockType, BoardSnapshot } from '../core/types';

interface AppEventBindingsOptions {
  addOperationInputBlock: (operationBlockId: string, type: Extract<BlockType, 'image' | 'text' | 'video'>) => void;
  directImageImportInputRef: RefObject<HTMLInputElement | null>;
  isMiniMapVisible: boolean;
  pendingDirectImageImportBlockIdRef: RefObject<string | undefined>;
  retryFailedImageResult: (blockId: string) => Promise<void>;
  setHistoryOpen: (open: boolean) => void;
  setInspectorBlockId: (blockId: string | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  showGrid: boolean;
  snapshotRef: RefObject<BoardSnapshot>;
}

export function useAppEventBindings(options: AppEventBindingsOptions): void {
  const {
    addOperationInputBlock,
    directImageImportInputRef,
    isMiniMapVisible,
    pendingDirectImageImportBlockIdRef,
    retryFailedImageResult,
    setHistoryOpen,
    setInspectorBlockId,
    setSelectedBlock,
    showGrid,
    snapshotRef,
  } = options;

  useEffect(() => { saveUiPreferences({ isMiniMapVisible }); }, [isMiniMapVisible]);
  useEffect(() => { saveUiPreferences({ showGrid }); }, [showGrid]);

  useEffect(() => {
    function onOpenInspector(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      const current = snapshotRef.current;
      if (!current.blocks.some((block) => block.blockId === blockId)) return;
      setHistoryOpen(false);
      setInspectorBlockId(blockId);
      setSelectedBlock(current, blockId);
    }
    function onRetryImageResult(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (blockId) void retryFailedImageResult(blockId);
    }
    function onAddOperationInput(event: Event): void {
      const detail = (event as CustomEvent<{ operationBlockId?: string; type?: BlockType }>).detail;
      if (!detail?.operationBlockId || (detail.type !== 'text' && detail.type !== 'image' && detail.type !== 'video')) return;
      addOperationInputBlock(detail.operationBlockId, detail.type);
    }
    function onRequestImageImport(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'image');
      if (!block || block.data.assetId || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
      pendingDirectImageImportBlockIdRef.current = block.blockId;
      directImageImportInputRef.current?.click();
    }
    window.addEventListener('retake:open-execution-inspector', onOpenInspector);
    window.addEventListener('retake:retry-image-result', onRetryImageResult);
    window.addEventListener('retake:add-operation-input', onAddOperationInput);
    window.addEventListener('retake:request-image-import', onRequestImageImport);
    return () => {
      window.removeEventListener('retake:open-execution-inspector', onOpenInspector);
      window.removeEventListener('retake:retry-image-result', onRetryImageResult);
      window.removeEventListener('retake:add-operation-input', onAddOperationInput);
      window.removeEventListener('retake:request-image-import', onRequestImageImport);
    };
  }, []);
}
