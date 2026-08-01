import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activeBoardAgentSessions,
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  ensureDefaultAgentSession,
  messagesForSession,
  proposalsForSession,
  runtimeEventsForSession,
  runtimeBindingForSession,
  setAgentSessionRun,
  setAgentSessionWorkingOperation,
} from '../src/core/agentSession';
import { appendAgentRuntimeEvent, decideChangeProposal } from '../src/core/agentChangeApplication';
import { cancelAgentRun, createAgentRunForOperation, startAgentRun } from '../src/core/agentRuntime';
import { stageAgentOperationExecution } from '../src/core/agentOperationExecution';
import { createBlockRecord } from '../src/core/blockFactory';
import { createDraftTextToImageOperation } from '../src/core/imageOperations';
import { createDraftSkillOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { agentRuntimeDecisionSchema, parseAgentRuntimeDecision } from './agent-runtime-port';
import './studio-domain-test-fixtures';

const [
  portSource,
  workspaceSource,
  composerSource,
  sharedComposerSource,
  controllerSource,
  appServerSource,
  apiSource,
  runtimeClientSource,
  canvasControllerSource,
  operationCardSource,
  agentWorkspaceCssSource,
  appEventBindingsSource,
  operationControlsSource,
  textBlockEditorSource,
  blockNodeSource,
] = await Promise.all([
  readFile(new URL('./agent-runtime-port.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspaceComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAgentWorkspaceController.ts', import.meta.url), 'utf8'),
  readFile(new URL('./codex-app-server-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('./vite-local-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/core/agentRuntimeClient.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useCanvasController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentOperationRunCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/agent-workspace.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAppEventBindings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/OperationInlineControls.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/TextBlockEditorDialog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/BlockNode.tsx', import.meta.url), 'utf8'),
]);

assert.match(portSource, /implements AgentRuntimePort/);
assert.match(portSource, /outputSchema: agentRuntimeDecisionSchema/);
assert.match(portSource, /publishedDecisionDelta/);
assert.match(portSource, /sandbox: 'read-only'/);
assert.match(portSource, /Do not call tools/);
assert.match(portSource, /new cumulative edit/);
assert.match(portSource, /must use operation_create_execute instead/);
assert.match(portSource, /an omitted ratio preserves the exact source image ratio/);
assert.doesNotMatch(portSource, /saveSnapshot|createBlock|projectWorkflowDraft/);
assert.match(appServerSource, /thread\/resume/);
assert.doesNotMatch(appServerSource, /excludeTurns/);
assert.doesNotMatch(appServerSource, /dynamicTools:/);
assert.doesNotMatch(workspaceSource, /\['chat', 'run', 'changes'\]/);
assert.doesNotMatch(workspaceSource, /agentWorkspace\.createSession/);
assert.match(workspaceSource, /AgentSessionHistoryMenu/);
assert.match(workspaceSource, /AgentRunSummaryCard/);
assert.match(workspaceSource, /AgentOperationRunCard/);
assert.match(workspaceSource, /agentWorkspace\.quickStartPoster/);
assert.match(workspaceSource, /message\.suggestions\?\.length/);
assert.match(workspaceSource, /retake:focus-unified-composer/);
assert.match(operationCardSource, /latestExecutionForOperation/);
assert.match(operationCardSource, /currentExecutionProviderSettings/);
assert.doesNotMatch(operationCardSource, /agentWorkspace\.scope/);
assert.doesNotMatch(operationCardSource, /operationToolbar\.capability/);
assert.match(operationCardSource, /onClick=\{operation \? \(\) => onLocateBlock/);
assert.doesNotMatch(operationCardSource, /role=\{operation \? 'button'/);
for (const status of ['queued', 'running', 'succeeded', 'failed', 'canceled']) {
  assert.match(agentWorkspaceCssSource, new RegExp(`agent-workspace-operation-card\\.is-${status}`));
}
assert.match(agentWorkspaceCssSource, /border-left-color: var\(--operation-status-color\)/);
assert.match(composerSource, /<SkillQuickInputComposer/);
assert.match(composerSource, /mode="agent"/);
assert.match(sharedComposerSource, /skill-composer-attachment-trigger/);
assert.match(sharedComposerSource, /insideSelector: '\.skill-composer-picker/);
assert.match(sharedComposerSource, /AgentComposerPreferencesControls/);
assert.match(controllerSource, /kind: 'agent_preferences'/);
assert.match(portSource, /attachedImageBlockIds/);
assert.match(portSource, /localImagePaths/);
assert.match(workspaceSource, /agent-workspace-quick-starts/);
assert.match(blockNodeSource, /operation-compact-node/);
assert.doesNotMatch(composerSource, /onInvokeEntryPoint/);
assert.match(sharedComposerSource, /listPackageEntryPoints/);
assert.match(sharedComposerSource, /listPackageComposerMentionOptions/);
assert.match(controllerSource, /persistSnapshot\(withUserMessage, \{ requireLocalApi: true \}\)/);
assert.match(controllerSource, /applyAgentRuntimeTurn/);
assert.match(controllerSource, /stageAgentOperationExecution/);
assert.match(controllerSource, /layoutImageComposerWorkflow\(staged\.stagedSnapshot/);
assert.match(controllerSource, /bindingSource === 'message_attachment'/);
assert.doesNotMatch(controllerSource, /focusWorkflowBlocks\(operationScopeIds\)/);
assert.match(controllerSource, /retake:run-operation/);
assert.match(controllerSource, /revealOnStart: true/);
assert.match(
  canvasControllerSource,
  /event\.target instanceof HTMLElement && isInteractiveNodeTarget\(event\.target\)/,
);
assert.match(controllerSource, /ensureDefaultAgentSession/);
assert.match(controllerSource, /const agentSessionId = selectedSessionId \?\? ensureDefaultSession\(\)/);
assert.match(controllerSource, /setAgentSessionWorkingOperation/);
assert.match(appEventBindingsSource, /retake:bind-agent-operation/);
assert.match(blockNodeSource, /dispatchBindAgentOperation/);
assert.match(blockNodeSource, /retake:use-image-in-agent/);
assert.match(controllerSource, /canvasImageSelectionRefs/);
assert.match(textBlockEditorSource, /retake:update-text-block/);
assert.match(textBlockEditorSource, /isDirty/);
assert.match(blockNodeSource, /text-body-input nodrag nopan nowheel/);
assert.match(blockNodeSource, /retake:open-text-block-editor/);
assert.match(apiSource, /application\/x-ndjson/);
assert.match(runtimeClientSource, /response\.body\.getReader/);
assert.equal(agentRuntimeDecisionSchema.type, 'object');
assert.deepEqual(
  new Set(agentRuntimeDecisionSchema.required),
  new Set(Object.keys(agentRuntimeDecisionSchema.properties)),
);
assertSchemaDiscriminatorsDeclareStringType(agentRuntimeDecisionSchema);

const parserContext = {
  agentRun: {
    agentRunId: 'agent_run_parser',
    allowedActions: ['pause' as const, 'cancel' as const],
    status: 'running',
    targetKind: 'workflow_run',
  },
  availableAgentRuns: [
    { agentRunId: 'agent_run_parser', status: 'running', targetKind: 'workflow_run' },
    { agentRunId: 'agent_run_other', status: 'paused', targetKind: 'operation' },
  ],
  boardId: 'board_parser',
  history: [],
  mentions: [],
  projectId: 'project_parser',
  userMessage: 'pause',
};
assert.deepEqual(parseAgentRuntimeDecision('{"kind":"reply","message":"No state change."}', parserContext), {
  kind: 'reply',
  message: 'No state change.',
});
assert.throws(
  () => parseAgentRuntimeDecision('{"kind":"agent_run_control","message":"pause","action":"pause","agentRunId":"agent_run_foreign"}', parserContext),
  /outside the authorized scope/,
);
assert.deepEqual(parseAgentRuntimeDecision(JSON.stringify({
  kind: 'change_proposal',
  message: '需要批准后切换。',
  proposalKind: 'out_of_scope',
  proposedCommand: { kind: 'agent_session.attach_run', targetAgentRunId: 'agent_run_other' },
  summary: '切换到另一个同画板 Agent Run。',
}), parserContext), {
  kind: 'change_proposal',
  message: '需要批准后切换。',
  proposalKind: 'out_of_scope',
  proposedCommand: { kind: 'agent_session.attach_run', targetAgentRunId: 'agent_run_other' },
  summary: '切换到另一个同画板 Agent Run。',
});
assert.throws(
  () => parseAgentRuntimeDecision('{"kind":"agent_run_control","message":"resume","action":"resume","agentRunId":"agent_run_parser"}', parserContext),
  /outside the authorized scope/,
);

const operationSnapshot = await emptySnapshot();
const legacyOperationDraft = createDraftTextToImageOperation(operationSnapshot, {
  operationTitle: 'Generate image',
  textBlockBody: 'Old prompt.',
  textBlockTitle: 'Prompt',
});
const operationSession = createAgentSession(
  operationSnapshot,
  { model: 'test-model' },
).session;
const operationMessage = appendAgentUserMessage(
  operationSnapshot,
  operationSession.agentSessionId,
  { content: '生成一张主打落地灯的温馨家居海报，需要中文文字。' },
);
const operationContext = agentRuntimeTurnContext(
  operationSnapshot,
  operationSession.agentSessionId,
  operationMessage.agentMessageId,
);
const operationDecision = parseAgentRuntimeDecision(JSON.stringify({
  aspectRatioPreset: '9:16',
  capabilityId: 'image.generate',
  kind: 'operation_create_execute',
  message: '正在为这个新任务创建文生图 Operation。',
  operationPrompt: '温馨现代客厅，落地灯为主体，海报文字：让一盏灯，点亮家的温度。',
  sourceImageBlockId: null,
  targetResolution: '2K',
  variationCount: 2,
}), operationContext);
const operationTurn = applyAgentRuntimeTurn(operationSnapshot, {
  agentSessionId: operationSession.agentSessionId,
  decision: operationDecision,
  externalThreadId: 'thread_operation_execute',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_operation_execute',
  sourceMessageId: operationMessage.agentMessageId,
});
assert.equal(operationTurn.operationExecution?.kind, 'create_execute');
const createdApplication = stageAgentOperationExecution(
  operationSnapshot,
  operationTurn.operationExecution!,
  {
    connectionIdForCapability: () => 'codex-app-server',
    operationTitle: 'Generate image',
    promptTitle: 'Prompt',
  },
);
assert.equal(
  legacyOperationDraft.textBlock.data.body,
  'Old prompt.',
  'A new Agent task must not overwrite the old Operation prompt',
);
const createdOperation = createdApplication.stagedSnapshot.blocks.find(
  (block) => block.blockId === createdApplication.receipt.operationBlockId,
);
const createdPrompt = createdApplication.stagedSnapshot.blocks.find(
  (block) => block.blockId === createdApplication.receipt.promptBlockId,
);
assert.equal(createdApplication.receipt.action, 'created');
assert.notEqual(createdOperation?.blockId, legacyOperationDraft.operationBlock.blockId);
assert.equal(
  createdPrompt?.data.body,
  '温馨现代客厅，落地灯为主体，海报文字：让一盏灯，点亮家的温度。',
);
assert.equal(
  createdApplication.stagedSnapshot.agentSessions?.find(
    (candidate) => candidate.agentSessionId === operationSession.agentSessionId,
  )?.workingOperation?.operationBlockId,
  createdApplication.receipt.operationBlockId,
);
assert.deepEqual(
  createdApplication.stagedSnapshot.agentMessages?.find(
    (message) => message.agentMessageId === operationTurn.assistantMessage.agentMessageId,
  )?.contextRefs.find((ref) => ref.kind === 'operation_receipt'),
  {
    action: 'created',
    kind: 'operation_receipt',
    operationBlockId: createdApplication.receipt.operationBlockId,
  },
);

const continuationMessage = appendAgentUserMessage(
  createdApplication.stagedSnapshot,
  operationSession.agentSessionId,
  { content: '沿用刚才的任务，再来一版更克制的构图。' },
);
const continuationContext = agentRuntimeTurnContext(
  createdApplication.stagedSnapshot,
  operationSession.agentSessionId,
  continuationMessage.agentMessageId,
);
assert.equal(
  continuationContext.workingOperation?.operationBlockId,
  createdApplication.receipt.operationBlockId,
);
assert.ok(
  continuationContext.boardReadModel.operations.some(
    (operation) => operation.operationBlockId === createdApplication.receipt.operationBlockId,
  ),
  'The working Operation must remain in the bounded Board read-model details',
);
const continuationDecision = parseAgentRuntimeDecision(JSON.stringify({
  kind: 'operation_execute',
  message: '继续当前会话绑定的文生图 Operation。',
  operationBlockId: createdApplication.receipt.operationBlockId,
  operationPrompt: '温馨现代客厅，落地灯为主体，使用更克制的留白构图。',
}), continuationContext);
assert.equal(
  continuationDecision.kind === 'operation_execute'
    ? continuationDecision.bindingSource
    : undefined,
  'session_working',
);
const continuationTurn = applyAgentRuntimeTurn(createdApplication.stagedSnapshot, {
  agentSessionId: operationSession.agentSessionId,
  decision: continuationDecision,
  externalThreadId: 'thread_operation_execute',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_operation_continue',
  sourceMessageId: continuationMessage.agentMessageId,
});
const continuedApplication = stageAgentOperationExecution(
  createdApplication.stagedSnapshot,
  continuationTurn.operationExecution!,
  {
    connectionIdForCapability: () => 'codex-app-server',
    operationTitle: 'Generate image',
    promptTitle: 'Prompt',
  },
);
assert.equal(continuedApplication.receipt.action, 'continued');
assert.equal(continuedApplication.receipt.createdBlockIds.length, 0);
assert.equal(
  continuedApplication.stagedSnapshot.blocks.find(
    (block) => block.blockId === createdApplication.receipt.promptBlockId,
  )?.data.body,
  '温馨现代客厅，落地灯为主体，使用更克制的留白构图。',
);
assert.equal(
  continuedApplication.stagedSnapshot.agentMessages?.find(
    (message) => message.agentMessageId === continuationTurn.assistantMessage.agentMessageId,
  )?.contextRefs.find((ref) => ref.kind === 'operation_receipt')?.kind,
  'operation_receipt',
);
assert.throws(
  () => parseAgentRuntimeDecision(JSON.stringify({
    kind: 'operation_execute',
    message: '执行旧 Operation。',
    operationBlockId: legacyOperationDraft.operationBlock.blockId,
    operationPrompt: 'This must not run.',
  }), continuationContext),
  /outside the explicitly bound ready scope/,
);

const explicitLegacyMessage = appendAgentUserMessage(
  continuedApplication.stagedSnapshot,
  operationSession.agentSessionId,
  {
    content: '继续这个明确指定的旧 Operation。',
    contextRefs: [{
      kind: 'operation',
      operationBlockId: legacyOperationDraft.operationBlock.blockId,
    }],
  },
);
const explicitLegacyContext = agentRuntimeTurnContext(
  continuedApplication.stagedSnapshot,
  operationSession.agentSessionId,
  explicitLegacyMessage.agentMessageId,
);
const explicitLegacyDecision = parseAgentRuntimeDecision(JSON.stringify({
  kind: 'operation_execute',
  message: '继续明确指定的旧 Operation。',
  operationBlockId: legacyOperationDraft.operationBlock.blockId,
  operationPrompt: 'Explicitly updated old prompt.',
}), explicitLegacyContext);
assert.equal(
  explicitLegacyDecision.kind === 'operation_execute'
    ? explicitLegacyDecision.bindingSource
    : undefined,
  'message_explicit',
);
const explicitLegacyTurn = applyAgentRuntimeTurn(continuedApplication.stagedSnapshot, {
  agentSessionId: operationSession.agentSessionId,
  decision: explicitLegacyDecision,
  externalThreadId: 'thread_operation_execute',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_operation_explicit',
  sourceMessageId: explicitLegacyMessage.agentMessageId,
});
const explicitLegacyApplication = stageAgentOperationExecution(
  continuedApplication.stagedSnapshot,
  explicitLegacyTurn.operationExecution!,
  {
    connectionIdForCapability: () => 'codex-app-server',
    operationTitle: 'Generate image',
    promptTitle: 'Prompt',
  },
);
assert.equal(
  explicitLegacyApplication.stagedSnapshot.blocks.find(
    (block) => block.blockId === legacyOperationDraft.textBlock.blockId,
  )?.data.body,
  'Explicitly updated old prompt.',
);

const imageEditSnapshot = await emptySnapshot();
const selectedSourceImage = addTestImageBlock(imageEditSnapshot, 'Selected source');
const unrelatedImage = addTestImageBlock(imageEditSnapshot, 'Unrelated image');
const selectedReferenceImage = addTestImageBlock(imageEditSnapshot, 'Selected lighting reference');
const selectedSourceAsset = imageEditSnapshot.assets.find(
  (asset) => asset.assetId === selectedSourceImage.data.assetId,
);
assert.ok(selectedSourceAsset);
selectedSourceAsset.width = 1024;
selectedSourceAsset.height = 1536;
const imageEditSession = createAgentSession(
  imageEditSnapshot,
  { model: 'test-model' },
).session;
const selectedImageMessage = appendAgentUserMessage(
  imageEditSnapshot,
  imageEditSession.agentSessionId,
  {
    content: '把选中图片里的“把温暖带回家”改为“把温暖带回你家”，并参考附图的暖色灯光，其他不变。',
    contextRefs: [
      {
        imageBlockIds: [selectedSourceImage.blockId],
        kind: 'canvas_image_selection',
      },
      {
        blockId: selectedReferenceImage.blockId,
        kind: 'block',
        slotId: 'agent_reference',
      },
    ],
  },
);
const selectedImageContext = agentRuntimeTurnContext(
  imageEditSnapshot,
  imageEditSession.agentSessionId,
  selectedImageMessage.agentMessageId,
);
assert.deepEqual(selectedImageContext.selectedImageBlockIds, [selectedSourceImage.blockId]);
assert.ok(
  selectedImageContext.boardReadModel.blocks.some(
    (block) => block.blockId === selectedSourceImage.blockId,
  ),
);
assert.throws(
  () => parseAgentRuntimeDecision(JSON.stringify({
    capabilityId: 'image.generate',
    kind: 'operation_create_execute',
    message: '错误选择了未绑定图片。',
    operationPrompt: 'Do not apply.',
    sourceImageBlockId: unrelatedImage.blockId,
  }), selectedImageContext),
  /outside the typed message or Session binding/,
);
const selectedImageDecision = parseAgentRuntimeDecision(JSON.stringify({
  capabilityId: 'image.generate',
  imageInputs: [
    {
      bindingKind: 'source',
      blockId: selectedSourceImage.blockId,
      intentInstruction: '',
      intentLabel: '',
    },
    {
      bindingKind: 'reference',
      blockId: selectedReferenceImage.blockId,
      intentInstruction: '只参考暖色灯光，不复制构图或文字。',
      intentLabel: '暖色灯光',
    },
  ],
  kind: 'operation_create_execute',
  message: '正在从选中图片创建新的图片编辑 Operation。',
  operationPrompt: '仅把画面文字“把温暖带回家”改为“把温暖带回你家”，其他内容保持不变。',
  sourceImageBlockId: selectedSourceImage.blockId,
}), selectedImageContext);
assert.equal(
  selectedImageDecision.kind === 'operation_create_execute'
    ? selectedImageDecision.sourceBinding
    : undefined,
  'message_selection',
);
const selectedImageTurn = applyAgentRuntimeTurn(imageEditSnapshot, {
  agentSessionId: imageEditSession.agentSessionId,
  decision: selectedImageDecision,
  externalThreadId: 'thread_image_edit',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_image_edit_selection',
  sourceMessageId: selectedImageMessage.agentMessageId,
});
const selectedImageApplication = stageAgentOperationExecution(
  imageEditSnapshot,
  selectedImageTurn.operationExecution!,
  {
    connectionIdForCapability: () => 'codex-app-server',
    imageToImageOperationTitle: 'Quick edit',
    operationTitle: 'Generate image',
    promptTitle: 'Prompt',
  },
);
const selectedEditOperation = selectedImageApplication.stagedSnapshot.blocks.find(
  (block) => block.blockId === selectedImageApplication.receipt.operationBlockId,
);
assert.equal(selectedEditOperation?.data.capabilityId, 'image.generate');
assert.deepEqual(selectedEditOperation?.data.generationParams, {
  aspectRatioPreset: 'source',
  targetAspectRatio: 2 / 3,
  targetResolution: '2K',
  variationCount: 1,
});
assert.ok(
  selectedImageApplication.stagedSnapshot.edges.some(
    (edge) =>
      edge.kind === 'execution_input'
      && edge.inputSlotId === 'source_image'
      && edge.sourceBlockId === selectedSourceImage.blockId
      && edge.targetBlockId === selectedEditOperation?.blockId,
  ),
);
assert.ok(
  selectedImageApplication.stagedSnapshot.edges.some(
    (edge) =>
      edge.kind === 'execution_input'
      && edge.inputSlotId === 'references'
      && edge.sourceBlockId === selectedReferenceImage.blockId
      && edge.targetBlockId === selectedEditOperation?.blockId
      && edge.referenceIntent?.instruction === '只参考暖色灯光，不复制构图或文字。',
  ),
);

const workingOutputImage = addTestImageBlock(
  selectedImageApplication.stagedSnapshot,
  'Agent working output',
);
selectedImageApplication.stagedSnapshot.executions.push({
  adapter: 'codex_app_server',
  boardId: selectedImageApplication.stagedSnapshot.board.boardId,
  capabilityId: 'image.generate',
  completedAt: '2026-07-30T12:02:00.000Z',
  connectionId: 'codex-app-server',
  executionId: 'exec_agent_working_output',
  inputBlockIds: [selectedSourceImage.blockId],
  outputAssetIds: [workingOutputImage.data.assetId!],
  outputBlockIds: [workingOutputImage.blockId],
  params: { operationBlockId: selectedEditOperation?.blockId },
  projectId: selectedImageApplication.stagedSnapshot.project.projectId,
  startedAt: '2026-07-30T12:01:00.000Z',
  status: 'succeeded',
});
const workingImageMessage = appendAgentUserMessage(
  selectedImageApplication.stagedSnapshot,
  imageEditSession.agentSessionId,
  { content: '再把这张图的整体色温调暖一点。' },
);
const workingImageContext = agentRuntimeTurnContext(
  selectedImageApplication.stagedSnapshot,
  imageEditSession.agentSessionId,
  workingImageMessage.agentMessageId,
);
assert.deepEqual(
  workingImageContext.workingOutputImageBlockIds,
  [workingOutputImage.blockId],
);
const isolatedImageSession = createAgentSession(
  selectedImageApplication.stagedSnapshot,
  { model: 'test-model', title: 'Isolated image chat' },
).session;
const isolatedImageMessage = appendAgentUserMessage(
  selectedImageApplication.stagedSnapshot,
  isolatedImageSession.agentSessionId,
  { content: '修改这张图。' },
);
assert.deepEqual(
  agentRuntimeTurnContext(
    selectedImageApplication.stagedSnapshot,
    isolatedImageSession.agentSessionId,
    isolatedImageMessage.agentMessageId,
  ).workingOutputImageBlockIds,
  [],
  'Agent image context must not cross AgentSession boundaries',
);
const workingImageDecision = parseAgentRuntimeDecision(JSON.stringify({
  capabilityId: 'image.generate',
  kind: 'operation_create_execute',
  message: '正在从当前会话的图片结果创建新的编辑 Operation。',
  operationPrompt: '保持构图和文字不变，仅把整体色温调暖一点。',
  sourceImageBlockId: workingOutputImage.blockId,
}), workingImageContext);
assert.equal(
  workingImageDecision.kind === 'operation_create_execute'
    ? workingImageDecision.sourceBinding
    : undefined,
  'session_working_output',
);
const workingImageTurn = applyAgentRuntimeTurn(
  selectedImageApplication.stagedSnapshot,
  {
    agentSessionId: imageEditSession.agentSessionId,
    decision: workingImageDecision,
    externalThreadId: 'thread_image_edit',
    runtimeModel: 'test-model',
    runtimeTurnId: 'turn_image_edit_working_output',
    sourceMessageId: workingImageMessage.agentMessageId,
  },
);
const workingImageApplication = stageAgentOperationExecution(
  selectedImageApplication.stagedSnapshot,
  workingImageTurn.operationExecution!,
  {
    connectionIdForCapability: () => 'codex-app-server',
    imageToImageOperationTitle: 'Quick edit',
    operationTitle: 'Generate image',
    promptTitle: 'Prompt',
  },
);
assert.ok(
  workingImageApplication.stagedSnapshot.edges.some(
    (edge) =>
      edge.kind === 'execution_input'
      && edge.inputSlotId === 'source_image'
      && edge.sourceBlockId === workingOutputImage.blockId
      && edge.targetBlockId === workingImageApplication.receipt.operationBlockId,
  ),
);

const blockedOperationSnapshot = structuredClone(explicitLegacyApplication.stagedSnapshot);
const blockedOperation = blockedOperationSnapshot.blocks.find(
  (block) => block.blockId === legacyOperationDraft.operationBlock.blockId,
);
const blockedPrompt = blockedOperationSnapshot.blocks.find(
  (block) => block.blockId === legacyOperationDraft.textBlock.blockId,
);
assert.ok(blockedOperation);
assert.ok(blockedPrompt);
blockedOperation.data.capabilityId = 'image.generate';
blockedOperation.data.operationContractMigrationIssue = 'legacy_image_generate_input_mismatch';
const promptBeforeBlockedRequest = blockedPrompt.data.body;
setAgentSessionWorkingOperation(
  blockedOperationSnapshot,
  operationSession.agentSessionId,
  {
    operationBlockId: blockedOperation.blockId,
    source: 'user_explicit',
  },
);
const blockedMessage = appendAgentUserMessage(
  blockedOperationSnapshot,
  operationSession.agentSessionId,
  { content: '继续当前绑定的 Operation。' },
);
const blockedTurn = applyAgentRuntimeTurn(blockedOperationSnapshot, {
  agentSessionId: operationSession.agentSessionId,
  decision: {
    bindingSource: 'session_working',
    kind: 'operation_execute',
    message: '尝试继续当前绑定的 Operation。',
    operationBlockId: blockedOperation.blockId,
    operationPrompt: 'This prompt must not be committed.',
  },
  externalThreadId: 'thread_operation_execute',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_operation_blocked',
  sourceMessageId: blockedMessage.agentMessageId,
});
assert.throws(
  () => stageAgentOperationExecution(
    blockedOperationSnapshot,
    {
      ...blockedTurn.operationExecution!,
    },
    {
      connectionIdForCapability: () => 'codex-app-server',
      operationTitle: 'Generate image',
      promptTitle: 'Prompt',
    },
  ),
  /no longer ready/,
);
assert.equal(
  blockedPrompt.data.body,
  promptBeforeBlockedRequest,
  'A failed Agent execution request must not partially update the Operation prompt',
);
await saveSnapshot(explicitLegacyApplication.stagedSnapshot);
const persistedOperationSession = await loadSnapshot(
  explicitLegacyApplication.stagedSnapshot.project.projectId,
  explicitLegacyApplication.stagedSnapshot.board.boardId,
);
assert.equal(
  persistedOperationSession.agentSessions?.find(
    (candidate) => candidate.agentSessionId === operationSession.agentSessionId,
  )?.workingOperation?.operationBlockId,
  legacyOperationDraft.operationBlock.blockId,
);

const snapshot = await emptySnapshot();
const defaultSession = ensureDefaultAgentSession(snapshot, {
  model: 'test-model',
  title: 'Default conversation',
});
assert.equal(defaultSession.created, true);
assert.equal(defaultSession.session.title, 'Default conversation');
const sameDefaultSession = ensureDefaultAgentSession(snapshot, {
  model: 'other-model',
  title: 'Should not replace',
});
assert.equal(sameDefaultSession.created, false);
assert.equal(sameDefaultSession.session.agentSessionId, defaultSession.session.agentSessionId);
assert.equal(activeBoardAgentSessions(snapshot).length, 1);
snapshot.agentSessions = [];
snapshot.agentRuntimeBindings = [];
const draft = createDraftSkillOperation(snapshot, {
  bodyPlaceholder: 'Brief',
  inputTitle: 'Brief',
  operationBody: 'Generate screenplay',
  operationTitle: 'Generate screenplay',
  outputPlaceholder: 'Waiting',
  outputTitle: 'Screenplay',
  skillId: 'retake.screenplay.from-brief',
  initialText: { body: 'A courier cat reaches the cinema.', inputSlotId: 'brief' },
});
const run = createAgentRunForOperation(snapshot, draft.operationBlock.blockId);
startAgentRun(snapshot, run.record.agentRunId);
const created = createAgentSession(snapshot, { agentRunId: run.record.agentRunId, model: 'test-model' });
assert.equal(created.session.projectId, snapshot.project.projectId);
assert.equal(created.session.boardId, snapshot.board.boardId);
assert.notEqual(created.session.agentSessionId, snapshot.board.boardId);
assert.equal(created.session.activeAgentRunId, run.record.agentRunId);
assert.equal(created.binding.runtimeKind, 'codex_app_server');
assert.equal(activeBoardAgentSessions(snapshot)[0]?.agentSessionId, created.session.agentSessionId);

const userMessage = appendAgentUserMessage(snapshot, created.session.agentSessionId, {
  content: '暂停当前运行',
  contextRefs: [{ kind: 'agent_run', agentRunId: run.record.agentRunId }],
});
const context = agentRuntimeTurnContext(snapshot, created.session.agentSessionId, userMessage.agentMessageId);
assert.equal(context.agentRun?.agentRunId, run.record.agentRunId);
assert.deepEqual(context.agentRun?.allowedActions, ['pause', 'cancel']);
assert.equal(context.entrypointId, undefined);
assert.equal(context.mentions.length, 0);
assert.equal(context.boardReadModel.schemaRef, 'retake.agent-board-read-model/v1');
assert.equal(context.boardReadModel.summary.operationCounts.total, 1);
assert.equal(context.boardReadModel.operations[0]?.operationBlockId, draft.operationBlock.blockId);
const initialBoardReadFingerprint = context.boardReadModel.source.fingerprint;
const draftInputBlock = draft.inputBlocks[0]!;
draftInputBlock.data.body = 'A courier cat reaches the cinema at sunrise.';
draftInputBlock.updatedAt = '2026-07-25T01:00:00.000Z';
snapshot.board.updatedAt = '2026-07-25T01:00:00.000Z';
const refreshedContext = agentRuntimeTurnContext(
  snapshot,
  created.session.agentSessionId,
  userMessage.agentMessageId,
);
assert.notEqual(refreshedContext.boardReadModel.source.fingerprint, initialBoardReadFingerprint);
assert.equal(
  refreshedContext.boardReadModel.blocks.find((block) => block.blockId === draftInputBlock.blockId)?.text?.preview,
  draftInputBlock.data.body,
);

applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: {
    action: 'pause',
    agentRunId: run.record.agentRunId,
    kind: 'agent_run_control',
    message: '已暂停当前 Agent Run。',
  },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_001',
  sourceMessageId: userMessage.agentMessageId,
});
assert.equal(run.record.status, 'paused');
assert.equal(messagesForSession(snapshot, created.session.agentSessionId).length, 2);
assert.equal(runtimeBindingForSession(snapshot, created.session.agentSessionId)?.externalThreadId, 'thread_test_001');
cancelAgentRun(snapshot, run.record.agentRunId);
const secondDraft = createDraftSkillOperation(snapshot, {
  bodyPlaceholder: 'Brief 2',
  inputTitle: 'Brief 2',
  operationBody: 'Generate screenplay 2',
  operationTitle: 'Generate screenplay 2',
  outputPlaceholder: 'Waiting',
  outputTitle: 'Screenplay 2',
  skillId: 'retake.screenplay.from-brief',
  initialText: { body: 'A second story.', inputSlotId: 'brief' },
});
const secondRun = createAgentRunForOperation(snapshot, secondDraft.operationBlock.blockId);

const proposalRequest = appendAgentUserMessage(snapshot, created.session.agentSessionId, {
  content: '安装一个新插件并重写 Workflow 拓扑',
});
const proposalTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: {
    kind: 'change_proposal',
    message: '这个请求超出了当前 Agent Run 的权限范围。',
    proposalKind: 'install_package',
    proposedCommand: { kind: 'unsupported', reason: 'Package installation is not registered.' },
    summary: '请求安装 Package 并修改 Workflow。',
  },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_002',
  sourceMessageId: proposalRequest.agentMessageId,
});
assert.ok(proposalTurn.proposal);
assert.equal(proposalsForSession(snapshot, created.session.agentSessionId)[0]?.status, 'awaiting_decision');
assert.throws(
  () => decideChangeProposal(snapshot, {
    decision: 'approve',
    expectedProposalVersion: proposalTurn.proposal!.recordVersion,
    proposalId: proposalTurn.proposal!.proposalId,
  }),
  /no registered Application Service command/,
);
decideChangeProposal(snapshot, {
  decision: 'reject',
  expectedProposalVersion: proposalTurn.proposal!.recordVersion,
  proposalId: proposalTurn.proposal!.proposalId,
});
assert.equal(proposalTurn.proposal?.status, 'rejected');
assert.equal(snapshot.changeDecisions?.at(-1)?.decision, 'reject');

const attachRequest = appendAgentUserMessage(snapshot, created.session.agentSessionId, {
  content: '切换到另一个 Agent Run',
});
const attachTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: {
    kind: 'change_proposal',
    message: '需要先批准切换。',
    proposalKind: 'out_of_scope',
    proposedCommand: { kind: 'agent_session.attach_run', targetAgentRunId: secondRun.record.agentRunId },
    summary: '把 Session 绑定到同一 Board 的另一个 Agent Run。',
  },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_attach',
  sourceMessageId: attachRequest.agentMessageId,
});
assert.ok(attachTurn.proposal);
assert.throws(
  () => decideChangeProposal(snapshot, {
    decision: 'approve',
    expectedProposalVersion: attachTurn.proposal!.recordVersion + 1,
    proposalId: attachTurn.proposal!.proposalId,
  }),
  /version conflict/,
);
const missingTargetSnapshot = structuredClone(snapshot);
missingTargetSnapshot.agentRuns = missingTargetSnapshot.agentRuns?.filter(
  (candidate) => candidate.agentRunId !== secondRun.record.agentRunId,
);
const failedAttach = decideChangeProposal(missingTargetSnapshot, {
  decision: 'approve',
  expectedProposalVersion: attachTurn.proposal!.recordVersion,
  proposalId: attachTurn.proposal!.proposalId,
});
assert.equal(failedAttach.proposal.status, 'failed');
assert.match(failedAttach.proposal.applyError ?? '', /outside the approved Board scope/);
assert.equal(missingTargetSnapshot.changeDecisions?.at(-1)?.decision, 'approve');
const attachDecision = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: attachTurn.proposal!.recordVersion,
  proposalId: attachTurn.proposal!.proposalId,
});
assert.equal(attachDecision.proposal.status, 'applied');
assert.equal(created.session.activeAgentRunId, secondRun.record.agentRunId);

