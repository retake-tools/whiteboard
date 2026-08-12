export interface BoardMutationQueue {
  isPending(): boolean;
  run<Result>(operation: () => Promise<Result>): Promise<Result>;
}

export function createBoardMutationQueue(): BoardMutationQueue {
  let pendingCount = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    isPending: () => pendingCount > 0,
    run<Result>(operation: () => Promise<Result>): Promise<Result> {
      pendingCount += 1;
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result.finally(() => {
        pendingCount = Math.max(0, pendingCount - 1);
      });
    },
  };
}
