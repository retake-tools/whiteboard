import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  createAgentSession,
} from '../src/core/agentSession';
import { buildGoalPlanInstantiationCommand } from '../src/core/goalPlanRegistry';
import {
  listGoalComposerMentionOptions,
  type PackageComposerMention,
} from '../src/core/packageComposer';
import type { BlockRecord, BoardSnapshot } from '../src/core/types';
import { resetWorkspace } from './local-store/snapshot-store';

const [appSource, providerSource, canvasComposerSource, agentComposerSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/UnifiedComposerProvider.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspaceComposer.tsx', import.meta.url), 'utf8'),
]);

assert.match(appSource, /<UnifiedComposerProvider key=/);
assert.match(providerSource, /createContext<UnifiedComposerDraftController/);
assert.match(providerSource, /useUnifiedComposerDraft/);
assert.match(canvasComposerSource, /useUnifiedComposerDraft\(\)/);
assert.match(agentComposerSource, /useUnifiedComposerDraft\(\)/);
assert.match(canvasComposerSource, /onSubmitAgentMessage/);
assert.match(canvasComposerSource, /listGoalComposerMentionOptions/);
assert.match(agentComposerSource, /listGoalComposerMentionOptions/);
assert.match(agentComposerSource, /setPicker\(\{ mode: 'mention', query: mentionTrigger \}\)/);

const snapshot = await emptySnapshot();
const brief = textBlock(
  snapshot,
  'block_unified_composer_brief',
  '创意 Brief',
  '一只快递猫要在日出前把最后一卷胶片送到影院。',
);
snapshot.blocks.push(brief);

const options = listGoalComposerMentionOptions(snapshot);
const uniqueOptionIds = new Set(options.map((option) => option.mentionId));
assert.equal(uniqueOptionIds.size, options.length);
const briefOption = options.find((option) =>
  option.kind === 'block'
  && option.blockId === brief.blockId
  && option.slotId === 'brief');
assert.ok(briefOption?.kind === 'block');

const session = createAgentSession(snapshot, { model: 'test-model' }).session;
const mention: PackageComposerMention = {
  blockId: briefOption.blockId,
  kind: 'block',
  slotId: briefOption.slotId,
};
const message = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '把这个故事推进到可审阅的故事板计划。',
  contextRefs: [mention],
});
const context = agentRuntimeTurnContext(snapshot, session.agentSessionId, message.agentMessageId);
assert.equal(context.entrypointId, undefined);
assert.deepEqual(context.mentions, [mention]);
assert.ok(context.goalPlanOptions.some((option) =>
  option.entrypointId === 'workflow:retake.workflow.story-to-storyboard'));

const command = buildGoalPlanInstantiationCommand(snapshot, message, {
  coverage: 'full',
  limitations: [],
  proposalId: 'proposal_unified_composer',
  workflowEntryPointId: 'workflow:retake.workflow.story-to-storyboard',
});
assert.equal(command.draftCommand.invocation.mentionLocks[0]?.kind, 'block');
assert.equal(command.draftCommand.invocation.mentionLocks[0]?.slotId, 'brief');

console.log(JSON.stringify({
  ok: true,
  sharedDraftProvider: true,
  canvasGoalSubmission: true,
  goalMentionPicker: true,
  entrypointIndependentTypedMention: true,
  goalDraftPreservesMention: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  return snapshot;
}

function textBlock(
  snapshot: BoardSnapshot,
  blockId: string,
  title: string,
  body: string,
): BlockRecord {
  return {
    blockId,
    boardId: snapshot.board.boardId,
    type: 'text',
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { width: 260, height: 170 },
    zIndex: 1,
    data: { body, title },
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
}
