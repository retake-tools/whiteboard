import assert from 'node:assert/strict';
import { defaultBlockSize, fitImageBlockSize, fitMediaBlockSize } from '../src/core/blockSizing';
import { managedResultStatusMessageKey } from '../src/core/resultStatus';

assert.deepEqual(defaultBlockSize('image'), { width: 300, height: 230 });
assert.deepEqual(defaultBlockSize('text'), { width: 260, height: 170 });
assert.deepEqual(defaultBlockSize('video'), { width: 300, height: 180 });
assert.deepEqual(defaultBlockSize('operation'), { width: 320, height: 190 });

assert.deepEqual(fitImageBlockSize(1086, 1448), { width: 285, height: 380 });
assert.deepEqual(fitMediaBlockSize(9 / 16), { width: 214, height: 380 });
assert.deepEqual(fitMediaBlockSize(16 / 9), { width: 380, height: 214 });
assert.deepEqual(fitMediaBlockSize(1), { width: 380, height: 380 });
assert.equal(managedResultStatusMessageKey({ title: 'Queued', status: 'queued', executionAdapter: 'mcp_agent' }), 'resultStatus.codexQueued');
assert.equal(managedResultStatusMessageKey({ title: 'Running', status: 'running', executionAdapter: 'mcp_agent' }), 'resultStatus.codexRunning');
assert.equal(managedResultStatusMessageKey({ title: 'Queued API', status: 'queued', executionAdapter: 'direct_api' }), 'resultStatus.directApiQueued');
assert.equal(managedResultStatusMessageKey({ title: 'Running API', status: 'running', executionAdapter: 'direct_api' }), 'resultStatus.directApiRunning');

console.log({
  defaults: {
    image: defaultBlockSize('image'),
    operation: defaultBlockSize('operation'),
    text: defaultBlockSize('text'),
    video: defaultBlockSize('video'),
  },
  importedPortrait: fitImageBlockSize(1086, 1448),
  generatedPortrait: fitMediaBlockSize(9 / 16),
});