appendAgentRuntimeEvent(snapshot, {
  event: {
    agentSessionId: created.session.agentSessionId,
    kind: 'turn_started',
    occurredAt: '2026-07-23T00:00:00.000Z',
    runtimeEventId: 'agent_event_test_started',
  },
  sourceMessageId: attachRequest.agentMessageId,
});
appendAgentRuntimeEvent(snapshot, {
  event: {
    agentSessionId: created.session.agentSessionId,
    delta: '{"kind":',
    kind: 'decision_delta',
    occurredAt: '2026-07-23T00:00:01.000Z',
    runtimeEventId: 'agent_event_test_delta',
  },
  sourceMessageId: attachRequest.agentMessageId,
});
appendAgentRuntimeEvent(snapshot, {
  event: {
    agentSessionId: created.session.agentSessionId,
    delta: '{"kind":',
    kind: 'decision_delta',
    occurredAt: '2026-07-23T00:00:01.000Z',
    runtimeEventId: 'agent_event_test_delta',
  },
  sourceMessageId: attachRequest.agentMessageId,
});
assert.deepEqual(runtimeEventsForSession(snapshot, created.session.agentSessionId).map((event) => event.sequence), [1, 2]);

const secondSession = createAgentSession(snapshot, { title: 'Second session' });
assert.equal(activeBoardAgentSessions(snapshot).length, 2);
assert.throws(
  () => setAgentSessionRun(snapshot, secondSession.session.agentSessionId, 'agent_run_foreign'),
  /outside the current Board scope/,
);
assert.throws(
  () => appendAgentUserMessage(snapshot, secondSession.session.agentSessionId, {
    content: 'Use foreign block',
    contextRefs: [
      { kind: 'entrypoint', entrypointId: 'skill:retake.screenplay.from-brief' },
      { kind: 'block', blockId: 'block_foreign', slotId: 'brief' },
    ],
  }),
  /outside Session scope/,
);

