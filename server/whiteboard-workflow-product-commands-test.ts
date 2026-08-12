import assert from 'node:assert/strict';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import type { TextGenerationLabels } from '../src/core/textOperations';
import { configureWorkflowRegistry } from '../src/core/workflowRegistry';
import { createCanvasHost } from '../src/host-kit';
import { whiteboardCanvasHostBridge } from '../src/host-kit/internal/whiteboardCompatibility';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';
import { createMockExecution } from '../src/core/mockExecution';
import {
  canonicalWorkflowDefinition,
  createWorkflowProjectionTemplate,
  workflowDefinitionIdentity,
} from '../src/core/workflowAuthoringContracts';
import { storyToStoryboardWorkflow } from './studio-domain-test-fixtures';

configureWorkflowRegistry([storyToStoryboardWorkflow]);
const initial = createBlankBoardSnapshot({
  boardId: 'board_whiteboard_workflow_commands',
  boardName: 'Workflow product commands',
  projectId: 'project_whiteboard_workflow_commands',
  projectName: 'Workflow product commands',
});
initial.blocks = [];
initial.edges = [];

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
  initialScope: {
    boardId: initial.board.boardId,
    projectId: initial.project.projectId,
  },
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});

let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});
const commands = createWhiteboardProductCommands(host);
const workflowInputSlotId = storyToStoryboardWorkflow.inputSlots[0]?.slotId;
assert(workflowInputSlotId);
const projection = await commands.workflow.projectDraft({
  composerInput: {
    instruction: {
      body: 'A typed Workflow product command fixture.',
      slotId: workflowInputSlotId,
    },
    mentions: [],
  },
  presentation: {
    connectionIdsByCapability: Object.fromEntries(storyToStoryboardWorkflow.steps.map(
      (step) => [step.capabilityLock.capabilityId, 'test-text-connection'],
    )),
    labelsBySkillId: Object.fromEntries(storyToStoryboardWorkflow.steps.map(
      (step) => [step.skillLock.skillId, labelsForSkill(step.skillLock.skillId)],
    )),
    outputPlaceholder: 'Run the upstream operation.',
    placementCenter: { x: 640, y: 420 },
  },
  projectId: initial.project.projectId,
  workflowId: storyToStoryboardWorkflow.workflowId,
  workflowTitle: 'Story to storyboard plan',
});
assert.equal(publications, 1);
assert.equal(host.readModel.getSnapshot().executions.length, 0);
assert.equal(
  host.readModel.getSnapshot().blocks.find(
    (block) => block.data.workflowInputSlotId === workflowInputSlotId,
  )?.data.body,
  'A typed Workflow product command fixture.',
);
const durableProjection = await storage.loadBoard({
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
});
assert.equal(
  durableProjection.blocks.some((block) => block.blockId === projection.groupBlockId),
  true,
);
const created = await commands.workflow.createRun({
  groupId: projection.groupBlockId,
});
const current = host.readModel.getSnapshot();
assert.equal(publications, 2);
assert.equal(current.workflowRuns?.[0]?.workflowRunId, created.workflowRunId);
assert.equal(current.workflowRuns?.[0]?.status, 'ready');
assert.equal(current.workflowStepRuns?.length, storyToStoryboardWorkflow.steps.length);
const durable = await storage.loadBoard({
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
});
assert.equal(durable.workflowRuns?.[0]?.workflowRunId, created.workflowRunId);
assert.equal(
  durable.blocks.find((block) => block.blockId === projection.groupBlockId)
    ?.data.workflowRunId,
  created.workflowRunId,
);
assert.equal(typeof commands.workflow.acceptOutput, 'function');
assert.equal(typeof commands.workflow.decideGate, 'function');

