import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  installExecutionEventStream,
  publishExecutionEvent,
  resetExecutionEventsForTests,
} from './execution-events';

resetExecutionEventsForTests();
publishExecutionEvent('exec_sse_test', { type: 'execution.started' });
publishExecutionEvent('exec_sse_test', {
  type: 'text.delta',
  delta: '# Retake',
  resultBlockId: 'block_result_test',
});

const request = new EventEmitter() as IncomingMessage;
request.headers = {};
const chunks: string[] = [];
const headers = new Map<string, string>();
const response = {
  statusCode: 0,
  writableEnded: false,
  setHeader(name: string, value: string) {
    headers.set(name.toLowerCase(), value);
    return this;
  },
  flushHeaders() {},
  write(chunk: string) {
    chunks.push(chunk);
    return true;
  },
} as unknown as ServerResponse;

installExecutionEventStream(request, response, 'exec_sse_test');
assert.equal(response.statusCode, 200);
assert.equal(headers.get('content-type'), 'text/event-stream; charset=utf-8');
assert.match(chunks.join(''), /"type":"execution.started"/);
assert.match(chunks.join(''), /"type":"text.delta"/);

publishExecutionEvent('exec_sse_test', {
  type: 'execution.progress',
  message: 'Generating image 1 of 1',
});
assert.match(chunks.join(''), /Generating image 1 of 1/);
request.emit('close');

console.log(JSON.stringify({ ok: true, replayed: 2, liveEvents: 1 }));