await saveSnapshot(snapshot);
const stale = structuredClone(snapshot);
const replyRequest = appendAgentUserMessage(snapshot, created.session.agentSessionId, { content: '状态如何？' });
applyAgentRuntimeTurn(snapshot, {
  agentSessionId: created.session.agentSessionId,
  decision: { kind: 'reply', message: '当前 Agent Run 已暂停。' },
  externalThreadId: 'thread_test_001',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_test_003',
  sourceMessageId: replyRequest.agentMessageId,
});
await saveSnapshot(snapshot);
await saveSnapshot(stale);
const recovered = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
assert.equal(messagesForSession(recovered, created.session.agentSessionId).length, 8);
assert.equal(runtimeBindingForSession(recovered, created.session.agentSessionId)?.externalThreadId, 'thread_test_001');
assert.ok(proposalsForSession(recovered, created.session.agentSessionId).some((proposal) => proposal.status === 'rejected'));
assert.ok(proposalsForSession(recovered, created.session.agentSessionId).some((proposal) => proposal.status === 'applied'));
assert.equal(runtimeEventsForSession(recovered, created.session.agentSessionId).length, 2);
assert.equal(recovered.changeDecisions?.length, 2);

const attachmentSnapshot = await emptySnapshot();
const attachmentImage = addTestImageBlock(attachmentSnapshot, 'Attached reference');
const attachmentSession = createAgentSession(attachmentSnapshot, { model: 'test-model' }).session;
const attachmentMessage = appendAgentUserMessage(
  attachmentSnapshot,
  attachmentSession.agentSessionId,
  {
    content: '根据附件生成一个新版本',
    contextRefs: [
      {
        kind: 'agent_preferences',
        outputType: 'image',
        targetResolution: '2K',
        variationCount: 2,
      },
      {
        blockId: attachmentImage.blockId,
        kind: 'block',
        slotId: 'agent_attachment',
      },
      {
        instruction: '',
        kind: 'image_reference_setting',
        mentionId: `block:${attachmentImage.blockId}:agent_attachment`,
        mode: 'source',
      },
    ],
  },
);
const attachmentContext = agentRuntimeTurnContext(
  attachmentSnapshot,
  attachmentSession.agentSessionId,
  attachmentMessage.agentMessageId,
);
assert.deepEqual(attachmentContext.attachedImageBlockIds, [attachmentImage.blockId]);
assert.deepEqual(attachmentContext.imageReferenceSettings, [{
  blockId: attachmentImage.blockId,
  instruction: '',
  mode: 'source',
}]);
assert.equal(attachmentContext.agentPreferences?.outputType, 'image');
const attachmentDecision = parseAgentRuntimeDecision(JSON.stringify({
  kind: 'operation_create_execute',
  message: '创建一个基于附件的新版本。',
  capabilityId: 'image.generate',
  imageInputs: [{
    bindingKind: 'reference',
    blockId: attachmentImage.blockId,
    intentInstruction: '参考原图。',
    intentLabel: '参考图',
  }],
  operationPrompt: '保持构图，改为夜景。',
  suggestions: ['继续调整灯光'],
}), attachmentContext);
assert.equal(
  attachmentDecision.kind === 'operation_create_execute'
    ? attachmentDecision.sourceBinding
    : undefined,
  'message_attachment',
);
assert.equal(
  attachmentDecision.kind === 'operation_create_execute'
    ? attachmentDecision.capabilityId
    : undefined,
  'image.generate',
);
assert.equal(
  attachmentDecision.kind === 'operation_create_execute'
    ? attachmentDecision.imageInputs?.[0]?.bindingKind
    : undefined,
  'source',
);
assert.deepEqual(attachmentDecision.suggestions, ['继续调整灯光']);

