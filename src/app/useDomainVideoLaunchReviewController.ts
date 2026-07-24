import { useEffect, useState, type RefObject } from 'react';
import {
  type DomainVideoLaunchReviewV1,
} from '../core/domainVideoGenerationContracts';
import {
  loadDomainVideoLaunchReview,
  startAuthorizedDomainVideoGeneration,
} from '../core/domainVideoLaunchReviewClient';
import { loadBoardSnapshot } from '../core/boardStore';
import type { BoardSnapshot } from '../core/types';
import type { OperationToast } from '../components/OperationFeedback';

export interface DomainVideoLaunchReviewState {
  blockId: string;
  error?: string;
  executing?: boolean;
  loading: boolean;
  review?: DomainVideoLaunchReviewV1;
}

export function useDomainVideoLaunchReviewController(
  snapshotRef: RefObject<BoardSnapshot>,
  projectId: string,
  boardId: string,
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot,
  setOperationToast: (toast: OperationToast | undefined) => void,
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void,
): {
  authorizeDomainVideoGeneration: () => Promise<void>;
  closeDomainVideoLaunchReview: () => void;
  domainVideoLaunchReview: DomainVideoLaunchReviewState | undefined;
} {
  const [state, setState] = useState<DomainVideoLaunchReviewState>();

  useEffect(() => {
    const openReview = (event: Event) => {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      setState({ blockId, loading: true });
      const current = snapshotRef.current;
      void loadDomainVideoLaunchReview({
        blockId,
        boardId: current.board.boardId,
        projectId: current.project.projectId,
      })
        .then((review) => setState({ blockId, loading: false, review }))
        .catch((error) => setState({
          blockId,
          error: error instanceof Error ? error.message : 'Launch Review failed.',
          loading: false,
        }));
    };
    window.addEventListener('retake:open-domain-video-launch-review', openReview);
    return () => window.removeEventListener('retake:open-domain-video-launch-review', openReview);
  }, [snapshotRef]);

  useEffect(() => setState(undefined), [boardId, projectId]);

  async function authorizeDomainVideoGeneration(): Promise<void> {
    const currentState = state;
    const request = currentState?.review?.request;
    if (!currentState || !currentState.review?.ready || !request || currentState.executing) return;
    setState({ ...currentState, executing: true, error: undefined });
    const scope = snapshotRef.current;
    try {
      const started = await startAuthorizedDomainVideoGeneration({
        blockId: currentState.blockId,
        boardId: scope.board.boardId,
        projectId: scope.project.projectId,
        requestFingerprint: request.requestFingerprint,
      });
      if (
        snapshotRef.current.board.boardId === scope.board.boardId
        && snapshotRef.current.project.projectId === scope.project.projectId
      ) {
        const next = updateSnapshot(() => started.snapshot, {
          history: true,
          persist: false,
        });
        setSelectedBlocks(next, started.execution.outputBlockIds);
      }
      setState(undefined);
      setOperationToast({
        id: started.execution.executionId,
        title: started.execution.status === 'succeeded'
          ? 'Domain Video 已完成'
          : 'Domain Video 已授权并开始执行',
        body: started.execution.providerExecutionAuthorization?.action === 'provider_submit'
          ? '授权只适用于本次精确请求。'
          : '本地 Mock 未触发外部 Provider。',
        tone: 'success',
      });
      if (started.execution.status === 'queued' || started.execution.status === 'running') {
        void pollExecution(started.execution.executionId, scope);
      }
    } catch (error) {
      setState((latest) => latest?.blockId === currentState.blockId
        ? {
            ...latest,
            executing: false,
            error: error instanceof Error ? error.message : 'Domain Video execution failed.',
          }
        : latest);
    }
  }

  async function pollExecution(executionId: string, scope: BoardSnapshot): Promise<void> {
    while (true) {
      await delay(1_500);
      const latest = await loadBoardSnapshot({
        projectId: scope.project.projectId,
        boardId: scope.board.boardId,
      });
      const execution = latest.executions.find(
        (candidate) => candidate.executionId === executionId,
      );
      if (
        snapshotRef.current.project.projectId === scope.project.projectId
        && snapshotRef.current.board.boardId === scope.board.boardId
      ) {
        updateSnapshot(() => latest, { history: false, persist: false });
      }
      if (!execution) {
        setOperationToast({
          id: executionId,
          title: 'Domain Video 生成失败',
          body: `Execution disappeared while waiting: ${executionId}`,
          tone: 'error',
        });
        return;
      }
      if (execution.status === 'queued' || execution.status === 'running') continue;
      setOperationToast({
        id: executionId,
        title: execution.status === 'succeeded'
          ? 'Domain Video 生成完成'
          : execution.status === 'canceled'
            ? 'Domain Video 已取消'
            : 'Domain Video 生成失败',
        body: execution.errorMessage,
        tone: execution.status === 'succeeded' ? 'success' : 'error',
      });
      return;
    }
  }

  return {
    authorizeDomainVideoGeneration,
    closeDomainVideoLaunchReview: () => setState(undefined),
    domainVideoLaunchReview: state,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
