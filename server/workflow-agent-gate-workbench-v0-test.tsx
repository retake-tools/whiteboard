import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentWorkflowStepMessage } from '../src/components/AgentWorkflowStepConversation';
import {
  WorkflowCandidateDock,
  workflowCandidateDecision,
} from '../src/components/WorkflowCandidateDock';
import type { AgentRunRecord } from '../src/core/agentRuntimeContracts';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord,
} from '../src/core/workflowRuntimeContracts';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { I18nProvider } from '../src/i18n';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'zh',
    setItem: () => undefined,
  },
});

const now = '2026-08-14T12:00:00.000Z';
const operation = block('operation_candidates', 'operation', '生成多尺寸');
const candidateOne = block('candidate_one', 'image', '主图方案 A', 'asset_candidate_one');
const candidateTwo = block('candidate_two', 'image', '主图方案 B', 'asset_candidate_two');
const step = {
  acceptedOutputAssetIds: [],
  capabilityLock: {} as WorkflowStepRunRecord['capabilityLock'],
  createdAt: now,
  dependsOn: [],
  executionIds: ['execution_candidates'],
  freshness: 'current',
  operationBlockId: operation.blockId,
  outputAcceptancePolicy: 'manual_single',
  outputArtifactBindings: [],
  outputAssetIds: ['asset_candidate_one', 'asset_candidate_two'],
  outputBlockIds: [candidateOne.blockId, candidateTwo.blockId],
  outputSlotIds: ['image'],
  recordVersion: 3,
  resolvedInputBindings: [],
  skillLock: {} as WorkflowStepRunRecord['skillLock'],
  status: 'waiting_selection',
  stepId: 'generate_sizes',
  stepRunId: 'step_run_candidates',
  updatedAt: now,
  workflowRunId: 'workflow_run_gate',
} satisfies WorkflowStepRunRecord;
const workflowRun = {
  boardId: defaultSnapshot.board.boardId,
  createdAt: now,
  createdBy: 'user',
  currentStepIds: [step.stepId],
  gateDefinitionLocks: [],
  gateEvaluationIds: [],
  inputBindings: [],
  outputSlotLocks: [],
  projectId: defaultSnapshot.project.projectId,
  recordVersion: 2,
  status: 'waiting_selection',
  stepRunIds: [step.stepRunId],
  updatedAt: now,
  workflowDefinitionLock: {
    definitionHash: 'sha256:fixture',
    version: '1.0.0',
    workflowId: 'retake.workflow.fixture',
  },
  workflowProjectionId: 'workflow_projection_gate',
  workflowRunId: 'workflow_run_gate',
} satisfies WorkflowRunRecord;
const agentRun = {
  agentRunId: 'agent_run_gate',
  target: {
    kind: 'workflow_run',
    workflowDefinitionLock: workflowRun.workflowDefinitionLock,
    workflowRunId: workflowRun.workflowRunId,
  },
} as AgentRunRecord;
const snapshot: BoardSnapshot = {
  ...structuredClone(defaultSnapshot),
  assets: [
    imageAsset('asset_candidate_one', 'data:image/png;base64,ONE'),
    imageAsset('asset_candidate_two', 'data:image/png;base64,TWO'),
  ],
  blocks: [operation, candidateOne, candidateTwo],
  workflowRuns: [workflowRun],
  workflowStepRuns: [step],
};

const decision = workflowCandidateDecision(snapshot, agentRun);
assert.equal(decision?.step.stepRunId, step.stepRunId);
assert.deepEqual(
  decision?.candidates.map((candidate) => candidate.assetId),
  ['asset_candidate_one', 'asset_candidate_two'],
);
assert.equal(workflowCandidateDecision(snapshot, undefined), undefined);

const emptySelectionMarkup = renderToStaticMarkup(
  <I18nProvider>
    <WorkflowCandidateDock
      agentRun={agentRun}
      onAcceptCandidate={() => undefined}
      onOpenCandidateDetails={() => undefined}
      onSelectBlock={() => undefined}
      snapshot={snapshot}
    />
  </I18nProvider>,
);
assert.match(emptySelectionMarkup, /生成多尺寸/);
assert.match(emptySelectionMarkup, /候选 1/);
assert.match(emptySelectionMarkup, /候选 2/);
assert.match(emptySelectionMarkup, /选用并继续/);
assert.match(emptySelectionMarkup, /disabled=""/);
assert.match(emptySelectionMarkup, /单击预览，双击查看详情/);

