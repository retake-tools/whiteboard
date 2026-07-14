import { useEffect, useRef, type RefObject } from 'react';

export const dismissPopoversEvent = 'retake:dismiss-popovers';

interface DismissiblePopoverOptions {
  active: boolean;
  additionalRefs?: readonly RefObject<HTMLElement | null>[];
  insideSelector?: string;
  onDismiss: () => void;
  rootRef: RefObject<HTMLElement | null>;
}

export function useDismissiblePopover(options: DismissiblePopoverOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!options.active) return;

    function onPointerDown(event: PointerEvent): void {
      const current = optionsRef.current;
      const target = event.target instanceof Node ? event.target : null;
      if (target && targetIsInside(target, current)) return;
      current.onDismiss();
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') optionsRef.current.onDismiss();
    }

    function onDismissRequested(): void {
      optionsRef.current.onDismiss();
    }

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener(dismissPopoversEvent, onDismissRequested);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener(dismissPopoversEvent, onDismissRequested);
    };
  }, [options.active]);
}

function targetIsInside(target: Node, options: DismissiblePopoverOptions): boolean {
  if (options.additionalRefs?.some((ref) => ref.current?.contains(target))) return true;
  const root = options.rootRef.current;
  if (!root?.contains(target)) return false;
  if (!options.insideSelector) return true;
  const element = target instanceof Element ? target : target.parentElement;
  const insideControl = element?.closest(options.insideSelector);
  return Boolean(insideControl && root.contains(insideControl));
}
