import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentWorkflowRunNavigator } from '../src/components/AgentWorkflowRunNavigator';
import { AgentWorkflowStepConversation } from '../src/components/AgentWorkflowStepConversation';
import {
  CanvasExecutionActivity,
  executionActivityRecordsForAgent,
  executionActivityPhaseKey,
} from '../src/components/CanvasExecutionActivity';
import { WorkflowRunStepInspector } from '../src/components/WorkflowRunStepInspector';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { BoardSnapshot } from '../src/core/types';
import { workflowRunExperienceFor } from '../src/core/workflowRunExperience';
import { workflowWorkspaceGraphFor } from '../src/core/workflowWorkspaceGraph';
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord,
  WorkflowStepRunStatus,
} from '../src/core/workflowRuntimeContracts';
import { I18nProvider } from '../src/i18n';

const now = '2026-08-02T12:00:00.000Z';
const snapshot = fixtureSnapshot();
const before = JSON.stringify(snapshot);
const graph = workflowWorkspaceGraphFor(snapshot, 'run_ip');
assert.ok(graph);
assert.equal(graph.nodes.length, 4);
assert.deepEqual(
  graph.edges.map((edge) => [edge.sourceStepRunId, edge.targetStepRunId]),
  [
    ['step_a', 'step_b'],
    ['step_a', 'step_c'],
    ['step_b', 'step_d'],
    ['step_c', 'step_d'],
  ],
);
assert.deepEqual(
  graph.nodes.map((node) => [node.step.stepId, node.position.x, node.position.y]),
  [
    ['a', 0, 0],
    ['b', 340, 0],
    ['c', 340, 180],
    ['d', 680, 0],
  ],
);
assert.equal(graph.defaultSelectedStepRunId, 'step_a');
assert.equal(graph.nodes[3]?.gates.length, 1);
assert.equal(graph.nodes[3]?.artifacts[0]?.artifactRevisionId, 'revision_d');
assert.equal(JSON.stringify(snapshot), before, 'Graph projection must not mutate BoardSnapshot.');

const missingDependencySnapshot = structuredClone(snapshot);
missingDependencySnapshot.workflowStepRuns![1]!.dependsOn.push('removed_step');
const missingDependencyGraph = workflowWorkspaceGraphFor(
  missingDependencySnapshot,
  'run_ip',
);
assert.equal(missingDependencyGraph?.edges.length, 4);

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'en',
    setItem: () => undefined,
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'en-US' },
});
const compactMarkup = renderToStaticMarkup(
  <I18nProvider>
    <AgentWorkflowRunNavigator
      experience={workflowRunExperienceFor(snapshot)}
      onCancelAgentRun={() => undefined}
      onOpenWorkflowRun={() => undefined}
      onPauseAgentRun={() => undefined}
      onResumeAgentRun={() => undefined}
      onSelectWorkflowRun={() => undefined}
      selectedWorkflowRunId="run_ip"
    />
  </I18nProvider>,
);
assert.match(compactMarkup, /IP character design/);
assert.match(compactMarkup, /Open Workflow/);
assert.match(
  compactMarkup,
  /agent-workflow-run-current-step[^>]*>Current · Define character</,
);
assert.doesNotMatch(compactMarkup, /agent-workflow-run-details/);
assert.doesNotMatch(compactMarkup, /agent-workflow-step-list/);

