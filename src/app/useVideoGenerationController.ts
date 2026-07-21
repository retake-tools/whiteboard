import { useEffect, useRef, type RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { loadBoardSnapshot } from '../core/boardStore';
import { blockLockedByGroup } from '../core/grouping';
import { nowIso } from '../core/id';
import type { BoardSnapshot } from '../core/types';
import { cancelDreaminaCliVideo, startDreaminaCliVideo } from '../core/dreaminaCliVideoClient';
import { cancelSeedanceVideo, startSeedanceVideo } from '../core/seedanceVideoClient';
import { runMockVideoGeneration } from '../core/videoGeneration';
import type { useI18n } from '../i18n';

interface VideoGenerationControllerOptions {
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

interface VideoDraftUpdate {
  blockId: string;
  aspectRatio?: string;
  connectionId?: string | null;
  durationSeconds?: number;
  outputCount?: number;
  prompt?: string;
  executionProfileId?: string;
}

export function useVideoGenerationController(options: VideoGenerationControllerOptions): void {
  const { setOperationToast, setSelectedBlocks, snapshotRef, t, updateSnapshot } = options;
  const inFlightBlockIdsRef = useRef(new Set<string>());

  function updateVideoDraft(input: VideoDraftUpdate): void {
    updateSnapshot((current) => {
      const block = current.blocks.find((candidate) => candidate.blockId === input.blockId && candidate.type === 'video');
      if (!block || blockLockedByGroup(current, block.blockId)) return current;
      const currentDraft = block.data.executionDraft ?? {
        schemaVersion: 1 as const,
        capabilityId: 'video.generate',
        executionProfileId: 'video-mock',
        prompt: '',
        parameters: {},
      };
      block.data.executionDraft = {
        ...currentDraft,
        executionProfileId: input.executionProfileId ?? currentDraft.executionProfileId,
        ...connectionField(input.connectionId, currentDraft.connectionId),
        prompt: input.prompt ?? currentDraft.prompt,
        parameters: {
          ...currentDraft.parameters,
          ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
          ...(input.outputCount === undefined ? {} : { outputCount: input.outputCount }),
          ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
        },
      };
      block.updatedAt = nowIso();
      return current;
    }, { persist: true });
  }

  async function generateVideo(blockId: string): Promise<void> {
    if (inFlightBlockIdsRef.current.has(blockId)) return;
    const base = snapshotRef.current;
    const block = base.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'video');
    if (!block || blockLockedByGroup(base, block.blockId)) return;
    const draft = block.data.executionDraft;
    const prompt = draft?.prompt ?? '';
    const durationSeconds = numberParam(draft?.parameters.durationSeconds, 8);
    const outputCount = numberParam(draft?.parameters.outputCount, 1);
    const aspectRatio = stringParam(draft?.parameters.aspectRatio, '9:16');
    const executionProfileId = draft?.executionProfileId ?? 'video-mock';
    const connectionId = draft?.connectionId ?? undefined;
    inFlightBlockIdsRef.current.add(blockId);
    try {
      if (executionProfileId === 'video-seedance-modelark' || executionProfileId === 'video-dreamina-cli') {
        const usesDreaminaCli = executionProfileId === 'video-dreamina-cli';
        const started = await (usesDreaminaCli ? startDreaminaCliVideo : startSeedanceVideo)({
          projectId: base.project.projectId,
          boardId: base.board.boardId,
          targetBlockId: blockId,
          prompt,
          durationSeconds,
          outputCount,
          aspectRatio,
          connectionId,
        });
        const nextSnapshot = updateSnapshot(() => started.snapshot, { persist: false, history: true });
        setSelectedBlocks(nextSnapshot, started.execution.outputBlockIds);
        setOperationToast({
          id: started.execution.executionId,
          title: t(usesDreaminaCli ? 'videoGeneration.dreaminaStarted' : 'videoGeneration.seedanceStarted'),
          body: t(usesDreaminaCli ? 'videoGeneration.dreaminaCostNotice' : 'videoGeneration.seedanceCostNotice'),
          tone: 'success',
        });
        await pollProviderExecution(started.execution.executionId, started.snapshot, usesDreaminaCli);
        return;
      }

      const completedSnapshot = structuredClone(base) as BoardSnapshot;
      const run = await runMockVideoGeneration(completedSnapshot, {
        targetBlockId: blockId,
        prompt,
        durationSeconds,
        outputCount,
        connectionId,
      });
      const nextSnapshot = updateSnapshot(() => completedSnapshot, { persist: true, history: true });
      setSelectedBlocks(nextSnapshot, run.execution.outputBlockIds);
      setOperationToast({
        id: run.execution.executionId,
        title: t('videoGeneration.mockCompleted'),
        body: t('videoGeneration.mockNotice'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: `video-mock:${blockId}`,
        title: t('videoGeneration.failed'),
        body: error instanceof Error ? error.message : t('videoGeneration.failed'),
        tone: 'error',
      });
    } finally {
      inFlightBlockIdsRef.current.delete(blockId);
    }
  }

  useEffect(() => {
    function onUpdateDraft(event: Event): void {
      const detail = (event as CustomEvent<VideoDraftUpdate>).detail;
      if (detail?.blockId) updateVideoDraft(detail);
    }
    function onGenerate(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (blockId) void generateVideo(blockId);
    }
    function onCancelProviderExecution(event: Event): void {
      const detail = (event as CustomEvent<{
        boardId?: string;
        executionId?: string;
        adapterId?: string;
        projectId?: string;
        providerTaskIds?: string[];
      }>).detail;
      if (!detail?.projectId || !detail.boardId || !detail.executionId) return;
      const cancel = detail.adapterId === 'retake.video.dreamina-cli' ? cancelDreaminaCliVideo : cancelSeedanceVideo;
      void cancel({
        projectId: detail.projectId,
        boardId: detail.boardId,
        executionId: detail.executionId,
        providerTaskIds: detail.providerTaskIds,
      }).catch(() => undefined);
    }
    window.addEventListener('retake:update-video-draft', onUpdateDraft);
    window.addEventListener('retake:generate-video', onGenerate);
    window.addEventListener('retake:cancel-provider-execution', onCancelProviderExecution);
    return () => {
      window.removeEventListener('retake:update-video-draft', onUpdateDraft);
      window.removeEventListener('retake:generate-video', onGenerate);
      window.removeEventListener('retake:cancel-provider-execution', onCancelProviderExecution);
    };
  }, []);

  async function pollProviderExecution(executionId: string, scope: BoardSnapshot, usesDreaminaCli: boolean): Promise<void> {
    while (true) {
      await delay(1_500);
      const latest = await loadBoardSnapshot({ projectId: scope.project.projectId, boardId: scope.board.boardId });
      const execution = latest.executions.find((candidate) => candidate.executionId === executionId);
      if (snapshotRef.current.project.projectId === scope.project.projectId && snapshotRef.current.board.boardId === scope.board.boardId) {
        updateSnapshot(() => latest, { persist: false, history: false });
      }
      if (!execution || execution.status === 'queued' || execution.status === 'running') continue;
      setOperationToast({
        id: executionId,
        title: t(execution.status === 'succeeded'
          ? (usesDreaminaCli ? 'videoGeneration.dreaminaCompleted' : 'videoGeneration.seedanceCompleted')
          : execution.status === 'canceled'
            ? 'feedback.executionCanceled'
            : 'videoGeneration.failed'),
        body: execution.status === 'succeeded'
          ? t(usesDreaminaCli ? 'videoGeneration.dreaminaCompletedNotice' : 'videoGeneration.seedanceCompletedNotice')
          : execution.errorMessage ?? t('videoGeneration.failed'),
        tone: execution.status === 'succeeded' ? 'success' : execution.status === 'canceled' ? undefined : 'error',
      });
      return;
    }
  }
}

function connectionField(value: string | null | undefined, fallback: string | null | undefined): { connectionId?: string | null } {
  if (value === undefined) return fallback ? { connectionId: fallback } : {};
  return value ? { connectionId: value } : { connectionId: null };
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
