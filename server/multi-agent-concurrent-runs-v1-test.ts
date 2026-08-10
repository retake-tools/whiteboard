import assert from 'node:assert/strict';
import { agentTaskOverviewForBoard } from '../src/core/agentTaskOverview';
import {
  createAgentRunForOperation,
  nextAgentRunExecutionActions,
  startAgentRun,
} from '../src/core/agentRuntime';
import {
  createAgentSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import { createDraftTextGenerationOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import {
  loadSelectedAgentSessionId,
  resolveSelectedAgentSessionId,
  saveSelectedAgentSessionId,
} from '../src/core/agentWorkspaceViewState';
import { getBoardSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-multi-agent-concurrent-runs-v1')) {
  throw new Error('Multi-Agent concurrency tests require a dedicated disposable Workspace.');
}

const snapshot = await emptySnapshot();
const operationA = readyOperation(snapshot, '制作雨燕快递 IP');
const operationB = readyOperation(snapshot, '制作蛋炒饭 IP');
const runA = createAgentRunForOperation(snapshot, operationA);
const runB = createAgentRunForOperation(snapshot, operationB);
startAgentRun(snapshot, runA.record.agentRunId);
startAgentRun(snapshot, runB.record.agentRunId);

const sessionA = createAgentSession(snapshot, { title: '雨燕设计 Agent' }).session;
const sessionB = createAgentSession(snapshot, { title: '蛋炒饭设计 Agent' }).session;
setAgentSessionRun(snapshot, sessionA.agentSessionId, runA.record.agentRunId);
setAgentSessionRun(snapshot, sessionB.agentSessionId, runB.record.agentRunId);

const actions = nextAgentRunExecutionActions(snapshot);
assert.equal(actions.length, 2, 'each running AgentRun must receive its own next action');
assert.deepEqual(
  new Set(actions.map((action) => action.agentRunId)),
  new Set([runA.record.agentRunId, runB.record.agentRunId]),
);

const overview = agentTaskOverviewForBoard(snapshot, [sessionA, sessionB]);
assert.deepEqual(overview.map((item) => item.taskTitle), ['制作雨燕快递 IP', '制作蛋炒饭 IP']);
assert.equal(overview.every((item) => item.isActive && item.runStatus === 'running'), true);

assert.throws(
  () => setAgentSessionRun(snapshot, sessionB.agentSessionId, runA.record.agentRunId),
  /already has an active task|already belongs to another Agent/,
  'selecting another Agent task must switch Session in UI, never steal its Run',
);

const concurrentWriteBase = await emptySnapshot();
await saveSnapshot(concurrentWriteBase);
const staleWriteA = structuredClone(concurrentWriteBase);
const staleWriteB = structuredClone(concurrentWriteBase);
const staleOperationA = readyOperation(staleWriteA, '并发写回任务 A');
const staleOperationB = readyOperation(staleWriteB, '并发写回任务 B');
const staleRunA = createAgentRunForOperation(staleWriteA, staleOperationA);
const staleRunB = createAgentRunForOperation(staleWriteB, staleOperationB);
startAgentRun(staleWriteA, staleRunA.record.agentRunId);
startAgentRun(staleWriteB, staleRunB.record.agentRunId);
const staleSessionA = createAgentSession(staleWriteA, { title: '并发 Agent A' }).session;
const staleSessionB = createAgentSession(staleWriteB, { title: '并发 Agent B' }).session;
setAgentSessionRun(staleWriteA, staleSessionA.agentSessionId, staleRunA.record.agentRunId);
setAgentSessionRun(staleWriteB, staleSessionB.agentSessionId, staleRunB.record.agentRunId);
await saveSnapshot(staleWriteA);
await saveSnapshot(staleWriteB);
const afterConcurrentWrites = await getBoardSnapshot({
  boardId: concurrentWriteBase.board.boardId,
  projectId: concurrentWriteBase.project.projectId,
});
assert.equal(
  afterConcurrentWrites.blocks.some((block) => block.blockId === staleOperationA),
  true,
  'the second stale launch must preserve the first active Agent task blocks',
);
assert.equal(
  afterConcurrentWrites.blocks.some((block) => block.blockId === staleOperationB),
  true,
);
assert.equal(afterConcurrentWrites.agentRuns?.length, 2);
assert.equal(afterConcurrentWrites.agentSessions?.length, 2);

const viewStateStorage = memoryStorage();
saveSelectedAgentSessionId(
  snapshot.project.projectId,
  snapshot.board.boardId,
  sessionA.agentSessionId,
  viewStateStorage,
);
assert.equal(
  loadSelectedAgentSessionId(
    snapshot.project.projectId,
    snapshot.board.boardId,
    viewStateStorage,
  ),
  sessionA.agentSessionId,
  'the selected Agent must survive a browser refresh on the same Board',
);
assert.equal(
  loadSelectedAgentSessionId(snapshot.project.projectId, 'board_other', viewStateStorage),
  undefined,
  'Agent selection must stay scoped to its Board',
);
assert.equal(
  resolveSelectedAgentSessionId(
    [sessionB.agentSessionId, sessionA.agentSessionId],
    sessionA.agentSessionId,
  ),
  sessionA.agentSessionId,
  'opening an already-open Agent Workspace must not replace the current Agent with the first Session',
);
saveSelectedAgentSessionId(
  snapshot.project.projectId,
  snapshot.board.boardId,
  undefined,
  viewStateStorage,
);
assert.equal(
  loadSelectedAgentSessionId(
    snapshot.project.projectId,
    snapshot.board.boardId,
    viewStateStorage,
  ),
  undefined,
);

const operationC = readyOperation(snapshot, '第三个独立任务');
const runC = createAgentRunForOperation(snapshot, operationC);
startAgentRun(snapshot, runC.record.agentRunId);
assert.throws(
  () => setAgentSessionRun(snapshot, sessionA.agentSessionId, runC.record.agentRunId),
  /already has an active task/,
  'one Agent Session may not own two active AgentRuns',
);

console.log({
  boardConcurrentRuns: true,
  perRunDispatch: true,
  runOwnershipIsolated: true,
  taskOverview: true,
  concurrentLaunchWritesPreserved: true,
  selectedAgentRefreshRecovery: true,
  workspace: workspaceDirectory,
});

async function emptySnapshot(): Promise<BoardSnapshot> {
  const fresh = await resetWorkspace();
  fresh.blocks = [];
  fresh.edges = [];
  fresh.assets = [];
  fresh.executions = [];
  fresh.agentRuns = [];
  fresh.agentSessions = [];
  fresh.agentMessages = [];
  fresh.agentRuntimeBindings = [];
  fresh.agentRuntimeEvents = [];
  fresh.changeProposals = [];
  fresh.changeDecisions = [];
  fresh.workflowRuns = [];
  fresh.workflowStepRuns = [];
  return fresh;
}

function readyOperation(snapshot: BoardSnapshot, title: string): string {
  const draft = createDraftTextGenerationOperation(snapshot, {
    operationTitle: title,
    promptPlaceholder: '请输入任务',
    promptTitle: '任务说明',
    resultTitle: '结果',
    waitingBody: '等待生成',
  });
  draft.promptBlock.data.body = title;
  return draft.operationBlock.blockId;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}
