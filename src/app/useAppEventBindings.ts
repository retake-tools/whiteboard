import { useEffect, useRef, type RefObject } from 'react';
import { blockLockedByGroup } from '../core/grouping';
import { imageGenerateCapabilityId } from '../core/imageGenerateContracts';
import { saveUiPreferences } from '../core/uiPreferences';
import type { BlockType, BoardSnapshot } from '../core/types';

interface AppEventBindingsOptions {
  addOperationInputBlock: (operationBlockId: string, type: Extract<BlockType, 'image' | 'text' | 'video'>) => void;
  directImageImportInputRef: RefObject<HTMLInputElement | null>;
  deleteBlockIds: (blockIds: string[]) => void;
  isMiniMapVisible: boolean;
  onBindAgentOperation: (operationBlockId: string) => void;
  onUseImageInAgent: (imageBlockId: string) => void;
  pendingDirectImageImportBlockIdRef: RefObject<string | undefined>;
  retryFailedImageResult: (blockId: string) => Promise<void>;
  setHistoryOpen: (open: boolean) => void;
  setImageFocusBlockId: (blockId: string | undefined) => void;
  setImageExecutionDetailsBlockId: (blockId: string | undefined) => void;
  setInspectorBlockId: (blockId: string | undefined) => void;
  setTaskBlockId: (blockId: string | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  showGrid: boolean;
  snapshotRef: RefObject<BoardSnapshot>;
}

export function useAppEventBindings(options: AppEventBindingsOptions): void {
  const {
    addOperationInputBlock,
    directImageImportInputRef,
    deleteBlockIds,
    isMiniMapVisible,
    onBindAgentOperation,
    onUseImageInAgent,
    pendingDirectImageImportBlockIdRef,
    retryFailedImageResult,
    setHistoryOpen,
    setImageFocusBlockId,
    setImageExecutionDetailsBlockId,
    setInspectorBlockId,
    setTaskBlockId,
    setSelectedBlock,
    showGrid,
    snapshotRef,
  } = options;
  const onBindAgentOperationRef = useRef(onBindAgentOperation);
  onBindAgentOperationRef.current = onBindAgentOperation;
  const onUseImageInAgentRef = useRef(onUseImageInAgent);
  onUseImageInAgentRef.current = onUseImageInAgent;
  const addOperationInputBlockRef = useRef(addOperationInputBlock);
  addOperationInputBlockRef.current = addOperationInputBlock;
  const deleteBlockIdsRef = useRef(deleteBlockIds);
  deleteBlockIdsRef.current = deleteBlockIds;
  const retryFailedImageResultRef = useRef(retryFailedImageResult);
  retryFailedImageResultRef.current = retryFailedImageResult;
  const setHistoryOpenRef = useRef(setHistoryOpen);
  setHistoryOpenRef.current = setHistoryOpen;
  const setImageFocusBlockIdRef = useRef(setImageFocusBlockId);
  setImageFocusBlockIdRef.current = setImageFocusBlockId;
  const setImageExecutionDetailsBlockIdRef = useRef(setImageExecutionDetailsBlockId);
  setImageExecutionDetailsBlockIdRef.current = setImageExecutionDetailsBlockId;
  const setInspectorBlockIdRef = useRef(setInspectorBlockId);
  setInspectorBlockIdRef.current = setInspectorBlockId;
  const setTaskBlockIdRef = useRef(setTaskBlockId);
  setTaskBlockIdRef.current = setTaskBlockId;
  const setSelectedBlockRef = useRef(setSelectedBlock);
  setSelectedBlockRef.current = setSelectedBlock;

  useEffect(() => { saveUiPreferences({ isMiniMapVisible }); }, [isMiniMapVisible]);
  useEffect(() => { saveUiPreferences({ showGrid }); }, [showGrid]);

  useEffect(() => {
    function onOpenInspector(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      const current = snapshotRef.current;
      const block = current.blocks.find((candidate) => candidate.blockId === blockId);
      if (!block) return;
      setHistoryOpenRef.current(false);
      setSelectedBlockRef.current(current, blockId);
      if (block.type === 'operation' && block.data.capabilityId === imageGenerateCapabilityId) {
        setImageFocusBlockIdRef.current(undefined);
        setImageExecutionDetailsBlockIdRef.current(undefined);
        setInspectorBlockIdRef.current(undefined);
        setTaskBlockIdRef.current(blockId);
        return;
      }
      setTaskBlockIdRef.current(undefined);
      if (block.type === 'image') {
        setImageExecutionDetailsBlockIdRef.current(undefined);
        setInspectorBlockIdRef.current(blockId);
        setImageFocusBlockIdRef.current(blockId);
      } else {
        setImageFocusBlockIdRef.current(undefined);
        setInspectorBlockIdRef.current(blockId);
      }
    }
    function onRetryImageResult(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (blockId) void retryFailedImageResultRef.current(blockId);
    }
    function onAddOperationInput(event: Event): void {
      const detail = (event as CustomEvent<{ operationBlockId?: string; type?: BlockType }>).detail;
      if (!detail?.operationBlockId || (detail.type !== 'text' && detail.type !== 'image' && detail.type !== 'video')) return;
      addOperationInputBlockRef.current(detail.operationBlockId, detail.type);
    }
    function onRequestImageImport(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'image');
      if (!block || block.data.assetId || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
      pendingDirectImageImportBlockIdRef.current = block.blockId;
      directImageImportInputRef.current?.click();
    }
    function onBindOperationToAgent(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      const operation = snapshotRef.current.blocks.find(
        (candidate) => candidate.blockId === blockId && candidate.type === 'operation',
      );
      if (!operation) return;
      onBindAgentOperationRef.current(blockId);
    }
    function onUseImageInAgent(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      const image = snapshotRef.current.blocks.find(
        (candidate) =>
          candidate.blockId === blockId
          && candidate.type === 'image'
          && typeof candidate.data.assetId === 'string',
      );
      if (!image) return;
      onUseImageInAgentRef.current(blockId);
    }
    function onDeleteBlock(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      const current = snapshotRef.current;
      if (!current.blocks.some((block) => block.blockId === blockId)) return;
      deleteBlockIdsRef.current([blockId]);
    }
    window.addEventListener('retake:open-execution-inspector', onOpenInspector);
    window.addEventListener('retake:retry-image-result', onRetryImageResult);
    window.addEventListener('retake:add-operation-input', onAddOperationInput);
    window.addEventListener('retake:request-image-import', onRequestImageImport);
    window.addEventListener('retake:bind-agent-operation', onBindOperationToAgent);
    window.addEventListener('retake:use-image-in-agent', onUseImageInAgent);
    window.addEventListener('retake:delete-block', onDeleteBlock);
    return () => {
      window.removeEventListener('retake:open-execution-inspector', onOpenInspector);
      window.removeEventListener('retake:retry-image-result', onRetryImageResult);
      window.removeEventListener('retake:add-operation-input', onAddOperationInput);
      window.removeEventListener('retake:request-image-import', onRequestImageImport);
      window.removeEventListener('retake:bind-agent-operation', onBindOperationToAgent);
      window.removeEventListener('retake:use-image-in-agent', onUseImageInAgent);
      window.removeEventListener('retake:delete-block', onDeleteBlock);
    };
  }, [directImageImportInputRef, pendingDirectImageImportBlockIdRef, snapshotRef]);
}