const agentCreated = await commands.agent.createWorkflowRun({
  workflowRunId: created.workflowRunId,
});
assert.equal(host.readModel.getSnapshot().agentRuns?.[0]?.agentRunId, agentCreated.agentRunId);
assert.equal(host.readModel.getSnapshot().agentRuns?.[0]?.status, 'running');
const reconciliation = await commands.agent.reconcileRuntime();
assert.equal(reconciliation.boardId, initial.board.boardId);
assert.equal(reconciliation.actions.length, 1);
const publicationsAfterReconciliation = publications;
const noOpReconciliation = await commands.agent.reconcileRuntime();
assert.equal(noOpReconciliation.committed, false);
assert.equal(publications, publicationsAfterReconciliation);
const action = noOpReconciliation.actions[0];
assert(action);
const settled = await commands.agent.settleExecution({
  agentRunId: action.agentRunId,
  knownExecutionIds: action.knownExecutionIds,
  operationBlockId: action.operationBlockId,
  stopReason: 'operation_execution_missing',
});
assert.equal(settled.attachedExecution, false);
assert.equal(host.readModel.getSnapshot().agentRuns?.[0]?.status, 'needs_attention');
await commands.agent.control({ action: 'retry', agentRunId: agentCreated.agentRunId });
assert.equal(host.readModel.getSnapshot().agentRuns?.[0]?.status, 'running');
const retryPlan = await commands.agent.reconcileRuntime();
const retryAction = retryPlan.actions[0];
assert(retryAction);
let injectedExecutionId = '';
await whiteboardCanvasHostBridge(host).executeProductTransaction((snapshot) => {
  const { execution } = createMockExecution(snapshot, [retryAction.operationBlockId]);
  const operation = snapshot.blocks.find((block) => block.blockId === retryAction.operationBlockId);
  assert(operation);
  assert.equal(typeof operation.data.capabilityId, 'string');
  execution.capabilityId = operation.data.capabilityId as string;
  execution.params = { operationBlockId: retryAction.operationBlockId };
  execution.workflowRunId = created.workflowRunId;
  injectedExecutionId = execution.executionId;
  snapshot.executions.push(execution);
  return { executionId: execution.executionId };
});
const attached = await commands.agent.settleExecution({
  agentRunId: retryAction.agentRunId,
  knownExecutionIds: retryAction.knownExecutionIds,
  operationBlockId: retryAction.operationBlockId,
  stopReason: 'operation_execution_missing',
});
assert.equal(attached.attachedExecution, true);
assert.equal(
  host.readModel.getSnapshot().executions.find(
    (execution) => execution.executionId === injectedExecutionId,
  )?.agentRunId,
  agentCreated.agentRunId,
);
await commands.agent.control({ action: 'pause', agentRunId: agentCreated.agentRunId });
assert.equal(host.readModel.getSnapshot().agentRuns?.[0]?.status, 'paused');
await commands.agent.control({ action: 'resume', agentRunId: agentCreated.agentRunId });
assert.equal(host.readModel.getSnapshot().agentRuns?.[0]?.status, 'running');
await commands.agent.control({ action: 'cancel', agentRunId: agentCreated.agentRunId });
assert.equal(host.readModel.getSnapshot().agentRuns?.[0]?.status, 'canceled');
assert(publications > publicationsAfterReconciliation);
const durableAfterAgentControl = await storage.loadBoard({
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
});
assert.equal(durableAfterAgentControl.agentRuns?.[0]?.status, 'canceled');
assert.equal(typeof commands.agent.createWorkflowSlice, 'function');
assert.equal(typeof commands.agent.createWorkflowArtifactSlice, 'function');
assert.equal(typeof commands.agent.createWorkflowStageSlice, 'function');
assert.equal(typeof commands.agent.createWorkflowGateSlice, 'function');

const createdSession = await commands.agentWorkspace.createSession({
  connection: {
    connectionId: 'test-agent-connection',
    model: 'test-agent-model',
    runtimeKind: 'direct_api',
  },
});
const publicationsAfterSessionCreation = publications;
const ensuredSession = await commands.agentWorkspace.ensureDefaultSession({
  connection: {
    connectionId: 'unused-default-connection',
    model: 'unused-default-model',
    runtimeKind: 'direct_api',
  },
  title: 'Default Agent',
});
assert.equal(ensuredSession.agentSessionId, createdSession.agentSessionId);
assert.equal(ensuredSession.created, false);
assert.equal(ensuredSession.committed, false);
assert.equal(publications, publicationsAfterSessionCreation);
const renamedSession = await commands.agentWorkspace.renameSession({
  agentSessionId: createdSession.agentSessionId,
  title: 'Workflow Director',
});
assert.equal(renamedSession.committed, true);
const publicationsAfterRename = publications;
const unchangedRename = await commands.agentWorkspace.renameSession({
  agentSessionId: createdSession.agentSessionId,
  title: 'Workflow Director',
});
assert.equal(unchangedRename.committed, false);
assert.equal(publications, publicationsAfterRename);
await commands.agentWorkspace.bindRun({
  agentRunId: agentCreated.agentRunId,
  agentSessionId: createdSession.agentSessionId,
});
await commands.agentWorkspace.bindWorkingOperation({
  agentSessionId: createdSession.agentSessionId,
  operationBlockId: retryAction.operationBlockId,
});
const archivedSession = await commands.agentWorkspace.archiveSession({
  agentSessionId: createdSession.agentSessionId,
  defaultConnection: {
    connectionId: 'test-agent-connection',
    model: 'test-agent-model',
    runtimeKind: 'direct_api',
  },
  defaultTitle: 'Default Agent',
});
assert.notEqual(archivedSession.selectedSessionId, createdSession.agentSessionId);
const durableAgentWorkspace = await storage.loadBoard({
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
});
assert.equal(
  durableAgentWorkspace.agentSessions?.find(
    (session) => session.agentSessionId === createdSession.agentSessionId,
  )?.status,
  'archived',
);
assert.equal(
  durableAgentWorkspace.agentSessions?.find(
    (session) => session.agentSessionId === archivedSession.selectedSessionId,
  )?.status,
  'active',
);