const runningSnapshot = structuredClone(snapshot);
runningSnapshot.executions.push({
  adapter: 'codex_app_server',
  boardId: runningSnapshot.board.boardId,
  capabilityId: 'image.generate',
  executionId: 'execution_running_character_sheet',
  inputBlockIds: [],
  outputAssetIds: [],
  outputBlockIds: [],
  params: { operationBlockId: 'operation_c' },
  projectId: runningSnapshot.project.projectId,
  startedAt: now,
  status: 'running',
});
const activityMarkup = renderToStaticMarkup(
  <I18nProvider>
    <CanvasExecutionActivity
      agentIsWorking={false}
      onLocateBlock={() => undefined}
      snapshot={runningSnapshot}
      workingOperationBlockId="operation_c"
    />
  </I18nProvider>,
);
assert.match(activityMarkup, /Character sheet/);
assert.match(activityMarkup, /The system is working/);
assert.match(activityMarkup, /Locate the running Operation on the Board/);
const agentActivityMarkup = renderToStaticMarkup(
  <I18nProvider>
    <CanvasExecutionActivity
      agentIsWorking
      onLocateBlock={() => undefined}
      snapshot={snapshot}
    />
  </I18nProvider>,
);
assert.match(agentActivityMarkup, /Agent is working/);
assert.match(agentActivityMarkup, /Understanding and planning the task/);
const runningExecution = runningSnapshot.executions[0]!;
runningExecution.workflowRunId = 'run_ip';
assert.deepEqual(
  executionActivityRecordsForAgent(runningSnapshot, {
    agentRunId: 'agent_without_direct_execution_binding',
    workflowRunIds: ['run_ip'],
  }).map((execution) => execution.executionId),
  [runningExecution.executionId],
  'Agent loading must follow WorkflowRun ownership when Execution.agentRunId is absent.',
);
assert.deepEqual(
  executionActivityRecordsForAgent(runningSnapshot, {
    agentRunId: 'another_agent',
    workflowRunIds: ['another_workflow'],
  }),
  [],
  'Agent loading must not leak executions from another Agent Workflow.',
);
assert.equal(executionActivityPhaseKey(runningExecution, {
  phase: 'provider_starting',
  type: 'execution.progress',
}), 'canvasActivity.providerStarting');
assert.equal(executionActivityPhaseKey(runningExecution, {
  current: 1,
  phase: 'provider_generating',
  total: 2,
  type: 'execution.progress',
}), 'canvasActivity.providerGenerating');
assert.equal(executionActivityPhaseKey(runningExecution, {
  phase: 'result_importing',
  type: 'execution.progress',
}), 'canvasActivity.resultImporting');
assert.equal(executionActivityPhaseKey(runningExecution, {
  phase: 'board_writing',
  type: 'execution.progress',
}), 'canvasActivity.boardWriting');

const candidateSnapshot = structuredClone(snapshot);
candidateSnapshot.workflowStepRuns![0]!.status = 'waiting_selection';
candidateSnapshot.workflowStepRuns![0]!.outputAssetIds = ['candidate_a', 'candidate_b'];
candidateSnapshot.assets = ['candidate_a', 'candidate_b'].map((assetId) => ({
  assetId,
  createdAt: now,
  kind: 'image' as const,
  mimeType: 'image/png',
  previewUrl: `data:image/png;base64,${assetId}`,
  projectId: candidateSnapshot.project.projectId,
  storageKey: `fixture/${assetId}.png`,
  storageProvider: 'local_mock' as const,
}));
const candidateRun = workflowRunExperienceFor(candidateSnapshot).runs[0];
assert.ok(candidateRun);
const candidateMarkup = renderToStaticMarkup(
  <I18nProvider>
    <AgentWorkflowStepConversation
      onLocateBlock={() => undefined}
      onRerunOperation={() => undefined}
      onSelectWorkflowOutput={() => undefined}
      run={candidateRun}
      snapshot={candidateSnapshot}
    />
  </I18nProvider>,
);
assert.match(candidateMarkup, /Choose one candidate to continue/);
assert.match(candidateMarkup, /Candidate 1/);
assert.match(candidateMarkup, /Candidate 2/);
assert.match(
  candidateMarkup,
  /class="is-selected" aria-pressed="true" aria-label="Candidate 1"/,
  'The first Workflow image candidate should be visibly selected by default without accepting it.',
);
assert.match(candidateMarkup, /Use selected candidate/);

const executedSnapshot = structuredClone(snapshot);
executedSnapshot.executions.push({
  adapter: 'direct_api',
  boardId: executedSnapshot.board.boardId,
  capabilityId: 'design.ip_character.define',
  completedAt: '2026-08-02T12:00:02.500Z',
  errorMessage: 'fixture failure',
  executionId: 'execution_a',
  inputBlockIds: [],
  model: 'fixture-model',
  outputAssetIds: [],
  outputBlockIds: [],
  projectId: executedSnapshot.project.projectId,
  provider: 'fixture-provider',
  startedAt: now,
  status: 'failed',
});
executedSnapshot.workflowStepRuns![0]!.executionIds = ['execution_a'];
const runInspectorMarkup = renderToStaticMarkup(
  <I18nProvider>
    <WorkflowRunStepInspector
      canRunToStep={false}
      node={graph.nodes[0]!}
      onLocate={() => undefined}
      onRunToStep={() => undefined}
      snapshot={executedSnapshot}
    />
  </I18nProvider>,
);
assert.match(runInspectorMarkup, /Last Run/);
assert.match(runInspectorMarkup, /fixture-provider · fixture-model/);
assert.match(runInspectorMarkup, /2\.5 s/);
assert.match(runInspectorMarkup, /fixture failure/);
assert.match(runInspectorMarkup, /Run to this Step/);
assert.match(runInspectorMarkup, /Runs the frozen dependency path/);
assert.match(runInspectorMarkup, /Run current Ready Step/);
assert.match(runInspectorMarkup, /Rerun with last inputs/);

