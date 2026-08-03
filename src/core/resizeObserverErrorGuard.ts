const BENIGN_RESIZE_OBSERVER_ERRORS = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]);

export function isBenignResizeObserverError(message: string): boolean {
  return BENIGN_RESIZE_OBSERVER_ERRORS.has(message);
}

export function installResizeObserverErrorGuard(target: Window = window): () => void {
  const suppressBenignResizeObserverError = (event: ErrorEvent): void => {
    if (isBenignResizeObserverError(event.message)) event.preventDefault();
  };

  target.addEventListener('error', suppressBenignResizeObserverError, { capture: true });
  return () => target.removeEventListener('error', suppressBenignResizeObserverError, { capture: true });
}
