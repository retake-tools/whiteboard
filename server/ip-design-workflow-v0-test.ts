import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import {
  applyWorkflowLaunchPreferences,
  decideChangeProposal,
} from '../src/core/agentChangeApplication';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { listPackageEntryPoints } from '../src/core/packageRegistry';
import { listAgentSkillEntrypointOptions } from '../src/core/agentSkillRecommendation';
import { skillDefinitionFor } from '../src/core/skillRegistry';
import { packageComposerParametersWithAgentPreferences } from '../src/core/packageComposer';
import { isTextDocumentCapability } from '../src/core/capabilityRegistry';
import { executeExistingTextGenerationOperation } from '../src/core/textOperations';
import { executeExistingImageOperationBlock } from '../src/core/imageOperations';
import { createFlowEdges, createFlowNodes } from '../src/core/flowProjection';
import type { BoardSnapshot } from '../src/core/types';
import { workflowDefinitionFor } from '../src/core/workflowRegistry';
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
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

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
const installedIpWorkflow = workflowDefinitionFor('retake.workflow.ip-character-design');
assert.deepEqual(
  installedIpWorkflow.steps.find(
    (step) => step.stepId === 'generate_concept_directions',
  )?.defaultParameters,
  { variationCount: 2 },
);
assert.match(
  skillDefinitionFor('retake.image.ip-concept-directions').outputRequirements.join(' '),
  /one visual direction per output image/i,
);
const strategyEntrypoint = listPackageEntryPoints().find(
  (candidate) => candidate.entrypoint.entrypointId === 'skill:retake.image.ip-character-strategy',
);
assert.equal(strategyEntrypoint?.entrypoint.kind, 'skill');
assert.equal(strategyEntrypoint?.entrypoint.recommended, true);
assert.deepEqual(
  listAgentSkillEntrypointOptions().map((option) => option.entrypointId),
  ['skill:retake.image.ip-character-strategy'],
);
assert.equal(
  isTextDocumentCapability('design.ip_character.define'),
  true,
  'Plugin-owned document Capabilities must use the text execution route.',
);
const operationInputControllerSource = await readFile(
  'src/app/useOperationInputController.ts',
  'utf8',
);
const canvasProjectionViewStateSource = await readFile(
  'src/core/canvasProjectionViewState.ts',
  'utf8',
);
const canvasViewportControlsSource = await readFile(
  'src/components/CanvasViewportControls.tsx',
  'utf8',
);
const operationInlineControlsSource = await readFile(
  'src/nodes/OperationInlineControls.tsx',
  'utf8',
);
assert.match(
  operationInputControllerSource,
  /isTextDocumentCapability\(capabilityId\)/,
  'The generic Operation runner must route from the resolved Capability Definition.',
);
assert.match(canvasProjectionViewStateSource, /localStorage\.removeItem/);
assert.match(operationInlineControlsSource, /userSelectableSkillsForCapability/);
assert.match(operationInlineControlsSource, /listPackageEntryPoints/);
assert.match(
  operationInlineControlsSource,
  /entrypoint\.kind === 'skill'[\s\S]*entrypoint\.ref\.capabilityId === capabilityId/,
  'Generic image Operations must not expose historical or Workflow-only Skills.',
);
assert.doesNotMatch(
  canvasViewportControlsSource,
  /onChangeProjectionMode/,
  'The ordinary Board must not expose the full frozen DAG projection.',
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
      value: packageComposerParametersWithAgentPreferences(undefined, {
        aspectRatioPreset: '1:1',
        connectionId: 'codex-app-server',
        targetResolution: '2K',
        variationCount: 2,
      }),
    },
  ],
});
assert.deepEqual(
  packageComposerParametersWithAgentPreferences(
    { aspectRatioPreset: '9:16', variationCount: 3 },
    {
      aspectRatioPreset: '1:1',
      connectionId: 'codex-app-server',
      targetResolution: '2K',
      variationCount: 2,
    },
  ),
  {
    aspectRatioPreset: '9:16',
    connectionId: 'codex-app-server',
    targetResolution: '2K',
    variationCount: 3,
  },
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
applyWorkflowLaunchPreferences(proposalTurn.proposal, {
  aspectRatioPreset: '1:1',
  conceptStepId: 'generate_concept_directions',
  conceptVariationCount: 2,
  connectionId: 'codex-app-server',
  interactionMode: 'automatic',
  targetResolution: '2K',
});
assert.deepEqual(proposalTurn.proposal.workflowLaunchParameters, {
  aspectRatioPreset: '1:1',
  connectionId: 'codex-app-server',
  stepParameterOverrides: {
    generate_concept_directions: { variationCount: 2 },
  },
  targetResolution: '2K',
});
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

const creativeDraftProjectionNodes = createFlowNodes(snapshot, { projectionMode: 'creative' });
assert.deepEqual(
  creativeDraftProjectionNodes
    .filter((node) => node.type === 'operation')
    .map((node) => node.id),
  [operationBlockIds[0]],
  'An unstarted Workflow Draft must progressively reveal only its root Step.',
);
const creativeDraftGroup = creativeDraftProjectionNodes.find((node) => node.id === groupId);
const creativeDraftChildren = creativeDraftProjectionNodes.filter(
  (node) => node.parentId === groupId,
);
assert.equal(
  creativeDraftGroup?.data.groupMemberCount,
  creativeDraftChildren.length,
  'Creative Workflow Groups must count only the currently projected Blocks.',
);
const creativeDraftInput = creativeDraftChildren.find((node) => node.type === 'text');
const creativeDraftOperation = creativeDraftChildren.find((node) => node.type === 'operation');
assert.ok(creativeDraftInput && creativeDraftOperation);
assert.equal(
  Math.abs(creativeDraftInput.position.y - creativeDraftOperation.position.y) < 40,
  true,
  'Workflow inputs must align with their consumer instead of creating a crossed vertical path.',
);

const run = createWorkflowRunForGroup(snapshot, groupId);
reconcileWorkflowRuntime(snapshot);
const view = workflowRunViewForGroup(snapshot, groupId);
assert.ok(view);
assert.equal(view.steps.length, 4);
assert.equal(view.steps[0]?.record.stepId, 'define_character');
assert.equal(view.steps[0]?.canStart, true);
assert.equal(view.steps.slice(1).every((step) => !step.canStart), true);
const creativeProjectionNodes = createFlowNodes(snapshot, { projectionMode: 'creative' });
const fullFlowNodes = createFlowNodes(snapshot, { projectionMode: 'flow' });
assert.deepEqual(
  creativeProjectionNodes
    .filter((node) => node.type === 'operation')
    .map((node) => node.id),
  [view.steps[0]!.record.operationBlockId],
  'Creative mode must progressively reveal only reached Workflow Steps.',
);
assert.equal(
  fullFlowNodes.filter((node) => node.type === 'operation').length,
  4,
  'Flow mode remains the full Workflow DAG projection.',
);
const futureOperationBlockId = view.steps[1]?.record.operationBlockId;
const futureOutputBlockId = view.steps[1]?.record.outputBlockIds[0];
assert.ok(futureOperationBlockId && futureOutputBlockId);
assert.equal(
  createFlowNodes(snapshot, {
    projectionMode: 'creative',
    selectedBlockIds: [futureOperationBlockId],
  }).some((node) => node.id === futureOperationBlockId),
  false,
  'Selecting a future Operation in Flow mode must not reveal it in Creative mode.',
);
assert.equal(
  createFlowNodes(snapshot, {
    projectionMode: 'creative',
    selectedBlockIds: [futureOutputBlockId],
  }).some((node) => node.id === futureOutputBlockId),
  false,
  'Selecting a future output placeholder in Flow mode must not reveal it in Creative mode.',
);
assert.equal(
  createFlowNodes(snapshot, {
    projectionMode: 'creative',
    selectedBlockIds: [groupId],
  }).filter((node) => node.type === 'operation').length,
  1,
  'Selecting the Workflow Group must not expand its future Steps in Creative mode.',
);
const creativeGroupNode = creativeProjectionNodes.find((node) => node.id === groupId);
const fullFlowGroupNode = fullFlowNodes.find((node) => node.id === groupId);
assert.ok(creativeGroupNode && fullFlowGroupNode);
assert.equal(
  Number(creativeGroupNode.style?.width) < Number(fullFlowGroupNode.style?.width)
    || Number(creativeGroupNode.style?.height) < Number(fullFlowGroupNode.style?.height),
  true,
  'Creative Workflow Group bounds must grow with visible Steps instead of reserving the full DAG.',
);
assert.equal(
  creativeProjectionNodes.find((node) => node.id === view.steps[0]!.record.operationBlockId)?.extent,
  'parent',
);
const creativeWorkflowEdges = createFlowEdges(snapshot, { projectionMode: 'creative' });
assert.equal(creativeWorkflowEdges.every((edge) => edge.type === 'workflow'), true);
assert.equal(
  creativeWorkflowEdges.every((edge) => edge.className?.includes('is-workflow-edge') && edge.markerEnd),
  true,
  'Visible Workflow edges must use typed orthogonal paths with direction arrows.',
);
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
  const expectedGenerationParams = stepId === 'generate_concept_directions'
    ? { aspectRatioPreset: '1:1', targetResolution: '2K', variationCount: 2 }
    : { aspectRatioPreset: '1:1', targetResolution: '2K' };
  assert.deepEqual(
    operation.data.generationParams,
    expectedGenerationParams,
    `Workflow image defaults must project into ${stepId}.`,
  );
  assert.deepEqual(
    view.steps.find((step) => step.record.stepId === stepId)?.record.parameters,
    expectedGenerationParams,
    `WorkflowRun must freeze the effective image parameters for ${stepId}.`,
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

assert.deepEqual(
  [...operationByStepId.values()].map((operation) => operation.data.workflowFlowDirection),
  ['forward', 'forward', 'forward', 'forward'],
  'Workflow rows must keep one predictable left-to-right reading direction.',
);
assert.ok(
  Number(fullFlowGroupNode.style?.width) < 1400,
  'A four-step IP Workflow must remain a compact multi-row Group.',
);
const directWorkflowChildren = snapshot.blocks.filter((block) => block.parentGroupId === groupId);
for (const [index, left] of directWorkflowChildren.entries()) {
  for (const right of directWorkflowChildren.slice(index + 1)) {
    const overlaps = left.position.x < right.position.x + right.size.width
      && left.position.x + left.size.width > right.position.x
      && left.position.y < right.position.y + right.size.height
      && left.position.y + left.size.height > right.position.y;
    assert.equal(overlaps, false, `Workflow blocks must not overlap: ${left.blockId}, ${right.blockId}`);
  }
}
const outputForStep = (stepId: string) => snapshot.blocks.find((block) => (
  block.parentGroupId === groupId
  && block.type !== 'operation'
  && block.data.workflowStepId === stepId
));
const defineOutput = outputForStep('define_character');
const conceptOutput = outputForStep('generate_concept_directions');
const sheetOutput = outputForStep('generate_character_sheet');
assert.ok(defineOutput && conceptOutput && sheetOutput);
const workflowGroupRecord = snapshot.blocks.find((block) => block.blockId === groupId);
assert.ok(workflowGroupRecord);
const maximumWorkflowChildRight = Math.max(
  ...snapshot.blocks
    .filter((block) => block.parentGroupId === groupId)
    .map((block) => block.position.x + block.size.width),
);
assert.ok(
  workflowGroupRecord.position.x + workflowGroupRecord.size.width
    >= maximumWorkflowChildRight + 72,
  'Step-row Workflow Groups must reserve a right-side routing channel.',
);
workflowGroupRecord.size.width = maximumWorkflowChildRight - workflowGroupRecord.position.x + 28;
reconcileWorkflowRuntime(snapshot);
assert.ok(
  workflowGroupRecord.position.x + workflowGroupRecord.size.width
    >= maximumWorkflowChildRight + 72,
  'Runtime reconciliation must repair older Workflow Groups without a routing channel.',
);
assert.equal(
  new Set([...operationByStepId.values()].map((operation) => operation.position.x)).size,
  1,
  'Every Step Operation must use the same middle column.',
);
assert.equal(
  new Set([defineOutput, conceptOutput, sheetOutput].map((output) => output.position.x)).size,
  1,
  'Every Step result must use the same right column.',
);
assert.ok(
  defineOutput.position.x
    - (operationByStepId.get('define_character')!.position.x
      + operationByStepId.get('define_character')!.size.width)
    >= 112,
  'Step results must leave enough horizontal room for short fan-out curves.',
);
const fullWorkflowEdges = createFlowEdges(snapshot, { projectionMode: 'flow' });
const resultFanoutEdges = fullWorkflowEdges.filter(
  (edge) => edge.data?.kind === 'execution_output',
);
assert.ok(resultFanoutEdges.length > 0);
assert.equal(
  resultFanoutEdges.every((edge) => edge.data?.workflowRouteKind === 'result_fanout'),
  true,
  'Same-Step Operation results must use direct curve fan-out routing.',
);
const defineFanout = fullWorkflowEdges.filter((edge) => edge.source === defineOutput.blockId);
assert.equal(defineFanout.length, 3);
assert.deepEqual(
  new Set(defineFanout.map((edge) => edge.data?.workflowFanoutCount)),
  new Set([3]),
  'A Workflow output with multiple consumers must receive stable fan-out routing metadata.',
);
const longDefineDependencies = defineFanout.filter(
  (edge) => edge.data?.workflowRouteKind === 'long_dependency',
);
assert.equal(
  longDefineDependencies.length,
  0,
  'Stable Step rows must avoid outer-gutter routes on the ordinary projection.',
);
const conceptToSheetDependency = fullWorkflowEdges.find((edge) => (
  edge.source === conceptOutput.blockId
  && edge.target === operationByStepId.get('generate_character_sheet')?.blockId
));
assert.equal(
  conceptToSheetDependency?.sourceHandle,
  'workflow-source-bottom',
  'Media results must keep the compact bottom-to-top dependency route between Step rows.',
);

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
const historicalResultSnapshot = structuredClone(snapshot);
historicalResultSnapshot.executions.push({
  ...structuredClone(queued.execution),
  executionId: 'execution_ip_design_newer_attempt',
  outputAssetIds: [],
  outputBlockIds: [],
  startedAt: '2099-01-01T00:00:00.000Z',
});
assert.equal(
  createFlowNodes(historicalResultSnapshot, { projectionMode: 'creative' })
    .find((node) => node.id === defineOutput.blockId)
    ?.data.workflowHistoricalResult,
  true,
  'A result from an older Step attempt must stay visible but be marked as historical.',
);
assert.equal(
  createFlowEdges(historicalResultSnapshot, { projectionMode: 'creative' })
    .find((edge) => edge.target === defineOutput.blockId)
    ?.data?.workflowHistoricalResult,
  true,
  'Historical result edges must be visually de-emphasized with their result node.',
);
assert.equal(queued.execution.workflowRunId, run.record.workflowRunId);
assert.equal(queued.execution.stepRunId, view.steps[0]?.record.stepRunId);
assert.equal(queued.execution.capabilityLock?.capabilityId, 'design.ip_character.define');
assert.equal(queued.execution.skillSnapshot && 'instructionTemplate' in queued.execution.skillSnapshot, true);
assert.deepEqual(
  queued.execution.inputBindingsSnapshot?.map((binding) => binding.slotId),
  ['creative_brief'],
);
defineOperation.data.status = 'succeeded';
queued.execution.status = 'succeeded';
const defineStepRun = snapshot.workflowStepRuns?.find(
  (step) => step.stepRunId === view.steps[0]?.record.stepRunId,
);
assert.ok(defineStepRun);
defineStepRun.status = 'succeeded';
reconcileWorkflowRuntime(snapshot);
const activeStepDependency = createFlowEdges(snapshot, { projectionMode: 'creative' }).find((edge) => (
  edge.source === view.steps[0]?.record.outputBlockIds[0]
  && edge.target === view.steps[1]?.record.operationBlockId
));
assert.equal(
  activeStepDependency?.sourceHandle,
  undefined,
  'Document results must leave from their visible right-side output Handle.',
);
assert.equal(activeStepDependency?.targetHandle, 'workflow-target-top');
assert.equal(activeStepDependency?.data?.workflowRouteKind, 'step_dependency');
const derivedPromptSnapshot = structuredClone(snapshot);
const derivedPromptDefineExecution = derivedPromptSnapshot.executions.find(
  (execution) => execution.executionId === queued.execution.executionId,
);
const derivedPromptDefineOutput = derivedPromptSnapshot.blocks.find(
  (block) => block.blockId === defineOutput.blockId,
);
assert.ok(derivedPromptDefineExecution && derivedPromptDefineOutput);
const derivedPromptBibleAssetId = 'asset_derived_prompt_bible';
derivedPromptSnapshot.assets.push({
  assetId: derivedPromptBibleAssetId,
  createdAt: new Date().toISOString(),
  kind: 'document',
  mimeType: 'text/markdown',
  previewUrl: '/api/local/assets/test/derived-prompt-bible.md',
  projectId: derivedPromptSnapshot.project.projectId,
  sourceExecutionId: derivedPromptDefineExecution.executionId,
  storageKey: 'assets/asset_derived_prompt_bible/generated.md',
  storageProvider: 'local',
});
derivedPromptDefineExecution.outputAssetIds = [derivedPromptBibleAssetId];
derivedPromptDefineOutput.data = {
  ...derivedPromptDefineOutput.data,
  assetId: derivedPromptBibleAssetId,
  sourceExecutionId: derivedPromptDefineExecution.executionId,
  status: 'succeeded',
  title: 'Fixture character bible',
};
reconcileWorkflowRuntime(derivedPromptSnapshot);
const derivedPromptConceptOperation = derivedPromptSnapshot.blocks.find(
  (block) => block.blockId === view.steps[1]?.record.operationBlockId,
);
assert.ok(derivedPromptConceptOperation);
const projectedPromptBody = derivedPromptConceptOperation.data.body;
const derivedPromptExecution = executeExistingImageOperationBlock(derivedPromptSnapshot, {
  capabilityId: 'image.generate',
  connection: readyImageConnection(),
  generationParams: derivedPromptConceptOperation.data.generationParams,
  instruction: '',
  operation: 'text_to_image',
  operationBlockId: derivedPromptConceptOperation.blockId,
}).execution;
derivedPromptExecution.status = 'succeeded';
derivedPromptExecution.completedAt = new Date().toISOString();
derivedPromptConceptOperation.data.body = projectedPromptBody;
reconcileWorkflowRuntime(derivedPromptSnapshot);
const derivedPromptConceptStep = workflowRunViewForGroup(
  derivedPromptSnapshot,
  groupId,
)?.steps.find((step) => step.record.stepId === 'generate_concept_directions');
assert.equal(
  derivedPromptConceptStep?.freshness,
  'current',
  'A Workflow image prompt derived from frozen inputs and Skill must not become outdated when the projection placeholder is restored.',
);
assert.equal(
  createFlowNodes(snapshot, { projectionMode: 'creative' }).find(
    (node) => node.id === defineOperation.blockId,
  )?.data.operationCompact,
  false,
  'Completed Workflow Operations must remain visible without an automatic density switch.',
);
const completedCreativeNodes = createFlowNodes(snapshot, { projectionMode: 'creative' });
const completedDefineOutput = completedCreativeNodes.find((node) => node.id === defineOutput.blockId);
const completedCreativeGroup = completedCreativeNodes.find((node) => node.id === groupId);
assert.equal(completedDefineOutput?.data.workflowResultSummary, false);
assert.equal(completedDefineOutput?.style?.width, defineOutput.size.width);
assert.equal(completedDefineOutput?.style?.height, defineOutput.size.height);
assert.ok(
  completedDefineOutput,
  'A completed Workflow Step must retain its generated output Block.',
);
assert.ok(completedCreativeGroup);
assert.ok(
  Number(completedCreativeGroup.style?.width)
    - (completedDefineOutput.position.x + Number(completedDefineOutput.style?.width))
    >= 72,
  'The creative Workflow Group projection must retain its visible routing channel.',
);
const completedFlowNodes = createFlowNodes(snapshot, { projectionMode: 'flow' });
assert.equal(
  completedFlowNodes.find((node) => node.id === defineOperation.blockId)?.data.operationCompact,
  false,
);
assert.equal(
  completedFlowNodes.find((node) => node.id === defineOutput.blockId)?.data.workflowResultSummary,
  false,
  'Flow mode must preserve the complete frozen Workflow projection.',
);
assert.equal(
  createFlowNodes(snapshot, {
    projectionMode: 'creative',
    selectedBlockIds: [defineOutput.blockId],
  }).find((node) => node.id === defineOutput.blockId)?.data.workflowResultSummary,
  false,
  'Selecting a result must not change its projection density.',
);

await saveSnapshot(snapshot);
const recoveredSnapshot = await loadSnapshot(
  snapshot.project.projectId,
  snapshot.board.boardId,
);
const recoveredFutureOperationBlockId = view.steps[2]?.record.operationBlockId;
const recoveredFutureOutputBlockId = view.steps[2]?.record.outputBlockIds[0];
assert.ok(recoveredFutureOperationBlockId && recoveredFutureOutputBlockId);
assert.equal(
  createFlowNodes(recoveredSnapshot, {
    projectionMode: 'creative',
    selectedBlockIds: [recoveredFutureOperationBlockId, recoveredFutureOutputBlockId],
  }).some((node) => (
    node.id === recoveredFutureOperationBlockId
    || node.id === recoveredFutureOutputBlockId
  )),
  false,
  'Reloaded Creative projection must not reveal selected future Workflow Blocks.',
);

console.log(JSON.stringify({
  agentEntrypointLaunch: true,
  automaticTypedBindings: true,
  creativeProgressiveProjection: true,
  firstStepExecutable: true,
  operationCount: operationBlockIds.length,
  plannedImageProviderCalls: 4,
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

function readyImageConnection(): ExecutionConnectionSummary {
  return {
    configurable: true,
    connectionId: 'codex-app-server',
    connectionKind: 'model_provider',
    connectorId: 'codex-app-server',
    deletable: false,
    description: 'Disposable IP Workflow image fixture.',
    displayName: 'Codex App Server',
    enabled: true,
    enabledUseCases: ['image'],
    hasCredential: true,
    implementationKind: 'codex_app_server',
    modelId: 'fixture-image-model',
    providerLabel: 'Fixture image provider',
    status: 'ready',
    supportedCapabilityIds: ['image.generate'],
  };
}