const projectDefinition = canonicalWorkflowDefinition({
  ...structuredClone(storyToStoryboardWorkflow),
  name: 'Project story to storyboard',
  version: '1.0.0',
  workflowId: `project.${initial.project.projectId}.story-to-storyboard`,
});
const revisionId = 'workflow_revision_product_commands';
const projectedRevision = await commands.workflow.projectRevision({
  presentation: {
    connectionIdsByCapability: Object.fromEntries(projectDefinition.steps.map(
      (step) => [step.capabilityLock.capabilityId, 'test-text-connection'],
    )),
    labelsBySkillId: Object.fromEntries(projectDefinition.steps.map(
      (step) => [step.skillLock.skillId, labelsForSkill(step.skillLock.skillId)],
    )),
    outputPlaceholder: 'Run the upstream operation.',
    placementCenter: { x: 1320, y: 420 },
  },
  revision: {
    definition: projectDefinition,
    projectId: initial.project.projectId,
    projectionTemplate: createWorkflowProjectionTemplate(projectDefinition),
    publishedAt: '2026-08-10T00:00:00.000Z',
    revisionId,
    schemaVersion: 1,
    source: {
      blockIds: [],
      boardId: initial.board.boardId,
      capturedAt: '2026-08-10T00:00:00.000Z',
      kind: 'board_selection',
      sourceWorkflowRunId: created.workflowRunId,
      workflowLock: workflowDefinitionIdentity(projectDefinition),
    },
    status: 'published',
  },
});
assert.equal(projectedRevision.revisionId, revisionId);
const durableRevisionProjection = await storage.loadBoard({
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
});
assert.equal(
  durableRevisionProjection.blocks.find(
    (block) => block.blockId === projectedRevision.groupBlockId,
  )?.data.workflowRevisionId,
  revisionId,
);

unsubscribe();
await host.dispose();

console.log({
  agentCreateAndControlDurable: true,
  agentReconcileNoopDoesNotPublish: true,
  agentSettleMissingExecutionDurable: true,
  agentSettleNewExecutionDurable: true,
  agentWorkspaceSessionLifecycleDurable: true,
  agentWorkspaceSessionNoopsDoNotPublish: true,
  durableWorkflowDraftProjected: true,
  durableWorkflowRunCreated: true,
  productCommandUsesHostTransaction: true,
  durableWorkflowRevisionProjected: true,
  workflowProductCommands: 'passed',
});

function labelsForSkill(skillId: string): TextGenerationLabels {
  const labels: Record<string, TextGenerationLabels> = {
    'retake.screenplay.from-brief': generationLabels('Generate screenplay', 'Creative brief'),
    'retake.character-bible.from-screenplay': generationLabels('Define characters', 'Screenplay'),
    'retake.scene-bible.from-screenplay': generationLabels('Define scenes', 'Screenplay'),
    'retake.storyboard-plan.from-production-design': {
      ...generationLabels('Generate storyboard plan', 'Screenplay'),
      inputSlots: [
        {
          promptPlaceholder: 'Connect the screenplay.',
          promptTitle: 'Screenplay',
          slotId: 'screenplay',
        },
        {
          promptPlaceholder: 'Connect the Character Bible.',
          promptTitle: 'Character Bible',
          slotId: 'character_bible',
        },
        {
          promptPlaceholder: 'Connect the Scene Bible.',
          promptTitle: 'Scene Bible',
          slotId: 'scene_bible',
        },
      ],
    },
  };
  const result = labels[skillId];
  if (!result) throw new Error(`Missing test labels for Skill: ${skillId}`);
  return result;
}

function generationLabels(
  operationTitle: string,
  promptTitle: string,
): TextGenerationLabels {
  return {
    operationTitle,
    promptPlaceholder: `Connect ${promptTitle}.`,
    promptTitle,
    resultTitle: operationTitle,
    waitingBody: 'Waiting.',
  };
}
