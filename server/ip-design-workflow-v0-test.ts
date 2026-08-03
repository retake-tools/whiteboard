import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { listPackageEntryPoints } from '../src/core/packageRegistry';
import { packageComposerParametersWithAgentPreferences } from '../src/core/packageComposer';
import { isTextDocumentCapability } from '../src/core/capabilityRegistry';
import { executeExistingTextGenerationOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import {
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
  workflowRunViewForGroup,
} from '../src/core/workflowRuntime';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';
import { resetWorkspace } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-ip-design-workflow-v0')) {
  throw new Error('IP Design Workflow V0 test requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { recursive: true, force: true });
await bootstrapDeclarativePackages({
  activateRuntime: true,
  hostVersion: '0.1.4',
  profilePath: defaultBootstrapProfilePath,
  workspaceRoot: retakeRoot,
});

const entrypoint = listPackageEntryPoints().find(
  (candidate) => candidate.entrypoint.entrypointId === 'workflow:retake.workflow.ip-character-design',
);
assert.ok(entrypoint);
assert.equal(entrypoint.entrypoint.kind, 'workflow');
assert.equal(entrypoint.entrypoint.recommended, true);
assert.equal(
  isTextDocumentCapability('design.ip_character.define'),
  true,
  'Plugin-owned document Capabilities must use the text execution route.',
);
const operationInputControllerSource = await readFile(
  'src/app/useOperationInputController.ts',
  'utf8',
);
assert.match(
  operationInputControllerSource,
  /isTextDocumentCapability\(capabilityId\)/,
  'The generic Operation runner must route from the resolved Capability Definition.',
);

const snapshot = await emptySnapshot();
const session = createAgentSession(snapshot, {
  model: 'fixture-model',
  title: 'IP 形象设计 Agent 验收',
}).session;
const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '为年轻城市骑行品牌设计一只橙色快递猫 IP。性格勇敢、热心、有一点幽默感；轮廓要简洁，适合头像、贴纸和海报。避免写实皮毛与复杂渐变。',
  contextRefs: [
    { entrypointId: entrypoint.entrypoint.entrypointId, kind: 'entrypoint' },
    {
      kind: 'parameters',
      value: packageComposerParametersWithAgentPreferences(undefined, { variationCount: 2 }),
    },
  ],
});
assert.deepEqual(
  packageComposerParametersWithAgentPreferences({ variationCount: 3 }, { variationCount: 2 }),
  { variationCount: 3 },
  'Explicit EntryPoint parameters must override Agent task preferences.',
);
const proposalTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    kind: 'reply',
    message: '将创建 IP 形象设计 Workflow 草稿，等待批准。',
  },
  externalThreadId: 'thread_ip_design_workflow_v0',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'turn_ip_design_workflow_v0',
  sourceMessageId: sourceMessage.agentMessageId,
});
assert.ok(proposalTurn.proposal);
const approved = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: proposalTurn.proposal.recordVersion,
  proposalId: proposalTurn.proposal.proposalId,
});
assert.equal(approved.proposal.appliedEffect?.kind, 'package_entrypoint_draft');
if (approved.proposal.appliedEffect?.kind !== 'package_entrypoint_draft') {
  throw new Error('IP Design EntryPoint did not project a Workflow draft.');
}
const groupId = approved.proposal.appliedEffect.workflowGroupId;
const operationBlockIds = approved.proposal.appliedEffect.createdBlockIds.filter(
  (blockId) => snapshot.blocks.some(
    (block) => block.blockId === blockId && block.type === 'operation',
  ),
);
assert.equal(operationBlockIds.length, 4);

const run = createWorkflowRunForGroup(snapshot, groupId);
reconcileWorkflowRuntime(snapshot);
const view = workflowRunViewForGroup(snapshot, groupId);
assert.ok(view);
assert.equal(view.steps.length, 4);
assert.equal(view.steps[0]?.record.stepId, 'define_character');
assert.equal(view.steps[0]?.canStart, true);
assert.equal(view.steps.slice(1).every((step) => !step.canStart), true);
assert.deepEqual(view.steps[0]?.record.parameters, {});
assert.deepEqual(
  run.record.outputSlotLocks.map((lock) => [
    lock.workflowOutputSlotId,
    lock.artifactType,
  ]),
  [
    ['character_bible', 'character_bible'],
    ['accepted_concept', 'character_reference'],
    ['character_sheet', 'character_sheet'],
    ['application_board', 'ip_application_board'],
  ],
);
assert.equal(
  run.record.gateDefinitionLocks[0]?.subject.kind,
  'artifact_revision',
);
assert.equal(
  run.record.gateDefinitionLocks[0]?.subject.kind === 'artifact_revision'
    ? run.record.gateDefinitionLocks[0].subject.workflowOutputSlotId
    : undefined,
  'application_board',
);