const selectedMarkup = renderToStaticMarkup(
  <I18nProvider>
    <WorkflowCandidateDock
      agentRun={agentRun}
      onAcceptCandidate={() => undefined}
      onOpenCandidateDetails={() => undefined}
      onSelectBlock={() => undefined}
      selectedBlockId={candidateTwo.blockId}
      snapshot={snapshot}
    />
  </I18nProvider>,
);
assert.match(selectedMarkup, /aria-pressed="true"/);
assert.match(selectedMarkup, /预览中/);
assert.doesNotMatch(selectedMarkup, /<button type="button" disabled=""[^>]*><svg[^>]*>.*选用并继续/);

const stepMarkup = renderToStaticMarkup(
  <I18nProvider>
    <AgentWorkflowStepMessage
      candidateDecisionPlacement="dock"
      onLocateBlock={() => undefined}
      onRerunOperation={() => undefined}
      onSelectWorkflowOutput={() => undefined}
      snapshot={snapshot}
      step={{
        executionCount: 1,
        freshness: 'current',
        label: '生成多尺寸',
        operationBlockId: operation.blockId,
        role: 'current',
        status: 'waiting_selection',
        stepId: step.stepId,
        stepRunId: step.stepRunId,
      }}
      stepIndex={2}
      totalStepCount={4}
    />
  </I18nProvider>,
);
assert.match(stepMarkup, /候选已显示在画布下方/);
assert.match(stepMarkup, /查看候选/);
assert.doesNotMatch(stepMarkup, /agent-workflow-candidate-grid/);

const [appSource, canvasSource, dockSource, eventBindingSource, workspaceSource, styles] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/WhiteboardCanvas.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/WorkflowCandidateDock.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAppEventBindings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/generation-task-panel.css', import.meta.url), 'utf8'),
]);
assert.match(appSource, /workspaceSurface\.kind === 'agent'/);
assert.match(appSource, /<WorkflowCandidateDock/);
assert.match(appSource, /onAcceptCandidate=\{workflowRuntimeController\.acceptWorkflowOutput\}/);
assert.match(appSource, /onOpenCandidateDetails=/);
assert.match(appSource, /retake:open-execution-inspector/);
assert.match(appSource, /imageCandidatePreviewBlockIds=\{workflowCandidatePreviewBlockIds\}/);
assert.match(canvasSource, /imageCandidatePreviewBlockIds\.includes\(node\.id\)/);
assert.match(canvasSource, /imageCandidatePreviewBlockIds\.includes\(selectedNode\.id\)/);
assert.doesNotMatch(canvasSource, /suppressImageInspectorForSelection/);
assert.match(dockSource, /onDoubleClick=/);
assert.match(dockSource, /onOpenCandidateDetails\(candidate\.block\.blockId\)/);
assert.match(eventBindingSource, /if \(block\.type === 'image'\) \{[\s\S]*setImageFocusBlockIdRef\.current\(blockId\)/);
assert.doesNotMatch(eventBindingSource, /isImageGenerationBlock/);
assert.match(workspaceSource, /agent-workspace-adjust-plan/);
assert.match(workspaceSource, /workflowAdjustPlanPrompt/);
assert.match(styles, /\.workflow-candidate-dock > footer/);

console.log(JSON.stringify({
  candidatePreviewIsEphemeral: true,
  candidateDoubleClickOpensDetails: true,
  canonicalAcceptanceCommandReused: true,
  nonCandidateImageInspectorPreserved: true,
  planAdjustmentUsesAgentMessage: true,
  waitingSelectionUsesSingleTimeline: true,
}));

function block(
  blockId: string,
  type: BlockRecord['type'],
  title: string,
  assetId?: string,
): BlockRecord {
  return {
    blockId,
    boardId: defaultSnapshot.board.boardId,
    createdAt: now,
    data: { ...(assetId ? { assetId } : {}), title },
    layerId: defaultSnapshot.layers[0]!.id,
    position: { x: 0, y: 0 },
    size: { width: 280, height: 320 },
    type,
    updatedAt: now,
    zIndex: 1,
  };
}

function imageAsset(assetId: string, previewUrl: string): AssetRecord {
  return {
    assetId,
    createdAt: now,
    height: 1440,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl,
    projectId: defaultSnapshot.project.projectId,
    storageKey: `assets/${assetId}.png`,
    storageProvider: 'local',
    width: 1080,
  };
}
