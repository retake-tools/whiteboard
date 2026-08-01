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
const mirroredClickSuppressionMs = 250;

interface CompletedTap {
  completedAt: number;
  gestureKey: string;
  x: number;
  y: number;
}

interface UseCanvasImageDoubleTapOptions {
  gestureKeyForTarget: (target: EventTarget | null) => string | undefined;
  onDoubleTap: (gestureKey: string) => void;
}

export function useCanvasImageDoubleTap({
  gestureKeyForTarget,
  onDoubleTap,
}: UseCanvasImageDoubleTapOptions): {
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const activeGestureCleanupRef = useRef<(() => void) | undefined>(undefined);
  const completedTapRef = useRef<CompletedTap | undefined>(undefined);
  const pointerCompletionRef = useRef<CompletedTap | undefined>(undefined);
  const suppressedClicksUntilRef = useRef(0);
  const gestureKeyForTargetRef = useRef(gestureKeyForTarget);
  const onDoubleTapRef = useRef(onDoubleTap);
  gestureKeyForTargetRef.current = gestureKeyForTarget;
  onDoubleTapRef.current = onDoubleTap;

  const openDoubleTap = useCallback((gestureKey: string, timeStamp: number) => {
    completedTapRef.current = undefined;
    pointerCompletionRef.current = undefined;
    suppressedClicksUntilRef.current = timeStamp + mirroredClickSuppressionMs;
    onDoubleTapRef.current(gestureKey);
  }, []);

  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;

    activeGestureCleanupRef.current?.();
    activeGestureCleanupRef.current = undefined;

    const gestureKey = gestureKeyForTargetRef.current(event.target);
    if (!gestureKey) {
      completedTapRef.current = undefined;
      pointerCompletionRef.current = undefined;
      return;
    }
    const resolvedGestureKey = gestureKey;
    if (matchesCompletedTap(completedTapRef.current, gestureKey, event)) {
      openDoubleTap(gestureKey, event.timeStamp);
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
        completedTapRef.current = undefined;
        pointerCompletionRef.current = undefined;
        return;
      }
      const completedTap = {
        completedAt: pointerEvent.timeStamp,
        gestureKey: resolvedGestureKey,
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      };
      completedTapRef.current = completedTap;
      pointerCompletionRef.current = completedTap;
    }

    function handlePointerCancel(pointerEvent: PointerEvent): void {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      completedTapRef.current = undefined;
      pointerCompletionRef.current = undefined;
    }

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    activeGestureCleanupRef.current = cleanup;
  }, [openDoubleTap]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.timeStamp <= suppressedClicksUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    suppressedClicksUntilRef.current = 0;

    const gestureKey = gestureKeyForTargetRef.current(event.target);
    if (!gestureKey) {
      completedTapRef.current = undefined;
      pointerCompletionRef.current = undefined;
      return;
    }
    const pointerCompletion = pointerCompletionRef.current;
    if (
      pointerCompletion !== undefined
      && matchesCompletedTap(pointerCompletion, gestureKey, event)
      && event.timeStamp - pointerCompletion.completedAt
        <= mirroredClickSuppressionMs
    ) {
      pointerCompletionRef.current = undefined;
      return;
    }
    pointerCompletionRef.current = undefined;
    if (matchesCompletedTap(completedTapRef.current, gestureKey, event)) {
      openDoubleTap(gestureKey, event.timeStamp);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    completedTapRef.current = {
      completedAt: event.timeStamp,
      gestureKey,
      x: event.clientX,
      y: event.clientY,
    };
  }, [openDoubleTap]);

  useEffect(() => () => {
    activeGestureCleanupRef.current?.();
  }, []);

  return { onClickCapture, onPointerDownCapture };
}

function matchesCompletedTap(
  completedTap: CompletedTap | undefined,
  gestureKey: string,
  event: Pick<MouseEvent | PointerEvent, 'clientX' | 'clientY' | 'timeStamp'>,
): boolean {
  return completedTap?.gestureKey === gestureKey
    && event.timeStamp - completedTap.completedAt <= doubleTapDelayMs
    && Math.hypot(event.clientX - completedTap.x, event.clientY - completedTap.y)
      <= doubleTapPositionTolerancePx;
}
