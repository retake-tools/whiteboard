import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { cacheExecutionProviderSettings } from '../src/core/executionProviderPreferences';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import type { BoardSnapshot } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';

const initial = createBlankBoardSnapshot({
  boardId: 'board_whiteboard_image_execution_commands',
  boardName: 'Image execution product commands',
  projectId: 'project_whiteboard_image_execution_commands',
  projectName: 'Image execution product commands',
});
const storage = new InMemoryHostStorageAdapter([initial]);
const host = await createCanvasHost({
  connections: createNoopHostConnections(),
  environment: {
    colorScheme: 'light',
    contrast: 'normal',
    direction: 'ltr',
    locale: 'en',
    reducedMotion: true,
    themeId: 'retake.whiteboard.test',
  },
  experience: {
    commandOverrides: [],
    profileId: 'retake.whiteboard.test',
    schemaVersion: 1,
  },
  initialScope: scopeFor(initial),
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});
const commands = createWhiteboardProductCommands(host);
let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});

cacheExecutionProviderSettings(initial.project.projectId, settings(readyImageConnection()));
const draft = await commands.imageOperation.createTextToImageDraft({
  presentation: {
    operationTitle: 'Generate image',
    promptBody: 'Generate a rainy neon street.',
    promptTitle: 'Prompt',
  },
});
assert.equal(publications, 1);

const queued = await commands.imageExecution.queue({
  connectionAdapterUnavailableMessage: 'Fixture image adapter unavailable.',
  connectionUnavailableMessage: 'Fixture image connection unavailable.',
  expectedScope: scopeFor(initial),
  inputBindingRequiredMessage: 'Fixture image input binding required.',
  operation: 'text_to_image',
  operationBlockId: draft.operationBlockId,
});
assert.equal(publications, 2, 'Image execution staging publishes exactly once.');
assert.equal(queued.connectionId, 'codex-app-server');
assert.equal(queued.route, 'codex_app_server');
assert.deepEqual(queued.scope, scopeFor(initial));
assert.match(queued.prompt, /rainy neon street/);
assert.equal(queued.resultBlockIds.length, 1);
const queuedSnapshot = host.readModel.getSnapshot();
const queuedExecution = queuedSnapshot.executions.find(
  (execution) => execution.executionId === queued.executionId,
);
assert.equal(queuedExecution?.status, 'queued');
assert.equal(queuedExecution?.adapter, 'codex_app_server');
assert.equal(
  queuedSnapshot.blocks.find((block) => block.blockId === queued.resultBlockIds[0])?.type,
  'image',
);
assert.equal(
  (await storage.loadBoard(scopeFor(initial))).executions.some(
    (execution) => execution.executionId === queued.executionId,
  ),
  true,
  'The queued execution is durable when the command resolves.',
);

const copied = await commands.history.recordPromptCopied({
  blockIds: [...queued.inputBlockIds, ...queued.resultBlockIds],
  executionId: queued.executionId,
  expectedScope: scopeFor(initial),
  prompt: queued.prompt,
  source: 'prompt_preview',
});
assert.equal(publications, 3, 'Prompt copy history publishes exactly once.');
const copiedEvent = host.readModel.getSnapshot().historyEvents?.[0];
assert.equal(copiedEvent?.eventId, copied.eventId);
assert.equal(copiedEvent?.type, 'prompt_copied');
assert.equal(copiedEvent?.executionId, queued.executionId);
assert.equal(copiedEvent?.detail?.source, 'prompt_preview');
assert.equal(
  (await storage.loadBoard(scopeFor(initial))).historyEvents?.[0]?.eventId,
  copied.eventId,
  'Prompt copy history is durable when the command resolves.',
);

