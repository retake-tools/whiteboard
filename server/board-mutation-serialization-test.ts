import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBoardMutationQueue } from '../src/app/boardMutationQueue';

const order: string[] = [];
let releaseExternalWrite: (() => void) | undefined;
const externalWrite = new Promise<void>((resolve) => {
  releaseExternalWrite = resolve;
});
const queue = createBoardMutationQueue();

const workflowApproval = queue.run(async () => {
  order.push('workflow-host-command');
  await externalWrite;
  order.push('workflow-external-write-adopted');
});
const backgroundAgentReconcile = queue.run(async () => {
  order.push('agent-background-reconcile');
});

await Promise.resolve();
assert.equal(queue.isPending(), true);
assert.deepEqual(order, ['workflow-host-command']);
releaseExternalWrite?.();
await Promise.all([workflowApproval, backgroundAgentReconcile]);
assert.deepEqual(order, [
  'workflow-host-command',
  'workflow-external-write-adopted',
  'agent-background-reconcile',
]);
assert.equal(queue.isPending(), false);

await assert.rejects(
  () => queue.run(async () => {
    throw new Error('expected write failure');
  }),
  /expected write failure/,
);
await queue.run(async () => {
  order.push('command-after-failure');
});
assert.equal(order.at(-1), 'command-after-failure');

const [boardSessionSource, workflowRuntimeSource, agentRuntimeSource] = await Promise.all([
  readFile('src/app/useBoardSession.ts', 'utf8'),
  readFile('src/app/useWorkflowRuntimeController.ts', 'utf8'),
  readFile('src/app/useAgentRuntimeController.ts', 'utf8'),
]);
assert.match(boardSessionSource, /requireBoardMutationQueue\(\)\.run\(async \(\) =>/);
assert.match(boardSessionSource, /next = await options\.afterCommit/);
assert.match(boardSessionSource, /replaceDurableSnapshot\(next\)/);
assert.match(boardSessionSource, /if \(commandCommitted\) await recoverCurrentDurableSnapshot\(\)/);
assert.match(workflowRuntimeSource, /afterCommit:[\s\S]*materializeAcceptedWorkflowOutput/);
assert.match(workflowRuntimeSource, /afterCommit:[\s\S]*reconcileAgentArtifactTarget/);
assert.match(agentRuntimeSource, /afterCommit:[\s\S]*reconcileWorkflowArtifactGates/);

console.log({
  backgroundReconcileWaitsForDurableAdoption: true,
  failedMutationDoesNotPoisonQueue: true,
  workflowWritebacksUseSerializedAfterCommit: true,
});
