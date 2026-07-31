import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const doubleTapDelayMs = 1_000;
const tapMaxDurationMs = 600;
const tapMoveTolerancePx = 10;
const doubleTapPositionTolerancePx = 32;
const mirroredClickDelayMs = 250;

interface CompletedTap {
  completedAt: number;
  x: number;
  y: number;
}

const completedTapsByGestureKey = new Map<string, CompletedTap>();
const pointerCompletionsByGestureKey = new Map<string, CompletedTap>();
const suppressedClicksUntilByGestureKey = new Map<string, number>();

interface UseImagePreviewDoubleTapOptions {
  enabled: boolean;
  gestureKey: string;
  onDoubleTap: () => void;
}

export function useImagePreviewDoubleTap({
  enabled,
  gestureKey,
  onDoubleTap,
}: UseImagePreviewDoubleTapOptions): {
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  onDoubleClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const activeGestureCleanupRef = useRef<(() => void) | undefined>(undefined);
  const onDoubleTapRef = useRef(onDoubleTap);
  onDoubleTapRef.current = onDoubleTap;

  const openDoubleTap = useCallback((timeStamp: number) => {
    completedTapsByGestureKey.delete(gestureKey);
    pointerCompletionsByGestureKey.delete(gestureKey);
    suppressedClicksUntilByGestureKey.set(
      gestureKey,
      timeStamp + mirroredClickDelayMs,
    );
    onDoubleTapRef.current();
  }, [gestureKey]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || !event.isPrimary) return;

    activeGestureCleanupRef.current?.();
    activeGestureCleanupRef.current = undefined;

    const previousTap = completedTapsByGestureKey.get(gestureKey);
    if (matchesPreviousTap(previousTap, event)) {
      openDoubleTap(event.timeStamp);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const pointerId = event.pointerId;
    const startedAt = event.timeStamp;
    const startedX = event.clientX;
    const startedY = event.clientY;
    let moved = false;

    function cleanup(): void {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      if (activeGestureCleanupRef.current === cleanup) {
        activeGestureCleanupRef.current = undefined;
      }
    }

    function handlePointerMove(pointerEvent: PointerEvent): void {
      if (pointerEvent.pointerId !== pointerId || moved) return;
      moved = Math.hypot(
        pointerEvent.clientX - startedX,
        pointerEvent.clientY - startedY,
      ) > tapMoveTolerancePx;
    }

    function handlePointerUp(pointerEvent: PointerEvent): void {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      if (moved || pointerEvent.timeStamp - startedAt > tapMaxDurationMs) {
        completedTapsByGestureKey.delete(gestureKey);
        pointerCompletionsByGestureKey.delete(gestureKey);
        return;
      }
      const completedTap = {
        completedAt: pointerEvent.timeStamp,
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      };
      completedTapsByGestureKey.set(gestureKey, completedTap);
      pointerCompletionsByGestureKey.set(gestureKey, completedTap);
    }

    function handlePointerCancel(pointerEvent: PointerEvent): void {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      completedTapsByGestureKey.delete(gestureKey);
      pointerCompletionsByGestureKey.delete(gestureKey);
    }

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    activeGestureCleanupRef.current = cleanup;
  }, [enabled, gestureKey, openDoubleTap]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    const suppressedUntil = suppressedClicksUntilByGestureKey.get(gestureKey);
    if (suppressedUntil !== undefined && event.timeStamp <= suppressedUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    suppressedClicksUntilByGestureKey.delete(gestureKey);

    const pointerCompletion = pointerCompletionsByGestureKey.get(gestureKey);
    if (
      pointerCompletion
      && event.timeStamp - pointerCompletion.completedAt <= mirroredClickDelayMs
      && distanceFromTap(pointerCompletion, event) <= doubleTapPositionTolerancePx
    ) {
      pointerCompletionsByGestureKey.delete(gestureKey);
      return;
    }
    pointerCompletionsByGestureKey.delete(gestureKey);

    const previousTap = completedTapsByGestureKey.get(gestureKey);
    if (matchesPreviousTap(previousTap, event)) {
      openDoubleTap(event.timeStamp);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    completedTapsByGestureKey.set(gestureKey, {
      completedAt: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    });
  }, [enabled, gestureKey, openDoubleTap]);

  const onDoubleClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    const suppressedUntil = suppressedClicksUntilByGestureKey.get(gestureKey);
    if (suppressedUntil === undefined || event.timeStamp > suppressedUntil) {
      openDoubleTap(event.timeStamp);
    }
    event.preventDefault();
    event.stopPropagation();
  }, [enabled, gestureKey, openDoubleTap]);

  useEffect(() => () => {
    activeGestureCleanupRef.current?.();
  }, []);

  return { onClickCapture, onDoubleClickCapture, onPointerDown };
}

function matchesPreviousTap(
  previousTap: CompletedTap | undefined,
  event: Pick<MouseEvent | PointerEvent, 'clientX' | 'clientY' | 'timeStamp'>,
): boolean {
  return previousTap !== undefined
    && event.timeStamp - previousTap.completedAt <= doubleTapDelayMs
    && distanceFromTap(previousTap, event) <= doubleTapPositionTolerancePx;
}

function distanceFromTap(
  tap: CompletedTap,
  event: Pick<MouseEvent | PointerEvent, 'clientX' | 'clientY'>,
): number {
  return Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
}