const publicationsBeforeRejectedQueue = publications;
await assert.rejects(
  commands.imageExecution.queue({
    connectionAdapterUnavailableMessage: 'Fixture image adapter unavailable.',
    connectionUnavailableMessage: 'Fixture image connection unavailable.',
    expectedScope: { ...scopeFor(initial), boardId: 'board_wrong_scope' },
    inputBindingRequiredMessage: 'Fixture image input binding required.',
    operation: 'text_to_image',
    operationBlockId: draft.operationBlockId,
  }),
  /another Project or Board/,
);
await assert.rejects(
  commands.imageExecution.queue({
    connectionAdapterUnavailableMessage: 'Fixture image adapter unavailable.',
    connectionUnavailableMessage: 'Fixture image connection unavailable.',
    expectedScope: scopeFor(initial),
    inputBindingRequiredMessage: 'Fixture image input binding required.',
    operation: 'text_to_image',
    operationBlockId: 'block_missing',
  }),
  /Image Operation not found/,
);
await assert.rejects(
  commands.history.recordPromptCopied({
    executionId: queued.executionId,
    expectedScope: { ...scopeFor(initial), boardId: 'board_wrong_scope' },
    prompt: queued.prompt,
    source: 'prompt_preview',
  }),
  /another Project or Board/,
);
await assert.rejects(
  commands.history.recordPromptCopied({
    executionId: 'exec_missing',
    expectedScope: scopeFor(initial),
    prompt: queued.prompt,
    source: 'prompt_preview',
  }),
  /Prompt copy Execution not found/,
);
assert.equal(publications, publicationsBeforeRejectedQueue);
assert.equal(host.readModel.getSnapshot().executions.length, 1);

const controllerSource = await readFile(
  new URL('../src/app/useImageOperationController.ts', import.meta.url),
  'utf8',
);
const commandSource = await readFile(
  new URL('../src/whiteboard/application/whiteboardImageExecutionCommands.ts', import.meta.url),
  'utf8',
);
const historyCommandSource = await readFile(
  new URL('../src/whiteboard/application/whiteboardHistoryCommands.ts', import.meta.url),
  'utf8',
);
assert.match(controllerSource, /commands\.imageExecution\.queue\(/);
assert.match(controllerSource, /commands\.history\.recordPromptCopied\(/);
assert.match(controllerSource, /adoptDurableSnapshot/);
assert.doesNotMatch(controllerSource, /\bupdateSnapshot\b/);
assert.doesNotMatch(
  controllerSource,
  /\b(?:addImageCodexOperation|appendPromptCopiedEvent|attachImportedImageAsset|executeExistingImageOperationBlock|executeExistingStoryboardSheetOperation|startImageCodexOperation)\b/,
);
assert.doesNotMatch(
  controllerSource,
  /updateSnapshot\(\(\) => (?:started\.snapshot|latest)/,
);
assert.doesNotMatch(commandSource, /\b(?:startCodexAppServerImage|startVolcengineArkImage)\b/);
assert.match(historyCommandSource, /executeProductTransaction/);

unsubscribe();
await host.dispose();

console.log({
  imageExecutionQueueIsAtomic: true,
  imageExecutionScopeIsExplicit: true,
  promptCopyHistoryIsDurable: true,
  promptCopyHistoryScopeIsExplicit: true,
  providerStartRemainsOutsideProductTransaction: true,
  rejectedImageExecutionDoesNotPublish: true,
  serverSnapshotsUseDurableAdoption: true,
});

function readyImageConnection(): ExecutionConnectionSummary {
  return {
    configurable: false,
    connectionId: 'codex-app-server',
    connectionKind: 'agent_host',
    connectorId: 'codex-app-server',
    deletable: false,
    description: 'Codex App Server fixture',
    displayName: 'Codex App Server',
    enabled: true,
    enabledUseCases: ['image'],
    hasCredential: false,
    implementationKind: 'agent_bridge',
    modelId: 'gpt-5.6',
    providerLabel: 'Codex',
    status: 'ready',
    supportedCapabilityIds: ['image.generate'],
  };
}

function settings(connection: ExecutionConnectionSummary) {
  return {
    connectionTemplates: [],
    connections: [connection],
    connectors: [],
    projectDefaults: [],
    workspaceDefaults: [],
  };
}

function scopeFor(snapshot: BoardSnapshot) {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}
