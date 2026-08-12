import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { cacheExecutionProviderSettings } from '../src/core/executionProviderPreferences';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import type { TextGenerationLabels } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';
import {
  videoGenerationFromApprovedPackageSkill,
  videoStudioPackage,
} from './studio-domain-test-fixtures';

const initial = createBlankBoardSnapshot({
  boardId: 'board_whiteboard_text_generation_commands',
  boardName: 'Text generation product commands',
  projectId: 'project_whiteboard_text_generation_commands',
  projectName: 'Text generation product commands',
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

const textDraft = await commands.operationDraft.createText({
  labels: textLabels(),
  placementCenter: { x: 600, y: 400 },
});
assert.equal(publications, 1);
assert.equal(textDraft.blockIds.length, 2);
const draftSnapshot = host.readModel.getSnapshot();
const prompt = draftSnapshot.blocks.find((block) => block.blockId === textDraft.blockIds[0]);
const operation = draftSnapshot.blocks.find((block) => block.blockId === textDraft.blockIds[1]);
assert.equal(prompt?.type, 'text');
assert.equal(operation?.type, 'operation');
assert.equal(operation?.data.capabilityId, 'text.generate');
assert.equal(operation?.data.connectionId, 'codex-app-server');
assert.equal(prompt!.position.y + prompt!.size.height / 2, 400);
assert.equal(operation!.position.y + operation!.size.height / 2, 400);
assert.equal(
  operation!.position.x - (prompt!.position.x + prompt!.size.width),
  80,
  'Draft command preserves the existing horizontal layout gap.',
);
assert.equal(
  (await storage.loadBoard(scopeFor(initial))).blocks.length,
  2,
  'Draft projection is durable when the command resolves.',
);
await host.commands.updateBlock({
  blockId: prompt!.blockId,
  body: 'Write a concise scene about a cat director.',
});
assert.equal(publications, 2);

const capabilityId = videoGenerationFromApprovedPackageSkill.capabilityBindings[0]?.capabilityId;
assert(capabilityId);
const skillDraft = await commands.operationDraft.createSkill({
  capabilityId,
  labels: textLabels(),
  packageContext: {
    entrypointId: 'fixture.video-generation',
    packageLock: {
      digest: videoStudioPackage.digest,
      packageId: videoStudioPackage.packageId,
      version: videoStudioPackage.version,
    },
  },
  placementCenter: { x: 1_300, y: 400 },
  selectedBlockIds: [],
  skillId: videoGenerationFromApprovedPackageSkill.skillId,
});
assert.equal(publications, 3);
assert.equal(skillDraft.blockIds.length, 2);
const skillOperation = host.readModel.getSnapshot().blocks.find(
  (block) => block.blockId === skillDraft.blockIds[1],
);
assert.equal(skillOperation?.data.capabilityId, capabilityId);
assert.equal(skillOperation?.data.connectionId, 'retake-mock');

cacheExecutionProviderSettings(initial.project.projectId, settings(readyTextConnection()));
const queued = await commands.textGeneration.queue({
  connectionUnavailableMessage: 'Fixture connection unavailable.',
  expectedScope: scopeFor(initial),
  labels: textLabels(),
  operationBlockId: operation!.blockId,
});
assert.equal(publications, 4, 'Execution staging publishes exactly once.');
assert.equal(queued.capabilityId, 'text.generate');
assert.equal(queued.connectionId, 'codex-app-server');
assert.deepEqual(queued.scope, scopeFor(initial));
const queuedSnapshot = host.readModel.getSnapshot();
assert.equal(
  queuedSnapshot.executions.find((execution) => execution.executionId === queued.executionId)?.status,
  'queued',
);
assert.equal(
  queuedSnapshot.blocks.find((block) => block.blockId === queued.resultBlockId)?.type,
  'document',
);
assert.equal(
  (await storage.loadBoard(scopeFor(initial))).executions.some(
    (execution) => execution.executionId === queued.executionId,
  ),
  true,
);

const publicationsBeforeRejectedQueue = publications;
await assert.rejects(
  commands.textGeneration.queue({
    connectionUnavailableMessage: 'Fixture connection unavailable.',
    expectedScope: { ...scopeFor(initial), boardId: 'board_wrong_scope' },
    labels: textLabels(),
    operationBlockId: operation!.blockId,
  }),
  /another Project or Board/,
);
assert.equal(publications, publicationsBeforeRejectedQueue);
assert.equal(host.readModel.getSnapshot().executions.length, 1);

const controllerSource = await readFile(
  new URL('../src/app/useTextGenerationController.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(controllerSource, /\bupdateSnapshot\b/);
assert.doesNotMatch(controllerSource, /\bpersistSnapshot\b/);
assert.doesNotMatch(controllerSource, /createDraftTextGenerationOperation/);
assert.doesNotMatch(controllerSource, /executeExistingTextGenerationOperation/);
assert.match(controllerSource, /commands\.operationDraft\.createText/);
assert.match(controllerSource, /commands\.textGeneration\.queue/);
assert.match(controllerSource, /adoptDurableSnapshot/);

unsubscribe();
await host.dispose();

console.log({
  durableDraftProjection: true,
  providerStartOutsideProductTransaction: true,
  serverSnapshotsUseDurableAdoption: true,
  textExecutionQueueIsAtomic: true,
  textExecutionScopeIsExplicit: true,
});

function textLabels(): TextGenerationLabels {
  return {
    operationTitle: 'Generate text',
    promptPlaceholder: 'Write a concise scene.',
    promptTitle: 'Prompt',
    resultTitle: 'Generated text',
    waitingBody: 'Waiting for text generation.',
  };
}

function readyTextConnection(): ExecutionConnectionSummary {
  return {
    configurable: false,
    connectionId: 'codex-app-server',
    connectionKind: 'agent_host',
    connectorId: 'codex-app-server',
    deletable: false,
    description: 'Codex App Server fixture',
    displayName: 'Codex App Server',
    enabled: true,
    enabledUseCases: ['text'],
    hasCredential: false,
    implementationKind: 'agent_bridge',
    modelId: 'gpt-5.6',
    providerLabel: 'Codex',
    status: 'ready',
    supportedCapabilityIds: ['text.generate'],
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