const multiReferenceSnapshot = await emptySnapshot();
const compositionReference = addTestImageBlock(multiReferenceSnapshot, '左侧构图参考');
const environmentReference = addTestImageBlock(multiReferenceSnapshot, '背景参考');
const styleReference = addTestImageBlock(multiReferenceSnapshot, '风格参考');
const multiReferenceSession = createAgentSession(
  multiReferenceSnapshot,
  { model: 'test-model' },
).session;
const multiReferenceMessage = appendAgentUserMessage(
  multiReferenceSnapshot,
  multiReferenceSession.agentSessionId,
  {
    content: '生成新图：@图1放左边，背景参考@图2，风格参考@图3。',
    contextRefs: [
      { blockId: compositionReference.blockId, kind: 'block', slotId: 'agent_reference' },
      { blockId: environmentReference.blockId, kind: 'block', slotId: 'agent_reference' },
      { blockId: styleReference.blockId, kind: 'block', slotId: 'agent_reference' },
    ],
  },
);
const multiReferenceContext = agentRuntimeTurnContext(
  multiReferenceSnapshot,
  multiReferenceSession.agentSessionId,
  multiReferenceMessage.agentMessageId,
);
assert.deepEqual(
  multiReferenceContext.mentionedImageBlockIds,
  [compositionReference.blockId, environmentReference.blockId, styleReference.blockId],
);
const multiReferenceDecision = parseAgentRuntimeDecision(JSON.stringify({
  capabilityId: 'image.generate',
  imageInputs: [
    {
      bindingKind: 'reference',
      blockId: compositionReference.blockId,
      intentInstruction: '参考主体位于画面左侧的空间安排。',
      intentLabel: '左侧构图',
    },
    {
      bindingKind: 'reference',
      blockId: environmentReference.blockId,
      intentInstruction: '参考背景环境，不复制主体。',
      intentLabel: '背景环境',
    },
    {
      bindingKind: 'reference',
      blockId: styleReference.blockId,
      intentInstruction: '参考整体视觉质感，不复制构图。',
      intentLabel: '视觉质感',
    },
  ],
  kind: 'operation_create_execute',
  message: '正在按三张参考图创建新的图片任务。',
  operationPrompt: '主体使用图1的左侧构图，背景参考图2，整体风格参考图3。',
}), multiReferenceContext);
assert.deepEqual(
  multiReferenceDecision.kind === 'operation_create_execute'
    ? multiReferenceDecision.imageInputs?.map((input) => ({
        bindingKind: input.bindingKind,
        bindingSource: input.bindingSource,
        referenceIntent: input.referenceIntent,
      }))
    : undefined,
  [
    {
      bindingKind: 'reference',
      bindingSource: 'message_mention',
      referenceIntent: {
        instruction: '参考主体位于画面左侧的空间安排。',
        label: '左侧构图',
        origin: 'ai',
        schemaVersion: 1,
      },
    },
    {
      bindingKind: 'reference',
      bindingSource: 'message_mention',
      referenceIntent: {
        instruction: '参考背景环境，不复制主体。',
        label: '背景环境',
        origin: 'ai',
        schemaVersion: 1,
      },
    },
    {
      bindingKind: 'reference',
      bindingSource: 'message_mention',
      referenceIntent: {
        instruction: '参考整体视觉质感，不复制构图。',
        label: '视觉质感',
        origin: 'ai',
        schemaVersion: 1,
      },
    },
  ],
);
const multiReferenceTurn = applyAgentRuntimeTurn(multiReferenceSnapshot, {
  agentSessionId: multiReferenceSession.agentSessionId,
  decision: multiReferenceDecision,
  externalThreadId: 'thread_multi_reference',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_multi_reference',
  sourceMessageId: multiReferenceMessage.agentMessageId,
});
const multiReferenceApplication = stageAgentOperationExecution(
  multiReferenceSnapshot,
  multiReferenceTurn.operationExecution!,
  {
    connectionIdForCapability: () => 'codex-app-server',
    operationTitle: 'Generate image',
    promptTitle: 'Prompt',
  },
);
const multiReferenceInputEdges = multiReferenceApplication.stagedSnapshot.edges
  .filter(
    (edge) =>
      edge.kind === 'execution_input'
      && edge.targetBlockId === multiReferenceApplication.receipt.operationBlockId
      && [
        compositionReference.blockId,
        environmentReference.blockId,
        styleReference.blockId,
      ].includes(edge.sourceBlockId),
  )
  .map((edge) => ({
    inputSlotId: edge.inputSlotId,
    referenceIntent: edge.referenceIntent,
    sourceBlockId: edge.sourceBlockId,
  }));
