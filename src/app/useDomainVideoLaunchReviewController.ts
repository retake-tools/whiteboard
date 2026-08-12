import { useEffect, useState, type RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { loadBoardSnapshot } from '../core/boardStore';
import type { DomainVideoLaunchReviewV1 } from '../core/domainVideoGenerationContracts';
import {
  loadDomainVideoLaunchReview,
  startAuthorizedDomainVideoGeneration,
} from '../core/domainVideoLaunchReviewClient';
import type { BoardSnapshot } from '../core/types';
import type { CanvasHostScopeV1 } from '../host-kit';

export interface DomainVideoLaunchReviewState {
  blockId: string;
  error?: string;
  executing?: boolean;
  loading: boolean;
  review?: DomainVideoLaunchReviewV1;
}

interface DomainVideoLaunchReviewControllerOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  boardId: string;
  projectId: string;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
}

export function useDomainVideoLaunchReviewController(
  options: DomainVideoLaunchReviewControllerOptions,
): {
  authorizeDomainVideoGeneration: () => Promise<void>;
  closeDomainVideoLaunchReview: () => void;
  domainVideoLaunchReview: DomainVideoLaunchReviewState | undefined;
} {
  const {
    adoptDurableSnapshot,
    boardId,
    projectId,
    setOperationToast,
    setSelectedBlocks,
    snapshotRef,
  } = options;
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
    const scope = scopeFor(snapshotRef.current);
    try {
      const started = await startAuthorizedDomainVideoGeneration({
        blockId: currentState.blockId,
        ...scope,
        requestFingerprint: request.requestFingerprint,
      });
      adoptIfCurrent(started.snapshot);
      if (isCurrentScope(scope)) {
        setSelectedBlocks(snapshotRef.current, started.execution.outputBlockIds);
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
        void pollExecution(started.execution.executionId, scope).catch((error) => {
          setOperationToast({
            id: started.execution.executionId,
            title: 'Domain Video 生成失败',
            body: error instanceof Error ? error.message : 'Domain Video execution failed.',
            tone: 'error',
          });
        });
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

  async function pollExecution(executionId: string, scope: CanvasHostScopeV1): Promise<void> {
    while (true) {
      await delay(1_500);
      const latest = await loadBoardSnapshot(scope);
      const execution = latest.executions.find(
        (candidate) => candidate.executionId === executionId,
      );
      adoptIfCurrent(latest);
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

  function adoptIfCurrent(snapshot: BoardSnapshot): boolean {
    if (!isCurrentScope(scopeFor(snapshot))) return false;
    adoptDurableSnapshot(snapshot);
    return true;
  }

  function isCurrentScope(scope: CanvasHostScopeV1): boolean {
    return snapshotRef.current.project.projectId === scope.projectId
      && snapshotRef.current.board.boardId === scope.boardId;
  }

  return {
    authorizeDomainVideoGeneration,
    closeDomainVideoLaunchReview: () => setState(undefined),
    domainVideoLaunchReview: state,
  };
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return { boardId: snapshot.board.boardId, projectId: snapshot.project.projectId };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
