import assert from 'node:assert/strict';
import type { AgentRunRecord } from '../src/core/agentRuntimeContracts';
import type { BoardSnapshot } from '../src/core/types';
import { workflowRunExperienceFor } from '../src/core/workflowRunExperience';

const now = '2026-08-01T10:00:00.000Z';
const snapshot = fixtureSnapshot();
const before = JSON.stringify(snapshot);

const withoutActiveAgent = workflowRunExperienceFor(snapshot);
assert.equal(withoutActiveAgent.defaultWorkflowRunId, 'workflow_attention');
assert.equal(withoutActiveAgent.attentionCount, 1);
assert.equal(withoutActiveAgent.activeCount, 1);

const activeAgentRun = fixtureAgentRun('workflow_history');
const experience = workflowRunExperienceFor(snapshot, activeAgentRun);
assert.equal(experience.defaultWorkflowRunId, 'workflow_history');
assert.equal(experience.runs[0]?.isActiveAgentRunTarget, true);

const attention = experience.runs.find((run) => run.workflowRunId === 'workflow_attention');
assert.equal(attention?.label, 'Guided image workflow');
assert.equal(attention?.completedStepCount, 1);
assert.equal(attention?.currentStepCount, 1);
assert.equal(attention?.nextStepCount, 1);
assert.equal(attention?.blockedStepCount, 1);
assert.equal(attention?.executionCount, 2);
assert.equal(attention?.artifactRevisionCount, 1);
assert.equal(attention?.gateCount, 1);
assert.equal(attention?.gateWaitingCount, 1);
assert.deepEqual(
  attention?.steps.map((step) => [step.label, step.role]),
  [
    ['Prepare prompt', 'done'],
    ['Generate image', 'current'],
    ['Review result', 'next'],
    ['publish', 'blocked'],
  ],
);

const history = experience.runs.find((run) => run.workflowRunId === 'workflow_history');
assert.equal(history?.label, 'workflow.removed-package');
assert.equal(history?.steps[0]?.label, 'archived-step');
assert.equal(JSON.stringify(snapshot), before, 'Run Experience projection must not mutate the Board Snapshot.');

console.log(JSON.stringify({
  ok: true,
  activeAgentTargetPriority: true,
  canonicalSummaryProjection: true,
  historicalDefinitionFallback: true,
  snapshotImmutable: true,
}));

function fixtureSnapshot(): BoardSnapshot {
  const gateDefinitionLock = {
    definitionHash: 'sha256:gate',
    gateId: 'gate.review',
    kind: 'human_approval' as const,
    name: 'Review',
    required: true as const,
    subject: { kind: 'step_output' as const, outputSlotId: 'image', stepId: 'generate' },
  };
  const snapshot = {
    schemaVersion: 1,
    project: {
      projectId: 'project_test',
      name: 'Project',
      defaultBoardId: 'board_test',
      createdAt: now,
      updatedAt: now,
    },
    board: {
      boardId: 'board_test',
      projectId: 'project_test',
      name: 'Board',
      createdAt: now,
      updatedAt: now,
    },
    layers: [],
    blocks: [
      fixtureBlock('group_attention', 'group', 'Guided image workflow', { workflowProjectionId: 'projection_attention' }),
      fixtureBlock('operation_prepare', 'operation', 'Prepare prompt'),
      fixtureBlock('operation_generate', 'operation', 'Generate image'),
      fixtureBlock('operation_review', 'operation', 'Review result'),
      fixtureBlock('operation_publish', 'operation'),
      fixtureBlock('operation_archived', 'operation'),
    ],
    edges: [],
    assets: [],
    executions: [],
    workflowRuns: [
      {
        boardId: 'board_test',
        createdAt: now,
        createdBy: 'user' as const,
        currentStepIds: ['generate', 'review'],
        gateDefinitionLocks: [gateDefinitionLock],
        gateEvaluationIds: ['gate_current'],
        inputBindings: [],
        outputSlotLocks: [],
        projectId: 'project_test',
        recordVersion: 1,
        status: 'waiting_input' as const,
        stepRunIds: ['step_prepare', 'step_generate', 'step_review', 'step_publish'],
        updatedAt: '2026-08-01T09:00:00.000Z',
        workflowDefinitionLock: {
          definitionHash: 'sha256:workflow-attention',
          version: '0.11.0',
          workflowId: 'workflow.guided-image',
        },
        workflowProjectionId: 'projection_attention',
        workflowRunId: 'workflow_attention',
      },
      {
        boardId: 'board_test',
        createdAt: now,
        createdBy: 'user' as const,
        currentStepIds: [],
        gateDefinitionLocks: [],
        gateEvaluationIds: [],
        inputBindings: [],
        outputSlotLocks: [],
        projectId: 'project_test',
        recordVersion: 1,
        status: 'succeeded' as const,
        stepRunIds: ['step_archived'],
        updatedAt: '2026-08-01T09:30:00.000Z',
        workflowDefinitionLock: {
          definitionHash: 'sha256:removed',
          version: '0.1.0',
          workflowId: 'workflow.removed-package',
        },
        workflowProjectionId: 'projection_removed',
        workflowRunId: 'workflow_history',
      },
    ],
    workflowStepRuns: [
      fixtureStep('step_prepare', 'workflow_attention', 'prepare', 'operation_prepare', 'succeeded', ['execution_prepare']),
      fixtureStep('step_generate', 'workflow_attention', 'generate', 'operation_generate', 'waiting_input', ['execution_generate'], true),
      fixtureStep('step_review', 'workflow_attention', 'review', 'operation_review', 'ready'),
      fixtureStep('step_publish', 'workflow_attention', 'publish', 'operation_publish', 'blocked'),
      fixtureStep('step_archived', 'workflow_history', 'archived-step', 'operation_archived', 'succeeded'),
    ],
    workflowGateEvaluations: [
      {
        approvalRequestId: 'approval_current',
        boardId: 'board_test',
        createdAt: now,
        freshness: 'current' as const,
        gateDefinitionLock,
        gateEvaluationId: 'gate_current',
        gateId: 'gate.review',
        projectId: 'project_test',
        recordVersion: 1,
        status: 'waiting_approval' as const,
        subjectAssetIds: [],
        subjectExecutionIds: [],
        subjectFingerprint: 'current',
        updatedAt: '2026-08-01T08:00:00.000Z',
        workflowRunId: 'workflow_attention',
      },
      {
        approvalRequestId: 'approval_outdated',
        boardId: 'board_test',
        createdAt: now,
        freshness: 'outdated' as const,
        gateDefinitionLock,
        gateEvaluationId: 'gate_outdated',
        gateId: 'gate.review',
        projectId: 'project_test',
        recordVersion: 2,
        status: 'failed' as const,
        subjectAssetIds: [],
        subjectExecutionIds: [],
        subjectFingerprint: 'outdated',
        updatedAt: '2026-08-01T09:00:00.000Z',
        workflowRunId: 'workflow_attention',
      },
    ],
  } as BoardSnapshot;
  return snapshot;
}