assert.deepEqual(multiReferenceInputEdges, [
  {
    inputSlotId: 'references',
    referenceIntent: {
      instruction: '参考主体位于画面左侧的空间安排。',
      label: '左侧构图',
      origin: 'ai',
      schemaVersion: 1,
    },
    sourceBlockId: compositionReference.blockId,
  },
  {
    inputSlotId: 'references',
    referenceIntent: {
      instruction: '参考背景环境，不复制主体。',
      label: '背景环境',
      origin: 'ai',
      schemaVersion: 1,
    },
    sourceBlockId: environmentReference.blockId,
  },
  {
    inputSlotId: 'references',
    referenceIntent: {
      instruction: '参考整体视觉质感，不复制构图。',
      label: '视觉质感',
      origin: 'ai',
      schemaVersion: 1,
    },
    sourceBlockId: styleReference.blockId,
  },
]);

console.log(JSON.stringify({
  ok: true,
  boardScopedSessions: true,
  canonicalMessages: true,
  persistentRuntimeBinding: true,
  boundedRunControl: true,
  outOfScopeProposal: true,
  staleSaveProtected: true,
  explicitOperationExecutionContract: true,
  agentOperationIntentRoutingV1: true,
  agentImageContextBindingV1: true,
  factDrivenOperationRunCard: true,
  textBlockLargeEditorV1: true,
  currentBoardReadModelPerTurn: true,
  typedAgentAttachments: true,
  agentPreferences: true,
  dynamicSuggestions: true,
  multiImageAgentReferences: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.agentRuns = [];
  snapshot.agentSessions = [];
  snapshot.agentMessages = [];
  snapshot.agentRuntimeBindings = [];
  snapshot.agentRuntimeEvents = [];
  snapshot.changeProposals = [];
  snapshot.changeDecisions = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  return snapshot;
}

function addTestImageBlock(snapshot: BoardSnapshot, title: string) {
  const block = createBlockRecord(snapshot, 'image');
  const assetId = `asset_${block.blockId}`;
  block.data = {
    ...block.data,
    assetId,
    title,
  };
  snapshot.blocks.push(block);
  snapshot.assets.push({
    assetId,
    createdAt: block.createdAt,
    height: 1024,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: `data:image/png;base64,${block.blockId}`,
    projectId: snapshot.project.projectId,
    storageKey: `test/${block.blockId}.png`,
    storageProvider: 'local',
    width: 1024,
  });
  return block;
}

function assertSchemaDiscriminatorsDeclareStringType(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSchemaDiscriminatorsDeclareStringType);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const schema = value as Record<string, unknown>;
  if ('const' in schema || 'enum' in schema) {
    assert.ok(
      schema.type === 'string'
        || (Array.isArray(schema.type) && schema.type.includes('string')),
      'Codex structured-output const/enum schemas must declare a string type.',
    );
  }
  Object.values(schema).forEach(assertSchemaDiscriminatorsDeclareStringType);
}