const repositoryRoot = path.resolve(process.cwd());
const [
  agentRuntimeControllerSource,
  whiteboardProductCommandsSource,
  agentWorkspaceSource,
  appSource,
  canvasSource,
  workflowDraftControllerSource,
  workspaceSource,
  designWorkspaceSource,
  designStepCreatorSource,
  designDependencyEdgeSource,
  designStepInspectorSource,
  designProjectionResultSource,
  designValidationChecklistSource,
  designStepNodeSource,
  runStepNodeSource,
  runStepInspectorSource,
  sharedStepCardSource,
  workspaceStyles,
] = await Promise.all([
  readFile(path.join(repositoryRoot, 'src/app/useAgentRuntimeController.ts'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/whiteboard/application/whiteboardProductCommands.ts'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/AgentWorkspace.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/App.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/app/WhiteboardCanvas.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/app/useWorkflowDraftController.ts'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowWorkspace.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowDesignWorkspace.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowDesignAddStep.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowDesignDependencyEdge.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowDesignStepInspector.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowDesignProjectionResult.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowDesignValidationChecklist.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowDesignStepNode.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowGraphStepNode.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowRunStepInspector.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/WorkflowStepCard.tsx'), 'utf8'),
  readFile(path.join(repositoryRoot, 'src/components/workflow-workspace.css'), 'utf8'),
]);
assert.match(appSource, /lazy\(\(\) => import\('\.\/components\/WorkflowWorkspace'\)/);
assert.match(appSource, /onOpenWorkflowRun=\{setWorkflowWorkspaceRunId\}/);
assert.match(appSource, /onStartWorkflowRun=\{startWorkflowFromWorkspace\}/);
assert.match(appSource, /onStartWorkflowStep=\{startWorkflowStepFromWorkspace\}/);
assert.match(appSource, /onCreateWorkflowRun=\{workflowRuntimeController\.createWorkflowRun\}/);
assert.match(appSource, /agentWorkspaceController\.focusAgentRun\(agentRunId\)/);
assert.match(agentWorkspaceSource, /<CanvasExecutionActivity/);
assert.doesNotMatch(canvasSource, /<CanvasExecutionActivity/);
assert.match(
  whiteboardProductCommandsSource,
  /Operation returned without creating an Execution\./,
  'Agent dispatch must not remain running when an Operation produces no Execution.',
);
assert.match(agentRuntimeControllerSource, /commands\.agent\.settleExecution\(/);
assert.match(canvasSource, /onOpenWorkflowRun\(currentRun\.record\.workflowRunId\)/);
assert.match(workspaceSource, /nodesConnectable=\{false\}/);
assert.match(workspaceSource, /nodesDraggable=\{false\}/);
assert.match(workspaceSource, /<ReactFlowProvider>/);
assert.match(workspaceSource, /id="workflow-workspace-graph"/);
assert.match(workspaceSource, /<WorkflowDesignWorkspace/);
assert.match(workspaceSource, /setMode\('design'\)/);
assert.match(workspaceSource, /event\.key !== 'Escape' \|\| event\.defaultPrevented/);
assert.match(workspaceSource, /closest\('\.workflow-design-step-creator'\)/);
assert.match(workspaceSource, /workflowWorkspace\.runEntireWorkflow/);
assert.match(workspaceSource, /workflowWorkspace\.attentionChecklist/);
assert.match(runStepInspectorSource, /workflowWorkspace\.runToStep/);
assert.match(runStepInspectorSource, /workflowWorkspace\.runReadyStep/);
assert.match(runStepInspectorSource, /workflowWorkspace\.rerunLastInputs/);
assert.match(workspaceSource, /onStartWorkflowRun\(graph\.run\.workflowRunId\)/);
assert.match(workspaceSource, /onStartWorkflowStep\(/);
assert.match(workspaceSource, /setSelectedWorkflowRunId\(workflowRunId\)/);
assert.match(workspaceSource, /setMode\('run'\)/);
assert.match(
  workspaceStyles,
  /\.workflow-workspace-graph \.react-flow__edge-path \{ stroke: var\(--retake-text-subtle\); stroke-width: 1\.6; \}/,
  'Run View dependency paths must resolve to a defined visible theme color.',
);
assert.doesNotMatch(workspaceStyles, /--retake-border-strong/);
assert.doesNotMatch(workspaceSource, /updateSnapshot|persistSnapshot|createWorkflowRun/);
assert.match(designWorkspaceSource, /id="workflow-design-graph"/);
assert.match(designWorkspaceSource, /forkInstalledWorkflow/);
assert.match(designWorkspaceSource, /kind: 'first'/);
assert.match(designWorkspaceSource, /kind: 'after_step'/);
assert.match(designWorkspaceSource, /kind: 'insert_edge'/);
assert.match(designWorkspaceSource, /edgeTypes=\{edgeTypes\}/);
assert.match(designWorkspaceSource, /addWorkflowAuthoringProjectionPosition/);
assert.match(designStepCreatorSource, /type="search"/);
assert.match(designStepCreatorSource, /listAuthorableCapabilityDefinitions/);
assert.match(designStepCreatorSource, /addWorkflowAuthoringStepAtContext/);
assert.match(
  designStepCreatorSource,
  /stopImmediatePropagation\(\)/,
  'Step Creator Escape must not close the parent Workflow Workspace.',
);
assert.match(designStepCreatorSource, /addEventListener\('keydown', closeOnEscape, \{ capture: true \}\)/);
assert.doesNotMatch(
  designStepCreatorSource,
  /<select/,
  'Capability-first Step Creator must not flatten Capability and Skill into sibling selectors.',
);
assert.match(designDependencyEdgeSource, /EdgeLabelRenderer/);
assert.match(designDependencyEdgeSource, /getSmoothStepPath/);
assert.match(designStepNodeSource, /data\.onAddAfter/);
assert.match(designStepNodeSource, /<WorkflowStepCard/);
assert.match(runStepNodeSource, /<WorkflowStepCard/);
assert.match(designStepInspectorSource, /workflowInspector\.overview/);
assert.match(designStepInspectorSource, /workflowInspector\.inputs/);
assert.match(designStepInspectorSource, /workflowInspector\.behavior/);
assert.match(designStepInspectorSource, /workflowAuthoring\.imageStepParameters/);
assert.match(designStepInspectorSource, /currentStep\.capabilityLock\.capabilityId === imageGenerateCapabilityId/);
assert.match(designStepInspectorSource, /workflow-step-\$\{stepId\}-connection/);
assert.match(designStepInspectorSource, /workflow-step-\$\{stepId\}-aspect-ratio/);
assert.match(designStepInspectorSource, /workflow-step-\$\{stepId\}-resolution/);
assert.match(designStepInspectorSource, /workflow-step-\$\{stepId\}-variation-count/);
assert.match(designStepInspectorSource, /workflowInspector\.outputs/);
assert.match(designStepInspectorSource, /workflowInspector\.validation/);
assert.match(designWorkspaceSource, /workflowAuthoringChecklistFor/);
assert.match(designWorkspaceSource, /setProjectedRevision\(await onProjectRevision\(revision\)\)/);
assert.match(designProjectionResultSource, /workflowRuntime\.create/);
assert.match(designProjectionResultSource, /onCreateWorkflowRun\(projection\.groupBlockId\)/);
assert.match(
  whiteboardProductCommandsSource,
  /assertProjectScope\(snapshot, input\.revision\.projectId\)/,
  'A Project Revision must not project into another Project.',
);
assert.match(designWorkspaceSource, /onLocateStep=\{locateStep\}/);
assert.match(designValidationChecklistSource, /item\.stepId/);
assert.match(designValidationChecklistSource, /onLocateStep\(item\.stepId\)/);
assert.match(runStepInspectorSource, /workflowInspector\.status/);
assert.match(runStepInspectorSource, /workflowInspector\.inputs/);
assert.match(runStepInspectorSource, /workflowInspector\.outputs/);
assert.match(runStepInspectorSource, /workflowInspector\.lastRun/);
assert.match(runStepInspectorSource, /workflowInspector\.actions/);
assert.match(runStepInspectorSource, /snapshot\.workflowStepRuns/);
assert.match(runStepInspectorSource, /snapshot\.executions/);
assert.match(runStepInspectorSource, /resolvedInputBindings/);
assert.match(runStepInspectorSource, /outputArtifactBindings/);
assert.match(sharedStepCardSource, /workflow-step-card-typed/);
assert.doesNotMatch(sharedStepCardSource, /BoardSnapshot|WorkflowDefinition|StepRun/);
assert.doesNotMatch(
  designWorkspaceSource,
  /updateSnapshot|persistSnapshot|createWorkflowRunForGroup/,
);

console.log(JSON.stringify({
  agentCompactBar: true,
  deterministicDagLayout: true,
  designModeUsesSeparateProjectDraftState: true,
  exactDependencyEdges: true,
  graphSnapshotImmutable: true,
  graphStoreIsolatedFromBoard: true,
  historicalMissingDependencySafe: true,
  runViewStartsExistingAgentRuntime: true,
  sharedAgentAndGroupEntry: true,
  startedRunFocusesAgentSession: true,
  workflowWorkspaceLazyLoaded: true,
}));

function fixtureSnapshot(): BoardSnapshot {
  const snapshot = structuredClone(defaultSnapshot);
  snapshot.project.projectId = 'project_graph';
  snapshot.board.projectId = 'project_graph';
  snapshot.board.boardId = 'board_graph';
  snapshot.blocks = [
    fixtureBlock('group_ip', 'group', 'IP character design', {
      workflowProjectionId: 'projection_ip',
    }),
    fixtureBlock('operation_a', 'operation', 'Define character'),
    fixtureBlock('operation_b', 'operation', 'Concept directions'),
    fixtureBlock('operation_c', 'operation', 'Character sheet'),
    fixtureBlock('operation_d', 'operation', 'Application board'),
  ];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.workflowRuns = [fixtureRun()];
  snapshot.workflowStepRuns = [
    fixtureStep('step_a', 'a', 'operation_a', 'waiting_input', []),
    fixtureStep('step_b', 'b', 'operation_b', 'pending', ['a']),
    fixtureStep('step_c', 'c', 'operation_c', 'pending', ['a']),
    fixtureStep('step_d', 'd', 'operation_d', 'blocked', ['b', 'c'], true),
  ];
  snapshot.workflowGateEvaluations = [];
  return snapshot;
}

function fixtureRun(): WorkflowRunRecord {
  return {
    boardId: 'board_graph',
    createdAt: now,
    createdBy: 'user',
    currentStepIds: ['a'],
    gateDefinitionLocks: [{
      definitionHash: 'sha256:gate-review',
      gateId: 'gate.review',
      kind: 'human_approval',
      name: 'Final review',
      required: true,
      subject: { kind: 'step_output', outputSlotId: 'board', stepId: 'd' },
    }],
    gateEvaluationIds: [],
    inputBindings: [],
    outputSlotLocks: [],
    projectId: 'project_graph',
    recordVersion: 1,
    status: 'waiting_input',
    stepRunIds: ['step_a', 'step_b', 'step_c', 'step_d'],
    updatedAt: now,
    workflowDefinitionLock: {
      definitionHash: 'sha256:workflow-ip',
      version: '0.1.0',
      workflowId: 'retake.workflow.ip-character-design',
    },
    workflowProjectionId: 'projection_ip',
    workflowRunId: 'run_ip',
  };
}

function fixtureStep(
  stepRunId: string,
  stepId: string,
  operationBlockId: string,
  status: WorkflowStepRunStatus,
  dependsOn: string[],
  withArtifact = false,
): WorkflowStepRunRecord {
  return {
    acceptedOutputAssetIds: [],
    capabilityLock: {
      capabilityId: stepId === 'a' ? 'design.ip_character.define' : 'image.generate',
      definitionHash: `sha256:capability-${stepId}`,
      version: '0.1.0',
    },
    createdAt: now,
    dependsOn,
    executionIds: [],
    freshness: 'current',
    operationBlockId,
    outputAcceptancePolicy: 'manual_single',
    outputArtifactBindings: withArtifact ? [{
      artifactId: 'artifact_d',
      artifactRevisionId: 'revision_d',
      artifactType: 'ip_application_board',
      assetIds: ['asset_d'],
      boundAt: now,
      executionIds: [],
      outputSlotId: 'board',
      primaryAssetId: 'asset_d',
      workflowOutputSlotId: 'application_board',
    }] : [],
    outputAssetIds: [],
    outputBlockIds: [],
    outputSlotIds: ['board'],
    recordVersion: 1,
    resolvedInputBindings: [],
    skillLock: {
      definitionHash: `sha256:skill-${stepId}`,
      skillId: `retake.skill.${stepId}`,
      version: '0.1.0',
    },
    status,
    stepId,
    stepRunId,
    updatedAt: now,
    workflowRunId: 'run_ip',
  };
}

function fixtureBlock(
  blockId: string,
  type: 'group' | 'operation',
  title: string,
  extra: Record<string, unknown> = {},
) {
  return {
    blockId,
    boardId: 'board_graph',
    createdAt: now,
    data: { title, ...extra },
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { height: 100, width: 100 },
    type,
    updatedAt: now,
    zIndex: 1,
  };
}
