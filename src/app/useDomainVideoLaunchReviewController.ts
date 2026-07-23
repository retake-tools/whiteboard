import { useEffect, useState, type RefObject } from 'react';
import {
  type DomainVideoLaunchReviewV1,
} from '../core/domainVideoGenerationContracts';
import { loadDomainVideoLaunchReview } from '../core/domainVideoLaunchReviewClient';
import type { BoardSnapshot } from '../core/types';

export interface DomainVideoLaunchReviewState {
  blockId: string;
  error?: string;
  loading: boolean;
  review?: DomainVideoLaunchReviewV1;
}

export function useDomainVideoLaunchReviewController(
  snapshotRef: RefObject<BoardSnapshot>,
  projectId: string,
  boardId: string,
): {
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

  return {
    closeDomainVideoLaunchReview: () => setState(undefined),
    domainVideoLaunchReview: state,
  };
}