function fixtureBlock(
  blockId: string,
  type: 'group' | 'operation',
  title?: string,
  extra: Record<string, unknown> = {},
) {
  return {
    blockId,
    boardId: 'board_test',
    createdAt: now,
    data: { ...(title ? { title } : {}), ...extra },
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { height: 100, width: 100 },
    type,
    updatedAt: now,
    zIndex: 1,
  };
}

function fixtureStep(
  stepRunId: string,
  workflowRunId: string,
  stepId: string,
  operationBlockId: string,
  status: 'blocked' | 'ready' | 'succeeded' | 'waiting_input',
  executionIds: string[] = [],
  withArtifact = false,
) {
  return {
    acceptedOutputAssetIds: [],
    capabilityLock: { capabilityId: 'capability.test', definitionHash: 'sha256:capability', version: '1.0.0' },
    createdAt: now,
    dependsOn: [],
    executionIds,
    freshness: 'current' as const,
    operationBlockId,
    outputAcceptancePolicy: 'automatic' as const,
    outputArtifactBindings: withArtifact ? [{
      artifactId: 'artifact_image',
      artifactRevisionId: 'revision_image',
      artifactType: 'image',
      assetIds: ['asset_image'],
      boundAt: now,
      executionIds,
      outputSlotId: 'image',
      primaryAssetId: 'asset_image',
      workflowOutputSlotId: 'image',
    }] : [],
    outputAssetIds: [],
    outputBlockIds: [],
    outputSlotIds: [],
    recordVersion: 1,
    resolvedInputBindings: [],
    skillLock: { definitionHash: 'sha256:skill', skillId: 'skill.test', version: '1.0.0' },
    status,
    stepId,
    stepRunId,
    updatedAt: now,
    workflowRunId,
  };
}

function fixtureAgentRun(workflowRunId: string): AgentRunRecord {
  return {
    agentRunId: 'agent_run_active',
    boardId: 'board_test',
    createdAt: now,
    createdBy: 'user',
    executionIds: [],
    permissions: {
      allowedToolPermissions: ['retake.read'],
      canCreateBlocks: false,
      canDeleteAssets: false,
      canInstallPackages: false,
      canModifyWorkflow: false,
    },
    projectId: 'project_test',
    recordVersion: 1,
    runtimeKind: 'retake_orchestrator',
    scope: {
      allowedCapabilityIds: [],
      allowedOperationBlockIds: [],
      allowedStepRunIds: [],
      boardId: 'board_test',
      projectId: 'project_test',
      workflowRunId,
    },
    status: 'succeeded',
    stopPolicy: { kind: 'workflow_terminal' },
    target: {
      kind: 'workflow_run',
      workflowDefinitionLock: {
        definitionHash: 'sha256:removed',
        version: '0.1.0',
        workflowId: 'workflow.removed-package',
      },
      workflowRunId,
    },
    updatedAt: now,
  };
}
