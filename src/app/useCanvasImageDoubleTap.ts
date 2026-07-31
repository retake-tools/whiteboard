import {
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const doubleTapDelayMs = 1_000;
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
  const completedTapRef = useRef<CompletedTap | undefined>(undefined);
  const suppressedClicksUntilRef = useRef(0);
  const gestureKeyForTargetRef = useRef(gestureKeyForTarget);
  const onDoubleTapRef = useRef(onDoubleTap);
  gestureKeyForTargetRef.current = gestureKeyForTarget;
  onDoubleTapRef.current = onDoubleTap;

  const openDoubleTap = useCallback((gestureKey: string, timeStamp: number) => {
    completedTapRef.current = undefined;
    suppressedClicksUntilRef.current = timeStamp + mirroredClickSuppressionMs;
    onDoubleTapRef.current(gestureKey);
  }, []);

  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const gestureKey = gestureKeyForTargetRef.current(event.target);
    if (!gestureKey) {
      completedTapRef.current = undefined;
      return;
    }
    if (!matchesCompletedTap(completedTapRef.current, gestureKey, event)) return;
    openDoubleTap(gestureKey, event.timeStamp);
    event.preventDefault();
    event.stopPropagation();
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
      return;
    }
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
