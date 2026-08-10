import assert from 'node:assert/strict';
import { isBenignResizeObserverError } from '../src/core/resizeObserverErrorGuard';

assert.equal(
  isBenignResizeObserverError('ResizeObserver loop completed with undelivered notifications.'),
  true,
);
assert.equal(isBenignResizeObserverError('ResizeObserver loop limit exceeded'), true);
assert.equal(isBenignResizeObserverError('Unexpected application failure'), false);
assert.equal(isBenignResizeObserverError('ResizeObserver'), false);

console.log(JSON.stringify({
  exactResizeObserverErrorsSuppressed: true,
  unrelatedErrorsPreserved: true,
}));
