import { useRef, useState, type RefObject } from 'react';
import { touchBoard } from '../core/blockFactory';
import {
  annotationDraftContentEquals,
  annotationDraftHasContent,
  annotationDraftMatches,
  type AnnotationDraft,
  type AnnotationDraftContent,
} from '../core/imageAnnotations';
import { annotationDraftRestoreContext } from '../core/restoreAnnotationDraft';
import { restoreExecutionConfiguration } from '../core/restoreExecutionConfiguration';
import { nowIso } from '../core/id';
import type { BoardSnapshot } from '../core/types';
import type { OperationToast } from '../components/OperationFeedback';
import type { useI18n } from '../i18n';

interface AnnotationControllerOptions {
  scheduleAnnotationDraftPersist: () => void;
  setHistoryOpen: (open: boolean) => void;
  setInspectorBlockId: (blockId: string | undefined) => void;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useAnnotationController(options: AnnotationControllerOptions) {
  const {
    scheduleAnnotationDraftPersist,
    setHistoryOpen,
    setInspectorBlockId,
    setOperationToast,
    setSelectedBlock,
    snapshotRef,
    t,
    updateSnapshot,
  } = options;
  const [annotationEditorOpenRequest, setAnnotationEditorOpenRequest] = useState<{
    blockId: string;
    draft: AnnotationDraft;
    requestId: number;
  }>();
  const annotationEditorOpenRequestCounterRef = useRef(0);

  function updateAnnotationDraft(blockId: string, content: AnnotationDraftContent): void {
    const sourceBlock = snapshotRef.current.blocks.find(
      (block) => block.blockId === blockId && block.type === 'image',
    );
    const sourceAssetId = typeof sourceBlock?.data.assetId === 'string' ? sourceBlock.data.assetId : undefined;
    if (!sourceBlock || !sourceAssetId) return;
    const existingDraft = annotationDraftMatches(sourceBlock.data.annotationDraft, sourceAssetId)
      ? sourceBlock.data.annotationDraft
      : undefined;
    if (annotationDraftContentEquals(existingDraft, content)) return;
    if (!annotationDraftHasContent(content) && !sourceBlock.data.annotationDraft) return;
    updateSnapshot((current) => {
      const block = current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'image');
      if (!block || block.data.assetId !== sourceAssetId) return current;
      const updatedAt = nowIso();
      block.data = { ...block.data };
      if (annotationDraftHasContent(content)) {
        block.data.annotationDraft = {
          schemaVersion: 1,
          sourceAssetId,
          globalInstruction: content.globalInstruction,
          marks: structuredClone(content.marks),
          updatedAt,
        };
      } else delete block.data.annotationDraft;
      block.updatedAt = updatedAt;
      return touchBoard(current);
    }, { syncFlow: false });
    scheduleAnnotationDraftPersist();
  }

  function restoreConfigurationVersion(executionId: string): void {
    const candidate = structuredClone(snapshotRef.current);
    const result = restoreExecutionConfiguration(candidate, executionId);
    if (!result.restored || !result.operationBlockId) {
      setOperationToast({
        id: `configuration-restore:${executionId}`,
        title: t('feedback.configurationRestoreUnavailable'),
        body: result.missingAssetIds.length
          ? `${t('feedback.configurationRestoreMissingAssets')} ${result.missingAssetIds.join(', ')}`
          : undefined,
        tone: 'error',
      });
      return;
    }
    const nextSnapshot = updateSnapshot(() => candidate, { persist: true, history: true });
    setSelectedBlock(nextSnapshot, result.operationBlockId);
    setOperationToast({ id: `configuration-restored:${executionId}`, title: t('feedback.configurationRestored') });
  }

  function openHistoricalAnnotationVersion(executionId: string): void {
    const execution = snapshotRef.current.executions.find((candidate) => candidate.executionId === executionId);
    const restoreContext = execution ? annotationDraftRestoreContext(snapshotRef.current, execution) : undefined;
    if (!restoreContext || restoreContext.state !== 'available' || !restoreContext.sourceBlock || !restoreContext.manifest) {
      setOperationToast({
        id: `annotation-draft-restore:${executionId}`,
        title: t('feedback.annotationDraftRestoreUnavailable'),
        body: restoreContext?.state === 'source_replaced'
          ? t('inspector.annotationSourceChanged')
          : restoreContext?.state === 'source_missing'
            ? t('inspector.annotationSourceMissing')
            : undefined,
        tone: 'error',
      });
      return;
    }
    setSelectedBlock(snapshotRef.current, restoreContext.sourceBlock.blockId);
    annotationEditorOpenRequestCounterRef.current += 1;
    setAnnotationEditorOpenRequest({
      blockId: restoreContext.sourceBlock.blockId,
      draft: {
        schemaVersion: 1,
        sourceAssetId: restoreContext.sourceAssetId!,
        globalInstruction: restoreContext.manifest.globalInstruction,
        marks: structuredClone(restoreContext.manifest.marks),
        updatedAt: nowIso(),
      },
      requestId: annotationEditorOpenRequestCounterRef.current,
    });
    setInspectorBlockId(undefined);
    setHistoryOpen(false);
    setOperationToast({ id: `historical-annotation-opened:${executionId}`, title: t('feedback.historicalAnnotationOpened'), body: restoreContext.sourceBlock.data.title, tone: 'success' });
  }

  return {
    annotationEditorOpenRequest,
    openHistoricalAnnotationVersion,
    restoreConfigurationVersion,
    setAnnotationEditorOpenRequest,
    updateAnnotationDraft,
  };
}
