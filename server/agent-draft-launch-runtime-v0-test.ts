import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import {
  applyWorkflowLaunchPreferences,
  decideChangeProposal,
} from '../src/core/agentChangeApplication';
import { reconcileAgentRuntime } from '../src/core/agentRuntime';
import type {
  ChangeProposalRecord,
  PackageEntrypointAgentLaunchTarget,
} from '../src/core/agentSessionContracts';
import {
  buildPackageEntrypointDraftLaunchCommand,
  stagePackageEntrypointAgentLaunch,
} from '../src/core/packageEntrypointAgentLaunchApplication';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';
import { resetWorkspace } from './local-store/snapshot-store';
import './studio-domain-test-fixtures';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-agent-draft-launch-v0')) {
  throw new Error('Agent Draft launch tests require a disposable RETAKE_WORKSPACE_DIR.');
}

const skill = await appliedProposal({
  content: '一只快递猫要在日出前把最后一卷胶片送到影院。',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const skillCommand = launchCommand(skill.proposal, skill.sessionId, { kind: 'capability' });
const launchedSkill = stagePackageEntrypointAgentLaunch(skill.snapshot, skillCommand);
const skillRun = launchedSkill.stagedSnapshot.agentRuns?.find(
  (run) => run.agentRunId === launchedSkill.effect.agentRunId,
);
assert.equal(skillRun?.target.kind, 'capability');
assert.equal(skillRun?.status, 'running');
assert.equal(skillRun?.sourceChangeProposalId, skill.proposal.proposalId);
assert.equal(
  launchedSkill.stagedSnapshot.agentSessions?.find(
    (session) => session.agentSessionId === skill.sessionId,
  )?.activeAgentRunId,
  skillRun?.agentRunId,
);
assert.equal(launchedSkill.stagedSnapshot.executions.length, 0);
assert.equal(launchedSkill.effect.targetKind, 'capability');

const skillRetry = stagePackageEntrypointAgentLaunch(
  launchedSkill.stagedSnapshot,
  skillCommand,
);
assert.equal(skillRetry.effect.agentRunId, launchedSkill.effect.agentRunId);
assert.equal(skillRetry.stagedSnapshot.agentRuns?.length, 1);
assert.throws(
  () => stagePackageEntrypointAgentLaunch(launchedSkill.stagedSnapshot, {
    ...skillCommand,
    target: { kind: 'workflow_run' },
  }),
  /retry target conflicts|Skill Draft/,
);

const waitingSkill = await appliedProposal({
  content: 'Temporary brief.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const waitingInput = waitingSkill.snapshot.blocks.find(
  (block) => block.type === 'text' && waitingSkill.proposal.appliedEffect?.createdBlockIds.includes(block.blockId),
);
assert.ok(waitingInput);
waitingInput.data.body = '';
const launchedWaiting = stagePackageEntrypointAgentLaunch(
  waitingSkill.snapshot,
  launchCommand(waitingSkill.proposal, waitingSkill.sessionId, { kind: 'capability' }),
);
reconcileAgentRuntime(launchedWaiting.stagedSnapshot);
assert.equal(launchedWaiting.stagedSnapshot.agentRuns?.[0]?.status, 'waiting_input');
assert.equal(launchedWaiting.stagedSnapshot.executions.length, 0);

const replaceable = await appliedProposal({
  content: '先生成一个快递猫故事梗概。',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const firstReplaceableLaunch = stagePackageEntrypointAgentLaunch(
  replaceable.snapshot,
  launchCommand(replaceable.proposal, replaceable.sessionId, { kind: 'capability' }),
);
const supersededRun = firstReplaceableLaunch.stagedSnapshot.agentRuns?.find(
  (run) => run.agentRunId === firstReplaceableLaunch.effect.agentRunId,
);
assert.ok(supersededRun);
supersededRun.status = 'needs_attention';
supersededRun.stopReason = 'operation_execution_missing';
supersededRun.error = 'No executable Operation is currently ready.';
const replacement = appliedProposalOnSnapshot(
  firstReplaceableLaunch.stagedSnapshot,
  replaceable.sessionId,
  {
    content: '改为规划完整快递猫分镜流程。',
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
    interactionMode: 'manual',
  },
);
const replacementLaunch = stagePackageEntrypointAgentLaunch(
  replacement.snapshot,
  launchCommand(replacement.proposal, replacement.sessionId, { kind: 'workflow_run' }),
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentRuns?.find(
    (run) => run.agentRunId === supersededRun.agentRunId,
  )?.status,
  'canceled',
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentRuns?.find(
    (run) => run.agentRunId === supersededRun.agentRunId,
  )?.stopReason,
  'superseded_by_new_run',
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentSessions?.find(
    (session) => session.agentSessionId === replaceable.sessionId,
  )?.activeAgentRunId,
  replacementLaunch.effect.agentRunId,
);
assert.equal(
  replacementLaunch.stagedSnapshot.agentRuns?.find(
    (run) => run.agentRunId === replacementLaunch.effect.agentRunId,
  )?.interactionMode,
  'manual',
);

const protectedActive = await appliedProposal({
  content: '正在生成快递猫故事梗概。',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const protectedLaunch = stagePackageEntrypointAgentLaunch(
  protectedActive.snapshot,
  launchCommand(protectedActive.proposal, protectedActive.sessionId, { kind: 'capability' }),
);
const blockedReplacement = appliedProposalOnSnapshot(
  protectedLaunch.stagedSnapshot,
  protectedActive.sessionId,
  {
    content: '同时启动完整分镜流程。',
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  },
);
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    blockedReplacement.snapshot,
    launchCommand(blockedReplacement.proposal, blockedReplacement.sessionId, { kind: 'workflow_run' }),
  ),
  /still executing and must be stopped/,
);
assert.equal(blockedReplacement.snapshot.agentRuns?.length, 1);

const executedSkill = await appliedProposal({
  content: 'Already executed.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
executedSkill.snapshot.executions.push({
  params: { operationBlockId: executedSkill.proposal.appliedEffect?.primaryBlockId },
} as unknown as ExecutionRecord);
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    executedSkill.snapshot,
    launchCommand(executedSkill.proposal, executedSkill.sessionId, { kind: 'capability' }),
  ),
  /already has an Execution/,
);
assert.equal(executedSkill.snapshot.agentRuns?.length, 0);

const workflowTargets: PackageEntrypointAgentLaunchTarget[] = [
  { kind: 'workflow_run' },
  { kind: 'workflow_slice', until: { kind: 'step', stepId: 'screenplay_generate' } },
  {
    kind: 'workflow_slice',
    until: { kind: 'artifact', workflowOutputSlotId: 'storyboard_plan' },
  },
  { kind: 'workflow_slice', until: { kind: 'stage', stageId: 'story_screenplay' } },
];

for (const target of workflowTargets) {
  const workflow = await appliedProposal({
    content: '一个关于快递猫守护最后一卷胶片的短片。',
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  });
  const launched = stagePackageEntrypointAgentLaunch(
    workflow.snapshot,
    launchCommand(workflow.proposal, workflow.sessionId, target),
  );
  assert.equal(launched.stagedSnapshot.workflowRuns?.length, 1);
  assert.equal(launched.stagedSnapshot.workflowStepRuns?.length, 4);
  assert.equal(launched.effect.createdWorkflowRun, true);
  assert.ok(launched.effect.workflowRunId);
  const run = launched.stagedSnapshot.agentRuns?.[0];
  assert.equal(run?.target.kind, target.kind);
  assert.equal(run?.sourceChangeProposalId, workflow.proposal.proposalId);
  assert.equal(
    launched.stagedSnapshot.workflowRuns?.[0]?.sourceChangeProposalId,
    workflow.proposal.proposalId,
  );
  if (target.kind === 'workflow_slice') {
    assert.equal(run?.target.kind, 'workflow_slice');
    assert.equal(run?.target.kind === 'workflow_slice' ? run.target.until.kind : undefined, target.until.kind);
  }
}

const archived = await appliedProposal({
  content: 'Archived Session.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const archivedSession = archived.snapshot.agentSessions?.find(
  (session) => session.agentSessionId === archived.sessionId,
);
assert.ok(archivedSession);
archivedSession.status = 'archived';
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    archived.snapshot,
    launchCommand(archived.proposal, archived.sessionId, { kind: 'capability' }),
  ),
  /Session is not active/,
);
assert.equal(archived.snapshot.agentRuns?.length, 0);

const commandSnapshot = await emptySnapshot();
const commandSession = createAgentSession(commandSnapshot, { model: 'test-model' }).session;
const commandStorage = new InMemoryHostStorageAdapter([commandSnapshot]);
const commandHost = await createCanvasHost({
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
    boardId: commandSnapshot.board.boardId,
    projectId: commandSnapshot.project.projectId,
  },
  packageRuntime: createNoopHostPackageRuntime(),
  storage: commandStorage,
});
let commandPublications = 0;
const unsubscribeCommandHost = commandHost.readModel.subscribe(() => {
  commandPublications += 1;
});
const productCommands = createWhiteboardProductCommands(commandHost);
const typedMessage = await productCommands.agentWorkspace.appendMessage({
  agentSessionId: commandSession.agentSessionId,
  content: 'Use the typed product command to launch this screenplay skill.',
  contextRefs: [{
    entrypointId: 'skill:retake.screenplay.from-brief',
    kind: 'entrypoint',
  }],
});
assert.equal(commandPublications, 1);
const typedProposal = await productCommands.agentWorkspace.createEntrypointProposal({
  agentSessionId: commandSession.agentSessionId,
  explanation: 'Create a screenplay Draft.',
  sourceMessageId: typedMessage.agentMessageId,
});
assert.equal(typedProposal.committed, true);
assert.equal(commandPublications, 2);
const typedProposalRetry = await productCommands.agentWorkspace.createEntrypointProposal({
  agentSessionId: commandSession.agentSessionId,
  explanation: 'This retry must reuse the existing Proposal.',
  sourceMessageId: typedMessage.agentMessageId,
});
assert.equal(typedProposalRetry.committed, false);
assert.equal(typedProposalRetry.proposalId, typedProposal.proposalId);
assert.equal(commandPublications, 2);
const typedDecision = await productCommands.agentWorkspace.decideProposal({
  decision: 'approve',
  expectedProposalVersion: typedProposal.proposalVersion,
  presentation: {
    connectionIdsByCapability: {
      'story.screenplay.generate': 'test-text-connection',
    },
    labelsBySkillId: {
      'retake.screenplay.from-brief': {
        inputBlockType: 'text',
        inputTitle: 'Creative brief',
        operationTitle: 'Generate screenplay',
        outputTitle: 'Screenplay',
        promptPlaceholder: 'Write a screenplay.',
        promptTitle: 'Prompt',
      },
    },
    outputPlaceholder: 'Waiting for execution.',
    placementCenter: { x: 640, y: 420 },
  },
  proposalId: typedProposal.proposalId,
});
assert.equal(typedDecision.committed, true);
assert.equal(typedDecision.appliedEffect?.kind, 'package_entrypoint_draft');
assert.equal(commandPublications, 3);
const typedDecisionRetry = await productCommands.agentWorkspace.decideProposal({
  decision: 'approve',
  expectedProposalVersion: typedProposal.proposalVersion,
  presentation: {
    connectionIdsByCapability: {},
    labelsBySkillId: {},
    outputPlaceholder: 'Unused during idempotent retry.',
    placementCenter: { x: 0, y: 0 },
  },
  proposalId: typedProposal.proposalId,
});
assert.equal(typedDecisionRetry.committed, false);
assert.equal(typedDecisionRetry.proposalVersion, typedDecision.proposalVersion);
assert.equal(commandPublications, 3);
const typedLaunchCommand = buildPackageEntrypointDraftLaunchCommand({
  agentSessionId: commandSession.agentSessionId,
  expectedProposalVersion: typedDecision.proposalVersion,
  proposalId: typedProposal.proposalId,
  target: { kind: 'capability' },
});
const typedLaunch = await productCommands.agentWorkspace.launchDraft({
  command: typedLaunchCommand,
});
assert.equal(typedLaunch.committed, true);
assert.equal(commandPublications, 4);
assert.equal(commandHost.readModel.getSnapshot().agentRuns?.[0]?.agentRunId, typedLaunch.agentRunId);
const typedRetry = await productCommands.agentWorkspace.launchDraft({
  command: typedLaunchCommand,
});
assert.equal(typedRetry.committed, false);
assert.equal(typedRetry.agentRunId, typedLaunch.agentRunId);
assert.equal(commandPublications, 4);
const durableTypedLaunch = await commandStorage.loadBoard({
  boardId: commandSnapshot.board.boardId,
  projectId: commandSnapshot.project.projectId,
});
assert.equal(durableTypedLaunch.agentRuns?.[0]?.agentRunId, typedLaunch.agentRunId);
assert.equal(
  durableTypedLaunch.agentMessages?.some(
    (message) => message.agentMessageId === typedMessage.agentMessageId,
  ),
  true,
);
assert.equal(
  durableTypedLaunch.changeProposals?.filter(
    (proposal) => proposal.sourceMessageId === typedMessage.agentMessageId,
  ).length,
  1,
);
const runtimeSession = await productCommands.agentWorkspace.createSession({
  connection: {
    connectionId: 'test-runtime-connection',
    model: 'test-runtime-model',
    runtimeKind: 'direct_api',
  },
});
assert.equal(commandPublications, 5);
const runtimeMessage = await productCommands.agentWorkspace.appendMessage({
  agentSessionId: runtimeSession.agentSessionId,
  content: 'Report current status.',
  contextRefs: [],
});
assert.equal(commandPublications, 6);
const runtimeEventInput = {
  event: {
    agentSessionId: runtimeSession.agentSessionId,
    kind: 'turn_started' as const,
    occurredAt: '2026-08-10T00:00:00.000Z',
    runtimeEventId: 'runtime_event_typed_command',
  },
  sourceMessageId: runtimeMessage.agentMessageId,
};
const typedRuntimeEvent = await productCommands.agentWorkspace.appendRuntimeEvent(runtimeEventInput);
assert.equal(typedRuntimeEvent.committed, true);
assert.equal(commandPublications, 7);
const typedRuntimeEventRetry = await productCommands.agentWorkspace.appendRuntimeEvent(runtimeEventInput);
assert.equal(typedRuntimeEventRetry.committed, false);
assert.equal(typedRuntimeEventRetry.sequence, typedRuntimeEvent.sequence);
assert.equal(commandPublications, 7);
const operationPresentation = {
  connectionId: 'codex-app-server',
  imageToImagePromptPlaceholder: 'Describe the edit.',
  operationTitle: 'Generate image',
  placementCenter: { x: 700, y: 460 },
  promptPlaceholder: 'Describe the image.',
  promptTitle: 'Prompt',
};
const runtimeTurnInput = {
  agentSessionId: runtimeSession.agentSessionId,
  decision: { kind: 'reply' as const, message: 'Everything is ready.' },
  externalThreadId: 'thread_typed_runtime_command',
  runtimeModel: 'test-runtime-model',
  runtimeTurnId: 'turn_typed_runtime_command',
  operationPresentation,
  sourceMessageId: runtimeMessage.agentMessageId,
};
const typedRuntimeTurn = await productCommands.agentWorkspace.applyRuntimeTurn(runtimeTurnInput);
assert.equal(typedRuntimeTurn.committed, true);
assert.equal(commandPublications, 8);
const typedRuntimeTurnRetry = await productCommands.agentWorkspace.applyRuntimeTurn(runtimeTurnInput);
assert.equal(typedRuntimeTurnRetry.committed, false);
assert.equal(typedRuntimeTurnRetry.assistantMessageId, typedRuntimeTurn.assistantMessageId);
assert.equal(commandPublications, 8);
const typedRuntimeFailure = await productCommands.agentWorkspace.recordRuntimeRecovery({
  agentSessionId: runtimeSession.agentSessionId,
  content: 'The Agent is unavailable. Retry or keep the current content.',
  error: 'Provider unavailable.',
  kind: 'runtime_unavailable',
  sourceMessageId: runtimeMessage.agentMessageId,
  suggestions: ['Retry', 'Keep current content'],
});
assert.equal(typedRuntimeFailure.committed, true);
assert.equal(commandPublications, 9);
const typedRuntimeFailureRetry = await productCommands.agentWorkspace.recordRuntimeRecovery({
  agentSessionId: runtimeSession.agentSessionId,
  content: 'The Agent is unavailable. Retry or keep the current content.',
  error: 'Provider unavailable.',
  kind: 'runtime_unavailable',
  sourceMessageId: runtimeMessage.agentMessageId,
  suggestions: ['Retry', 'Keep current content'],
});
assert.equal(typedRuntimeFailureRetry.committed, false);
assert.equal(commandPublications, 9);
const operationSession = await productCommands.agentWorkspace.createSession({
  connection: {
    connectionId: 'test-operation-connection',
    model: 'test-operation-model',
    runtimeKind: 'direct_api',
  },
});
assert.equal(commandPublications, 10);
const operationMessage = await productCommands.agentWorkspace.appendMessage({
  agentSessionId: operationSession.agentSessionId,
  content: 'Create a poster image.',
  contextRefs: [],
});
assert.equal(commandPublications, 11);
const operationTurn = await productCommands.agentWorkspace.applyRuntimeTurn({
  agentSessionId: operationSession.agentSessionId,
  decision: {
    capabilityId: 'image.generate',
    generationParams: { aspectRatioPreset: '4:3', variationCount: 1 },
    kind: 'operation_create_execute',
    message: 'I will create the poster image.',
    operationPrompt: 'A courier cat carrying a film reel at sunrise.',
  },
  externalThreadId: 'thread_typed_operation_command',
  operationPresentation,
  runtimeModel: 'test-operation-model',
  runtimeTurnId: 'turn_typed_operation_command',
  sourceMessageId: operationMessage.agentMessageId,
});
assert.equal(commandPublications, 12);
assert.ok(operationTurn.operationStage);
const typedOperationStage = operationTurn.operationStage!;
assert.equal(typedOperationStage.action, 'created');
assert.equal(typedOperationStage.createdBlockIds.length, 2);
assert.equal(commandPublications, 12);
const typedOperationStageRetry = await productCommands.agentWorkspace.applyRuntimeTurn({
  agentSessionId: operationSession.agentSessionId,
  decision: {
    capabilityId: 'image.generate',
    generationParams: { aspectRatioPreset: '4:3', variationCount: 1 },
    kind: 'operation_create_execute',
    message: 'I will create the poster image.',
    operationPrompt: 'A courier cat carrying a film reel at sunrise.',
  },
  externalThreadId: 'thread_typed_operation_command',
  operationPresentation: { ...operationPresentation, placementCenter: { x: 0, y: 0 } },
  runtimeModel: 'test-operation-model',
  runtimeTurnId: 'turn_typed_operation_command',
  sourceMessageId: operationMessage.agentMessageId,
});
assert.equal(typedOperationStageRetry.committed, false);
assert.deepEqual(typedOperationStageRetry.operationStage?.createdBlockIds, typedOperationStage.createdBlockIds);
assert.deepEqual(typedOperationStageRetry.operationStage?.operationScopeIds, typedOperationStage.operationScopeIds);
assert.equal(typedOperationStageRetry.operationStage?.operationBlockId, typedOperationStage.operationBlockId);
assert.equal(typedOperationStageRetry.operationStage?.promptBlockId, typedOperationStage.promptBlockId);
assert.equal(commandPublications, 12);
const suggestionPrompt = await productCommands.agentWorkspace.appendMessage({
  agentSessionId: operationSession.agentSessionId,
  content: 'What can I run next?',
  contextRefs: [],
});
assert.equal(commandPublications, 13);
const suggestionText = `Run Generate image (${typedOperationStage.operationBlockId})`;
const suggestionTurn = await productCommands.agentWorkspace.applyRuntimeTurn({
  agentSessionId: operationSession.agentSessionId,
  decision: {
    kind: 'reply',
    message: 'The generated image Operation is ready.',
    suggestions: [suggestionText],
  },
  externalThreadId: 'thread_typed_suggestion_command',
  operationPresentation,
  runtimeModel: 'test-operation-model',
  runtimeTurnId: 'turn_typed_suggestion_command',
  sourceMessageId: suggestionPrompt.agentMessageId,
});
assert.equal(commandPublications, 14);
const suggestionAction = await productCommands.agentWorkspace.appendMessage({
  agentSessionId: operationSession.agentSessionId,
  content: suggestionText,
  contextRefs: [
    {
      action: 'run',
      kind: 'agent_suggestion_action',
      sourceMessageId: suggestionTurn.assistantMessageId,
    },
    { kind: 'operation', operationBlockId: typedOperationStage.operationBlockId },
  ],
});
assert.equal(commandPublications, 15);
const typedAuthorizedSuggestion = await productCommands.agentWorkspace.authorizeOperationSuggestion({
  agentSessionId: operationSession.agentSessionId,
  operationBlockId: typedOperationStage.operationBlockId,
  presentation: operationPresentation,
  sourceMessageId: suggestionAction.agentMessageId,
});
assert.equal(typedAuthorizedSuggestion.committed, true);
assert.equal(typedAuthorizedSuggestion.action, 'continued');
assert.equal(commandPublications, 16);
await assert.rejects(
  productCommands.agentWorkspace.authorizeOperationSuggestion({
    agentSessionId: operationSession.agentSessionId,
    operationBlockId: 'block_conflicting_suggestion',
    presentation: operationPresentation,
    sourceMessageId: suggestionAction.agentMessageId,
  }),
  /not bound|no longer available/,
);
assert.equal(commandPublications, 16);
const typedAuthorizedSuggestionRetry = await productCommands.agentWorkspace.authorizeOperationSuggestion({
  agentSessionId: operationSession.agentSessionId,
  operationBlockId: typedOperationStage.operationBlockId,
  presentation: operationPresentation,
  sourceMessageId: suggestionAction.agentMessageId,
});
assert.equal(typedAuthorizedSuggestionRetry.committed, false);
assert.equal(
  typedAuthorizedSuggestionRetry.assistantMessageId,
  typedAuthorizedSuggestion.assistantMessageId,
);
assert.equal(commandPublications, 16);
const recoverySession = await productCommands.agentWorkspace.createSession({
  connection: {
    connectionId: 'test-recovery-connection',
    model: 'test-recovery-model',
    runtimeKind: 'direct_api',
  },
});
const recoverySource = await productCommands.agentWorkspace.appendMessage({
  agentSessionId: recoverySession.agentSessionId,
  content: 'Generate an image without a ready execution connection.',
  contextRefs: [],
});
const failedRuntimeTurnId = 'turn_atomic_operation_application_failure';
await assert.rejects(
  productCommands.agentWorkspace.applyRuntimeTurn({
    agentSessionId: recoverySession.agentSessionId,
    decision: {
      capabilityId: 'image.generate',
      kind: 'operation_create_execute',
      message: 'I will generate the image now.',
      operationPrompt: 'A bright modern barbershop character.',
    },
    externalThreadId: 'thread_atomic_operation_application_failure',
    operationPresentation: {
      ...operationPresentation,
      connectionId: undefined,
    },
    runtimeModel: 'test-recovery-model',
    runtimeTurnId: failedRuntimeTurnId,
    sourceMessageId: recoverySource.agentMessageId,
  }),
  /No ready automated Connection/,
);
const afterAtomicFailure = await commandStorage.loadBoard({
  boardId: commandSnapshot.board.boardId,
  projectId: commandSnapshot.project.projectId,
});
assert.equal(
  afterAtomicFailure.agentMessages?.some(
    (message) => message.runtimeTurnId === failedRuntimeTurnId,
  ),
  false,
  'An assistant execution promise must not persist without an Operation receipt.',
);
const recoveryInput = {
  agentSessionId: recoverySession.agentSessionId,
  content: 'I could not safely apply the request. Retry or keep the current result.',
  error: 'No ready automated Connection is available for the Agent-created Operation.',
  externalThreadId: 'thread_atomic_operation_application_failure',
  kind: 'operation_application' as const,
  runtimeModel: 'test-recovery-model',
  runtimeTurnId: failedRuntimeTurnId,
  sourceMessageId: recoverySource.agentMessageId,
  suggestions: ['Retry this change', 'Keep the current result'],
};
const recordedRecovery = await productCommands.agentWorkspace.recordRuntimeRecovery(recoveryInput);
assert.equal(recordedRecovery.committed, true);
const recordedRecoveryRetry = await productCommands.agentWorkspace.recordRuntimeRecovery(recoveryInput);
assert.equal(recordedRecoveryRetry.committed, false);
const afterRecovery = await commandStorage.loadBoard({
  boardId: commandSnapshot.board.boardId,
  projectId: commandSnapshot.project.projectId,
});
const recoveryMessage = afterRecovery.agentMessages?.find(
  (message) => message.agentMessageId === recordedRecovery.assistantMessageId,
);
assert.deepEqual(recoveryMessage?.suggestions, recoveryInput.suggestions);
assert.equal(recoveryMessage?.recovery?.kind, 'operation_application');
assert.equal(
  afterRecovery.agentRuntimeBindings?.find(
    (binding) => binding.agentSessionId === recoverySession.agentSessionId,
  )?.status,
  'active',
  'An Operation application failure must not be misclassified as a broken Agent connection.',
);
const durableRuntimeCommands = await commandStorage.loadBoard({
  boardId: commandSnapshot.board.boardId,
  projectId: commandSnapshot.project.projectId,
});
assert.equal(
  durableRuntimeCommands.agentRuntimeEvents?.filter(
    (event) => event.runtimeEventId === runtimeEventInput.event.runtimeEventId,
  ).length,
  1,
);
assert.equal(
  durableRuntimeCommands.agentMessages?.filter(
    (message) => message.runtimeTurnId === runtimeTurnInput.runtimeTurnId,
  ).length,
  1,
);
assert.equal(
  durableRuntimeCommands.agentRuntimeBindings?.find(
    (binding) => binding.agentSessionId === runtimeSession.agentSessionId,
  )?.status,
  'failed',
);
assert.equal(
  durableRuntimeCommands.agentMessages?.filter(
    (message) => message.agentMessageId === typedAuthorizedSuggestion.assistantMessageId,
  ).length,
  1,
);
assert.equal(
  durableRuntimeCommands.agentMessages?.find(
    (message) => message.agentMessageId === typedAuthorizedSuggestion.assistantMessageId,
  )?.contextRefs.filter((ref) => ref.kind === 'operation_receipt').length,
  1,
);
unsubscribeCommandHost();
await commandHost.dispose();

const [
  controllerSource,
  runtimeControllerSource,
  agentWorkspaceCommandsSource,
  agentWorkspaceRuntimeCommandsSource,
  productCommandsSource,
  workspaceSource,
] = await Promise.all([
  readFile(new URL('../src/app/useAgentWorkspaceController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAgentRuntimeController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/whiteboard/application/whiteboardAgentWorkspaceCommands.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/whiteboard/application/whiteboardAgentWorkspaceRuntimeCommands.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/whiteboard/application/whiteboardProductCommands.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
]);
assert.match(
  controllerSource,
  /commands\.agentWorkspace\.launchDraft\(\{ command \}\)/,
  'Draft launch must cross the typed Whiteboard product-command boundary.',
);
assert.match(controllerSource, /await loadBoardSnapshot/);
assert.match(controllerSource, /reconcileAgentArtifactTarget/);
assert.match(controllerSource, /reconcileWorkflowArtifactGates/);
assert.doesNotMatch(
  controllerSource,
  /\b(?:appendAgentRuntimeEvent|appendAgentUserMessage|applyAgentRuntimeTurn|applyAuthorizedOperationSuggestion|applyWorkflowLaunchPreferences|createTypedEntrypointProposalForMessage|decideChangeProposal|markAgentRuntimeFailure|stageAgentOperationExecution|stagePackageEntrypointAgentLaunch|stageGoalPlanAgentLaunch)\b/,
);
assert.match(controllerSource, /commands\.agentWorkspace\.appendMessage/);
assert.match(controllerSource, /commands\.agentWorkspace\.createEntrypointProposal/);
assert.match(controllerSource, /commands\.agentWorkspace\.decideProposal/);
assert.match(controllerSource, /commands\.agentWorkspace\.appendRuntimeEvent/);
assert.match(controllerSource, /commands\.agentWorkspace\.applyRuntimeTurn/);
assert.match(controllerSource, /commands\.agentWorkspace\.recordRuntimeRecovery/);
assert.match(controllerSource, /commands\.agentWorkspace\.authorizeOperationSuggestion/);
assert.doesNotMatch(controllerSource, /commands\.agentWorkspace\.stageOperationExecution/);
assert.match(agentWorkspaceCommandsSource, /appendAgentUserMessage/);
assert.match(agentWorkspaceCommandsSource, /createTypedEntrypointProposalForMessage/);
assert.match(agentWorkspaceCommandsSource, /decideChangeProposal/);
assert.match(agentWorkspaceCommandsSource, /stagePackageEntrypointAgentLaunch/);
assert.match(agentWorkspaceCommandsSource, /stageGoalPlanAgentLaunch/);
assert.match(agentWorkspaceCommandsSource, /executeConditionalProductTransaction/);
assert.match(agentWorkspaceRuntimeCommandsSource, /appendAgentRuntimeEvent/);
assert.match(agentWorkspaceRuntimeCommandsSource, /applyAgentRuntimeTurn/);
assert.match(agentWorkspaceRuntimeCommandsSource, /appendAgentRuntimeRecovery/);
assert.match(agentWorkspaceRuntimeCommandsSource, /applyAuthorizedOperationSuggestion/);
assert.match(agentWorkspaceRuntimeCommandsSource, /stageAgentOperationExecution/);
assert.match(runtimeControllerSource, /commands\.agent\.settleExecution\(/);
assert.match(productCommandsSource, /markAgentRunNeedsAttention\(/);
assert.match(workspaceSource, /agentWorkspace\.launchAgent/);
assert.match(workspaceSource, /WorkflowAgentTargetPicker/);
assert.match(workspaceSource, /agentWorkspace\.viewRun/);

console.log(JSON.stringify({
  ok: true,
  appliedProposalDoesNotLaunch: true,
  skillCapabilityLaunch: true,
  waitingInputWithoutExecution: true,
  idleRunSupersededByExplicitLaunch: true,
  activeRunProtectedFromReplacement: true,
  executedSkillRejected: true,
  workflowFullAndTypedSlices: true,
  sessionBinding: true,
  idempotentRetry: true,
  typedMessageDurableBeforeRuntime: true,
  typedRuntimeCommandsIdempotentRetriesDoNotPublish: true,
  typedAuthorizedSuggestionAndOperationStagingDoNotRepublish: true,
  typedProposalIdempotentRetryDoesNotPublish: true,
  typedDecisionIdempotentRetryDoesNotPublish: true,
  typedLaunchIdempotentRetryDoesNotPublish: true,
  provenance: true,
  typedLaunchPersistsBeforeUiFocus: true,
  authoritativeSliceTargetReconcile: true,
  launchUi: true,
  providerStartFailureBounded: true,
}));

async function appliedProposal(input: {
  content: string;
  entrypointId: string;
  interactionMode?: 'automatic' | 'manual';
}): Promise<{
  proposal: ChangeProposalRecord;
  sessionId: string;
  snapshot: BoardSnapshot;
}> {
  const snapshot = await emptySnapshot();
  const session = createAgentSession(snapshot, { model: 'test-model' }).session;
  return appliedProposalOnSnapshot(snapshot, session.agentSessionId, input);
}

function appliedProposalOnSnapshot(
  snapshot: BoardSnapshot,
  sessionId: string,
  input: {
    content: string;
    entrypointId: string;
    interactionMode?: 'automatic' | 'manual';
  },
): {
  proposal: ChangeProposalRecord;
  sessionId: string;
  snapshot: BoardSnapshot;
} {
  const message = appendAgentUserMessage(snapshot, sessionId, {
    content: input.content,
    contextRefs: [{ entrypointId: input.entrypointId, kind: 'entrypoint' }],
  });
  const turn = applyAgentRuntimeTurn(snapshot, {
    agentSessionId: sessionId,
    decision: { kind: 'reply', message: 'Create a Draft.' },
    externalThreadId: 'thread_agent_launch',
    runtimeModel: 'test-model',
    runtimeTurnId: `turn_${input.entrypointId}`,
    sourceMessageId: message.agentMessageId,
  });
  assert.ok(turn.proposal);
  if (input.interactionMode) {
    applyWorkflowLaunchPreferences(turn.proposal, {
      interactionMode: input.interactionMode,
    });
  }
  const approved = decideChangeProposal(snapshot, {
    decision: 'approve',
    expectedProposalVersion: turn.proposal.recordVersion,
    proposalId: turn.proposal.proposalId,
  });
  assert.equal(approved.proposal.status, 'applied');
  return { proposal: approved.proposal, sessionId, snapshot };
}

function launchCommand(
  proposal: ChangeProposalRecord,
  agentSessionId: string,
  target: PackageEntrypointAgentLaunchTarget,
) {
  return buildPackageEntrypointDraftLaunchCommand({
    agentSessionId,
    expectedProposalVersion: proposal.recordVersion,
    proposalId: proposal.proposalId,
    target,
  });
}

async function emptySnapshot(): Promise<BoardSnapshot> {
  const value = await resetWorkspace();
  value.blocks = [];
  value.edges = [];
  value.assets = [];
  value.executions = [];
  value.agentRuns = [];
  value.agentSessions = [];
  value.agentMessages = [];
  value.agentRuntimeBindings = [];
  value.agentRuntimeEvents = [];
  value.changeProposals = [];
  value.changeDecisions = [];
  value.workflowRuns = [];
  value.workflowStepRuns = [];
  value.historyEvents = [];
  return value;
}
