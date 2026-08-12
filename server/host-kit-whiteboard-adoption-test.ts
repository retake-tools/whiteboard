import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  main,
  app,
  boardSession,
  canvas,
  blockActions,
  operationInputs,
  groups,
  imageOperations,
  pluginDrafts,
  pluginExecutions,
  workflowDraft,
  workflowRuntime,
  agentRuntime,
  agentWorkspace,
  agentAttachments,
  agentWorkspaceCommands,
  agentWorkspaceRuntimeCommands,
  whiteboardAgentAttachmentCommands,
  whiteboardPluginCommands,
  artifactLibrary,
  executionConfiguration,
  whiteboardArtifactCommands,
  whiteboardExecutionConfigurationCommands,
  whiteboardProductCommands,
  whiteboardBlockCommands,
  whiteboardCanvasCommands,
  whiteboardOperationInputCommands,
  whiteboardBoardCommands,
  workspaceController,
] = await Promise.all([
  readFile('src/main.tsx', 'utf8'),
  readFile('src/App.tsx', 'utf8'),
  readFile('src/app/useBoardSession.ts', 'utf8'),
  readFile('src/app/useCanvasController.ts', 'utf8'),
  readFile('src/app/useBlockActions.ts', 'utf8'),
  readFile('src/app/useOperationInputController.ts', 'utf8'),
  readFile('src/app/useGroupController.ts', 'utf8'),
  readFile('src/app/useImageOperationController.ts', 'utf8'),
  readFile('src/app/usePluginDraftController.ts', 'utf8'),
  readFile('src/app/usePluginExecutionController.ts', 'utf8'),
  readFile('src/app/useWorkflowDraftController.ts', 'utf8'),
  readFile('src/app/useWorkflowRuntimeController.ts', 'utf8'),
  readFile('src/app/useAgentRuntimeController.ts', 'utf8'),
  readFile('src/app/useAgentWorkspaceController.ts', 'utf8'),
  readFile('src/app/useAgentAttachmentController.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardAgentWorkspaceCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardAgentWorkspaceRuntimeCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardAgentAttachmentCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardPluginCommands.ts', 'utf8'),
  readFile('src/app/useArtifactLibraryController.ts', 'utf8'),
  readFile('src/app/useExecutionConfigurationController.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardArtifactCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardExecutionConfigurationCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardProductCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardBlockCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardCanvasCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardOperationInputCommands.ts', 'utf8'),
  readFile('src/whiteboard/application/whiteboardBoardCommands.ts', 'utf8'),
  readFile('src/app/useWorkspaceController.ts', 'utf8'),
]);