const operationByStepId = new Map(operationBlockIds.map((blockId) => {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(block && block.type === 'operation');
  return [String(block.data.workflowStepId), block] as const;
}));
assert.deepEqual(
  [...operationByStepId].map(([stepId, block]) => [
    stepId,
    block.data.capabilityId,
    block.data.skillId,
  ]),
  [
    ['define_character', 'design.ip_character.define', 'retake.image.ip-character-strategy'],
    ['generate_concept_directions', 'image.generate', 'retake.image.ip-concept-directions'],
    ['generate_character_sheet', 'image.generate', 'retake.image.ip-character-sheet'],
    ['generate_application_board', 'image.generate', 'retake.image.ip-application-board'],
  ],
);
for (const [stepId, operation] of operationByStepId) {
  if (stepId === 'define_character') continue;
  assert.deepEqual(
    operation.data.generationParams,
    { variationCount: 2 },
    `Agent candidate-count preference must project into ${stepId}.`,
  );
  assert.deepEqual(
    view.steps.find((step) => step.record.stepId === stepId)?.record.parameters,
    { variationCount: 2 },
    `WorkflowRun must freeze the candidate-count authorization for ${stepId}.`,
  );
}
for (const operation of operationByStepId.values()) {
  const inputEdges = snapshot.edges.filter(
    (edge) => edge.kind === 'execution_input' && edge.targetBlockId === operation.blockId,
  );
  assert.equal(
    inputEdges.every((edge) => typeof edge.inputSlotId === 'string' && edge.inputSlotId.length > 0),
    true,
    `Workflow input Edge must be typed: ${operation.data.workflowStepId}`,
  );
}

const defineOperation = operationByStepId.get('define_character');
assert.ok(defineOperation);
const queued = executeExistingTextGenerationOperation(snapshot, {
  connection: readyTextConnection(),
  labels: {
    resultTitle: 'IP Character Bible',
    waitingBody: 'Waiting for the character bible.',
  },
  operationBlockId: defineOperation.blockId,
});
assert.equal(queued.execution.workflowRunId, run.record.workflowRunId);
assert.equal(queued.execution.stepRunId, view.steps[0]?.record.stepRunId);
assert.equal(queued.execution.capabilityLock?.capabilityId, 'design.ip_character.define');
assert.equal(queued.execution.skillSnapshot && 'instructionTemplate' in queued.execution.skillSnapshot, true);
assert.deepEqual(
  queued.execution.inputBindingsSnapshot?.map((binding) => binding.slotId),
  ['creative_brief'],
);

console.log(JSON.stringify({
  agentEntrypointLaunch: true,
  automaticTypedBindings: true,
  firstStepExecutable: true,
  operationCount: operationBlockIds.length,
  plannedImageProviderCalls: 6,
  outputArtifactTypes: run.record.outputSlotLocks.map((lock) => lock.artifactType),
  packageVersion: entrypoint.packageLock.version,
  workflowId: run.record.workflowDefinitionLock.workflowId,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const value = await resetWorkspace();
  value.project.name = '[TEST] IP Design Workflow V0';
  value.board.name = '[TEST] IP Design Workflow V0';
  value.blocks = [];
  value.edges = [];
  value.assets = [];
  value.executions = [];
  value.workflowRuns = [];
  value.workflowStepRuns = [];
  value.workflowGateEvaluations = [];
  value.workflowApprovalRequests = [];
  value.workflowApprovalDecisions = [];
  value.agentRuns = [];
  value.agentSessions = [];
  value.agentMessages = [];
  value.agentRuntimeBindings = [];
  value.agentRuntimeEvents = [];
  return value;
}

function readyTextConnection(): ExecutionConnectionSummary {
  return {
    connectionId: 'fixture-text-provider',
    connectorId: 'openai-compatible',
    providerLabel: 'Fixture text provider',
    displayName: 'Fixture text provider',
    description: 'IP Design Workflow V0 fixture provider.',
    connectionKind: 'model_provider',
    implementationKind: 'ai_sdk',
    supportedCapabilityIds: ['design.ip_character.define'],
    enabledUseCases: ['text'],
    configurable: true,
    deletable: true,
    enabled: true,
    status: 'ready',
    hasCredential: true,
    modelId: 'fixture-text-model',
  };
}
