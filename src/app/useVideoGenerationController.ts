import { useEffect, useRef, type RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { loadBoardSnapshot } from '../core/boardStore';
import { cancelDreaminaCliVideo, startDreaminaCliVideo } from '../core/dreaminaCliVideoClient';
import { cancelSeedanceVideo, startSeedanceVideo } from '../core/seedanceVideoClient';
import { blockLockedByGroup } from '../core/grouping';
import type { BoardSnapshot } from '../core/types';
import type { CanvasHostScopeV1 } from '../host-kit';
import type { useI18n } from '../i18n';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';
import type { WhiteboardVideoDraftUpdateV1 } from '../whiteboard/application/whiteboardVideoGenerationCommands';

interface VideoGenerationControllerOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useVideoGenerationController(options: VideoGenerationControllerOptions): void {
  const {
    adoptDurableSnapshot,
    runProductCommand,
    setOperationToast,
    setSelectedBlocks,
    snapshotRef,
    t,
  } = options;
  const inFlightBlockIdsRef = useRef(new Set<string>());

  async function updateVideoDraft(input: WhiteboardVideoDraftUpdateV1): Promise<void> {
    await requireProductCommands(runProductCommand)(
      (commands) => commands.videoGeneration.updateDraft(input),
    );
  }

  async function generateVideo(blockId: string): Promise<void> {
    if (inFlightBlockIdsRef.current.has(blockId)) return;
    const base = snapshotRef.current;
    const block = base.blocks.find(
      (candidate) => candidate.blockId === blockId && candidate.type === 'video',
    );
    if (!block || blockLockedByGroup(base, block.blockId)) return;
    const draft = block.data.executionDraft;
    const executionProfileId = draft?.executionProfileId ?? 'video-mock';
    const scope = scopeFor(base);
    inFlightBlockIdsRef.current.add(blockId);
    try {
      if (executionProfileId === 'video-seedance-modelark' || executionProfileId === 'video-dreamina-cli') {
        const usesDreaminaCli = executionProfileId === 'video-dreamina-cli';
        const started = await (usesDreaminaCli ? startDreaminaCliVideo : startSeedanceVideo)({
          ...scope,
          targetBlockId: blockId,
          prompt: draft?.prompt ?? '',
          durationSeconds: numberParam(draft?.parameters.durationSeconds, 8),
          outputCount: numberParam(draft?.parameters.outputCount, 1),
          aspectRatio: stringParam(draft?.parameters.aspectRatio, '9:16'),
          connectionId: draft?.connectionId ?? undefined,
        });
        adoptIfCurrent(started.snapshot);
        if (isCurrentScope(scope)) {
          setSelectedBlocks(snapshotRef.current, started.execution.outputBlockIds);
        }
        setOperationToast({
          id: started.execution.executionId,
          title: t(usesDreaminaCli ? 'videoGeneration.dreaminaStarted' : 'videoGeneration.seedanceStarted'),
          body: t(usesDreaminaCli ? 'videoGeneration.dreaminaCostNotice' : 'videoGeneration.seedanceCostNotice'),
          tone: 'success',
        });
        await pollProviderExecution(started.execution.executionId, scope, usesDreaminaCli);
        return;
      }

      const completed = await requireProductCommands(runProductCommand)(
        (commands) => commands.videoGeneration.generateMock({
          blockId,
          expectedScope: scope,
        }),
        { history: true },
      );
      if (isCurrentScope(completed.scope)) {
        setSelectedBlocks(snapshotRef.current, completed.outputBlockIds);
      }
      setOperationToast({
        id: completed.executionId,
        title: t('videoGeneration.mockCompleted'),
        body: t('videoGeneration.mockNotice'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: `video-generation:${blockId}`,
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
      const detail = (event as CustomEvent<WhiteboardVideoDraftUpdateV1>).detail;
      if (detail?.blockId) {
        void updateVideoDraft(detail).catch((error) => setOperationToast({
          id: `video-draft:${detail.blockId}`,
          title: t('videoGeneration.failed'),
          body: error instanceof Error ? error.message : t('videoGeneration.failed'),
          tone: 'error',
        }));
      }
    }
    function onGenerate(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (blockId) void generateVideo(blockId);
    }
    function onCancelProviderExecution(event: Event): void {
      const detail = (event as CustomEvent<{
        adapterId?: string;
        boardId?: string;
        executionId?: string;
        projectId?: string;
        providerTaskIds?: string[];
      }>).detail;
      if (!detail?.projectId || !detail.boardId || !detail.executionId) return;
      const cancel = detail.adapterId === 'retake.video.dreamina-cli'
        ? cancelDreaminaCliVideo
        : cancelSeedanceVideo;
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

  async function pollProviderExecution(
    executionId: string,
    scope: CanvasHostScopeV1,
    usesDreaminaCli: boolean,
  ): Promise<void> {
    while (true) {
      await delay(1_500);
      const latest = await loadBoardSnapshot(scope);
      const execution = latest.executions.find((candidate) => candidate.executionId === executionId);
      adoptIfCurrent(latest);
      if (!execution) throw new Error(`Video execution disappeared while waiting: ${executionId}`);
      if (execution.status === 'queued' || execution.status === 'running') continue;
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

  function adoptIfCurrent(snapshot: BoardSnapshot): boolean {
    if (!isCurrentScope(scopeFor(snapshot))) return false;
    adoptDurableSnapshot(snapshot);
    return true;
  }

  function isCurrentScope(scope: CanvasHostScopeV1): boolean {
    return snapshotRef.current.project.projectId === scope.projectId
      && snapshotRef.current.board.boardId === scope.boardId;
  }
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return { boardId: snapshot.board.boardId, projectId: snapshot.project.projectId };
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function requireProductCommands(
  runProductCommand: VideoGenerationControllerOptions['runProductCommand'],
): NonNullable<VideoGenerationControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard Video generation command facade is unavailable.');
  }
  return runProductCommand;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