assert.match(main, /createWhiteboardCanvasHost\(runtime\)/);
assert.match(main, /<CanvasHostProvider host=\{canvasHost\}>/);
assert.match(app, /useBoardSession\(t, canvasHost\)/);
assert.match(app, /runHostCommand,/);
assert.match(boardSession, /canvasHost\.readModel\.getSnapshot\(\)/);
assert.match(boardSession, /operation\(canvasHost\.commands\)/);
assert.match(boardSession, /function adoptDurableSnapshot\(/);
assert.match(boardSession, /replaceSnapshot\([\s\S]*?\{ durable: true \}/);
assert.match(
  boardSession,
  /await canvasHost\.setScope\(\{[\s\S]*?boardId: nextSnapshot\.board\.boardId,[\s\S]*?projectId: nextSnapshot\.project\.projectId/,
  'Workspace Board switching must use the public Host scope transition.',
);
assert.match(
  boardSession,
  /options\.history && options\.shouldKeepHistory\?\.\(result\) === false/,
  'Conditional product-command no-ops must remove their speculative Undo entry.',
);
assert.match(executionConfiguration, /shouldKeepHistory: \(outcome\) => outcome\.committed/);
assert.match(canvas, /commands\.connectBlocks\(/);
assert.match(canvas, /commands\.removeConnections\(/);
assert.match(canvas, /commands\.moveBlocks\(/);
assert.match(blockActions, /commands\.createBlock\(/);
assert.match(blockActions, /commands\.removeBlocks\(/);
assert.match(blockActions, /commands\.createGroup\(/);
assert.match(operationInputs, /commands\.removeConnections\(/);
for (const command of ['addBlock', 'bindImageReference', 'updateDomainVideoParameters', 'updateSkill']) {
  assert.match(operationInputs, new RegExp(`commands\\.operationInput\\.${command}\\(`));
}
for (const command of ['dissolveGroup', 'fitGroup', 'layoutGroup', 'resizeGroup', 'updateGroup']) {
  assert.match(groups, new RegExp(`commands\\.${command}\\(`));
}
assert.match(imageOperations, /commands\.attachAsset\(/);
assert.match(imageOperations, /commands\.cancelExecution\(/);
for (const command of [
  'completeLocalImageExecution',
  'failLocalImageExecution',
  'startLocalImageExecution',
]) {
  assert.match(pluginExecutions, new RegExp(`commands\\.${command}\\(`));
}
assert.doesNotMatch(
  pluginExecutions,
  /\b(?:addPluginImageOperation|completePluginImageOperation|failPluginImageOperation)\b/,
  'The Whiteboard Plugin controller must not retain direct Snapshot writeback helpers.',
);
assert.match(pluginDrafts, /commands\.plugin\.saveDraft\(request\)/);
assert.doesNotMatch(
  pluginDrafts,
  /\b(?:persistSnapshot|updateSnapshot)\b/,
  'Plugin draft runner must persist through the typed Whiteboard product command.',
);
assert.match(whiteboardPluginCommands, /executeConditionalProductTransaction\(/);
assert.match(whiteboardPluginCommands, /data\.annotationDraft/);
assert.match(whiteboardProductCommands, /plugin: createWhiteboardPluginCommands\(transactions\)/);
assert.match(artifactLibrary, /commands\.artifact\.insertReference\(/);
assert.doesNotMatch(
  artifactLibrary,
  /\b(?:insertArtifactReference|persistSnapshot|updateSnapshot)\b/,
  'Artifact reference insertion must use the typed Whiteboard product command.',
);
assert.match(executionConfiguration, /commands\.executionConfiguration\.restore\(/);
assert.doesNotMatch(
  executionConfiguration,
  /\b(?:persistSnapshot|restoreExecutionConfiguration|updateSnapshot)\b/,
  'Execution configuration restore must use the typed Whiteboard product command.',
);
assert.match(whiteboardArtifactCommands, /executeProductTransaction\(/);
assert.match(whiteboardArtifactCommands, /insertArtifactReference\(/);
assert.match(whiteboardExecutionConfigurationCommands, /executeConditionalProductTransaction\(/);
assert.match(whiteboardExecutionConfigurationCommands, /changed: result\.restored/);
assert.match(whiteboardProductCommands, /artifact: createWhiteboardArtifactCommands\(transactions\)/);
assert.match(whiteboardProductCommands, /imageOperation: createWhiteboardImageOperationCommands\(transactions\)/);
assert.match(whiteboardProductCommands, /block: createWhiteboardBlockCommands\(transactions\)/);
assert.match(whiteboardProductCommands, /board: createWhiteboardBoardCommands\(transactions\)/);
assert.match(whiteboardProductCommands, /canvas: createWhiteboardCanvasCommands\(transactions\)/);
assert.match(whiteboardProductCommands, /operationInput: createWhiteboardOperationInputCommands\(transactions\)/);
assert.match(
  whiteboardProductCommands,
  /executionConfiguration: createWhiteboardExecutionConfigurationCommands\(transactions\)/,
);
for (const command of ['createRun', 'acceptOutput', 'decideGate']) {
  assert.match(workflowRuntime, new RegExp(`commands\\.workflow\\.${command}\\(`));
}
for (const command of ['projectDraft', 'projectRevision']) {
  assert.match(workflowDraft, new RegExp(`commands\\.workflow\\.${command}\\(`));
}
assert.doesNotMatch(
  workflowDraft,
  /\b(?:updateSnapshot|persistSnapshot|projectWorkflowDraft|upsertProjectWorkflowDefinition)\b/,
  'Workflow Draft projection must use typed Whiteboard product commands.',
);
assert.doesNotMatch(
  workflowRuntime,
  /\b(?:updateSnapshot|persistSnapshot|createWorkflowRunForGroup|acceptWorkflowStepOutputs|decideWorkflowApproval)\b/,
  'The Workflow Runtime controller must use typed Whiteboard product commands for durable mutations.',
);
assert.match(whiteboardProductCommands, /executeProductTransaction\(/);
for (const command of [
  'createWorkflowRun',
  'createWorkflowSlice',
  'createWorkflowArtifactSlice',
  'createWorkflowStageSlice',
  'createWorkflowGateSlice',
  'control',
  'reconcileRuntime',
  'settleExecution',
]) {
  assert.match(agentRuntime, new RegExp(`commands\\.agent\\.${command}\\(`));
}
assert.doesNotMatch(
  agentRuntime,
  /\b(?:persistSnapshot|updateSnapshot|createAgentRunForWorkflowArtifactSlice|createAgentRunForWorkflowGateSlice|createAgentRunForWorkflowRun|createAgentRunForWorkflowSlice|createAgentRunForWorkflowStageSlice|retryAgentRunAfterMissingExecution|startAgentRun)\b/,
  'Explicit Agent Run creation and controls must use typed Whiteboard product commands.',
);
for (const command of [
  'appendMessage',
  'appendRuntimeEvent',
  'authorizeOperationSuggestion',
  'applyRuntimeTurn',
  'archiveSession',
  'bindRun',
  'bindWorkingOperation',
  'createSession',
  'createEntrypointProposal',
  'decideProposal',
  'ensureDefaultSession',
  'launchDraft',
  'recordRuntimeRecovery',
  'renameSession',
]) {
  assert.match(agentWorkspace, new RegExp(`commands\\.agentWorkspace\\.${command}\\(`));
}
assert.doesNotMatch(
  agentWorkspace,
  /\b(?:appendAgentRuntimeEvent|appendAgentUserMessage|applyAgentRuntimeTurn|applyAuthorizedOperationSuggestion|applyWorkflowLaunchPreferences|archiveAgentSession|createAgentSession|createTypedEntrypointProposalForMessage|decideChangeProposal|ensureDefaultAgentSession|layoutImageComposerWorkflow|markAgentRuntimeFailure|persistSnapshot|renameAgentSession|setAgentSessionRun|setAgentSessionWorkingOperation|stageAgentOperationExecution|stageGoalPlanAgentLaunch|stagePackageEntrypointAgentLaunch|updateSnapshot)\b/,
  'Agent Workspace Message, Runtime result, Proposal, Session lifecycle, and Draft launch must use typed Whiteboard product commands.',
);
assert.match(agentWorkspaceCommands, /executeConditionalProductTransaction\(/);
assert.match(agentWorkspaceRuntimeCommands, /executeConditionalProductTransaction\(/);
assert.match(agentAttachments, /commands\.agentAttachment\.attach\(/);
assert.doesNotMatch(
  agentAttachments,
  /\b(?:createAssetFromDataUrl|createBlockRecord|layoutAttachmentBlocks|moveBlockGroupToNearestFreeArea|persistSnapshot|snapshotRef|updateSnapshot)\b/,
  'Agent attachment controller must delegate bytes and Board facts to the typed product command.',
);
assert.match(whiteboardAgentAttachmentCommands, /persistProductAsset\(/);
assert.match(whiteboardAgentAttachmentCommands, /executeProductTransaction\(/);
assert.match(whiteboardAgentAttachmentCommands, /layoutAttachmentBlocks\(blocks, input\.placementCenter\)/);
assert.match(
  whiteboardProductCommands,
  /agentAttachment: createWhiteboardAgentAttachmentCommands\(transactions\)/,
);
assert.doesNotMatch(
  `${main}\n${app}\n${canvas}\n${workflowRuntime}\n${agentRuntime}`,
  /host-kit\/internal\/whiteboardCompatibility/,
  'Only application services may import the internal compatibility bridge.',
);
assert.doesNotMatch(
  `${app}\n${blockActions}\n${canvas}\n${groups}\n${operationInputs}\n${workspaceController}`,
  /\bupdateSnapshot\b/,
  'Feature controllers must not retain the mutable Snapshot compatibility entrypoint.',
);
assert.doesNotMatch(
  `${blockActions}\n${canvas}\n${groups}\n${operationInputs}\n${workspaceController}`,
  /\bpersistSnapshot\b/,
  'Feature controllers must not persist Board mutations outside Host transactions.',
);
for (const commandModule of [
  whiteboardBlockCommands,
  whiteboardCanvasCommands,
  whiteboardOperationInputCommands,
  whiteboardBoardCommands,
]) {
  assert.match(commandModule, /executeConditionalProductTransaction(?:<|\()/);
}

console.log({
  canvasConnectionsUseCommands: true,
  canvasSimpleMovesUseCommands: true,
  canvasSimpleRemovalsUseCommands: true,
  canvasStandardBlockCreationUsesCommands: true,
  hostProviderShared: true,
  groupEditingUsesCommands: true,
  imageImportUsesAssetCommand: true,
  queuedImageRefreshUsesExecutionCommand: true,
  operationInputRemovalUsesCommands: true,
  pluginExecutionWritebackUsesCommands: true,
  pluginDraftWritebackUsesProductCommands: true,
  artifactReferenceInsertionUsesProductCommands: true,
  executionConfigurationRestoreUsesProductCommands: true,
  productCommandNoopDoesNotAddUndoHistory: true,
  whiteboardAdoption: 'passed',
  agentRunActionsUseProductCommands: true,
  agentWorkspaceSessionUsesProductCommands: true,
  agentWorkspaceMessageAndProposalUseProductCommands: true,
  agentWorkspaceRuntimeResultUsesProductCommands: true,
  agentWorkspaceSuggestionAndOperationStagingUseProductCommands: true,
  agentWorkspaceProposalDecisionUsesProductCommands: true,
  agentWorkspaceLaunchUsesProductCommands: true,
  agentAttachmentUsesProductCommands: true,
  workflowRuntimeUsesProductCommands: true,
  workflowProjectionUsesProductCommands: true,
  remainingFeatureMutationsUseProductCommands: true,
  workspaceRenameAdoptsServerSnapshot: true,
  writeBridgeContainedToApplicationServices: true,
});
