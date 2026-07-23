import assert from 'node:assert/strict';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import { builtInPackageRegistry } from '../src/core/packageRegistry';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { parseAgentRuntimeDecision } from './agent-runtime-port';
import { resetWorkspace } from './local-store/snapshot-store';

const snapshot = await emptySnapshot();
const session = createAgentSession(snapshot, { model: 'test-model' }).session;

const plainMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '生成剧本这个 Skill 是做什么的？',
});
const plainTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: { kind: 'reply', message: '它把创意 Brief 整理为剧本。' },
  externalThreadId: 'thread_typed_entrypoint',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_plain',
  sourceMessageId: plainMessage.agentMessageId,
});
assert.equal(plainTurn.proposal, undefined, 'Chat text must not infer an EntryPoint.');

const skillMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '一只快递猫要在日出前把最后一卷胶片送到影院。',
  contextRefs: [{ kind: 'entrypoint', entrypointId: 'skill:retake.screenplay.from-brief' }],
});
const skillTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: { kind: 'reply', message: '将创建“生成剧本” Skill 草稿，等待你批准。' },
  externalThreadId: 'thread_typed_entrypoint',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_skill',
  sourceMessageId: skillMessage.agentMessageId,
});
assert.ok(skillTurn.proposal);
assert.equal(skillTurn.proposal.kind, 'instantiate_entrypoint');
assert.equal(skillTurn.proposal.proposedCommand.kind, 'package_entrypoint.instantiate');
assert.ok(skillTurn.proposal.proposedCommand.kind === 'package_entrypoint.instantiate');
assert.equal(skillTurn.proposal.proposedCommand.invocation.targetLock.entrypointKind, 'skill');
assert.equal(skillTurn.proposal.proposedCommand.invocation.instructionSlotId, 'brief');
assert.equal(
  skillTurn.proposal.proposedCommand.invocation.instruction,
  '一只快递猫要在日出前把最后一卷胶片送到影院。',
);

const beforeSkill = stateCounts(snapshot);
const approvedSkill = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: skillTurn.proposal.recordVersion,
  proposalId: skillTurn.proposal.proposalId,
});
assert.equal(approvedSkill.proposal.status, 'applied');
assert.equal(approvedSkill.proposal.appliedEffect?.entrypointKind, 'skill');
assert.equal(approvedSkill.proposal.appliedEffect?.createdBlockIds.length, 2);
assert.equal(
  snapshot.blocks.filter((block) =>
    block.type === 'operation'
    && block.data.packageEntryPointId === 'skill:retake.screenplay.from-brief').length,
  1,
);
assert.deepEqual(runtimeSideEffectCounts(snapshot), {
  agentRuns: 0,
  executions: 0,
  workflowRuns: 0,
  workflowStepRuns: 0,
});
const afterSkill = stateCounts(snapshot);
decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: skillTurn.proposal.recordVersion,
  proposalId: skillTurn.proposal.proposalId,
});
assert.deepEqual(stateCounts(snapshot), afterSkill, 'Retrying an applied Proposal must not duplicate its Draft.');
assert.notDeepEqual(afterSkill, beforeSkill);

const screenplayAsset = documentAsset(snapshot, 'asset_typed_screenplay');
snapshot.assets.push(screenplayAsset);
const assetMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '',
  contextRefs: [
    { kind: 'entrypoint', entrypointId: 'skill:retake.character-bible.from-screenplay' },
    { kind: 'asset', assetId: screenplayAsset.assetId, slotId: 'screenplay' },
  ],
});
const assetTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: { kind: 'reply', message: '将从该 Document Asset 创建角色设定草稿。' },
  externalThreadId: 'thread_typed_entrypoint',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_asset',
  sourceMessageId: assetMessage.agentMessageId,
});
assert.ok(assetTurn.proposal?.proposedCommand.kind === 'package_entrypoint.instantiate');
assert.equal(assetTurn.proposal.proposedCommand.invocation.mentionLocks[0]?.kind, 'asset');
const approvedAsset = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: assetTurn.proposal.recordVersion,
  proposalId: assetTurn.proposal.proposalId,
});
assert.equal(approvedAsset.proposal.status, 'applied');
assert.equal(
  approvedAsset.proposal.appliedEffect?.createdBlockIds.some((blockId) =>
    snapshot.blocks.some((block) => block.blockId === blockId && block.data.assetId === screenplayAsset.assetId)),
  true,
);

const briefAsset = documentAsset(snapshot, 'asset_typed_brief');
const briefDocument = documentBlock(snapshot, 'block_typed_brief', briefAsset.assetId);
snapshot.assets.push(briefAsset);
snapshot.blocks.push(briefDocument);
const workflowMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '',
  contextRefs: [
    { kind: 'entrypoint', entrypointId: 'workflow:retake.workflow.story-to-storyboard' },
    { kind: 'block', blockId: briefDocument.blockId, slotId: 'brief' },
  ],
});
const workflowTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: { kind: 'reply', message: '将创建完整 Workflow Projection 草稿，等待你批准。' },
  externalThreadId: 'thread_typed_entrypoint',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_workflow',
  sourceMessageId: workflowMessage.agentMessageId,
});
assert.ok(workflowTurn.proposal?.proposedCommand.kind === 'package_entrypoint.instantiate');
assert.equal(workflowTurn.proposal.proposedCommand.invocation.mentionLocks[0]?.kind, 'block');
briefDocument.position = { x: 880, y: 620 };
briefDocument.size = { width: 420, height: 260 };
briefDocument.data.title = 'Moved Brief';
briefDocument.updatedAt = '2026-07-23T12:00:00.000Z';
const approvedWorkflow = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: workflowTurn.proposal.recordVersion,
  proposalId: workflowTurn.proposal.proposalId,
});
assert.equal(approvedWorkflow.proposal.status, 'applied', 'Layout-only Block changes must preserve the semantic lock.');
assert.equal(approvedWorkflow.proposal.appliedEffect?.entrypointKind, 'workflow');
assert.equal(approvedWorkflow.proposal.appliedEffect?.createdBlockIds.length, 10);
assert.ok(approvedWorkflow.proposal.appliedEffect?.workflowGroupId);
assert.deepEqual(runtimeSideEffectCounts(snapshot), {
  agentRuns: 0,
  executions: 0,
  workflowRuns: 0,
  workflowStepRuns: 0,
});

const mutableText = textBlock(snapshot, 'block_mutable_brief', 'First version');
snapshot.blocks.push(mutableText);
const staleMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '',
  contextRefs: [
    { kind: 'entrypoint', entrypointId: 'skill:retake.screenplay.from-brief' },
    { kind: 'block', blockId: mutableText.blockId, slotId: 'brief' },
  ],
});
const staleTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: { kind: 'reply', message: '将创建 Skill 草稿，等待你批准。' },
  externalThreadId: 'thread_typed_entrypoint',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_stale_source',
  sourceMessageId: staleMessage.agentMessageId,
});
assert.ok(staleTurn.proposal);
const beforeFailedApply = stateCounts(snapshot);
mutableText.data.body = 'Second version';
const staleDecision = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: staleTurn.proposal.recordVersion,
  proposalId: staleTurn.proposal.proposalId,
});
assert.equal(staleDecision.proposal.status, 'failed');
assert.match(staleDecision.proposal.applyError ?? '', /frozen source message/);
assert.deepEqual(stateCounts(snapshot), {
  ...beforeFailedApply,
  changeDecisions: beforeFailedApply.changeDecisions + 1,
}, 'A failed staged apply must not leave partial Blocks or Edges.');

const rejectedMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '另一个剧本想法。',
  contextRefs: [{ kind: 'entrypoint', entrypointId: 'skill:retake.screenplay.from-brief' }],
});
const rejectedTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: { kind: 'reply', message: '等待批准。' },
  externalThreadId: 'thread_typed_entrypoint',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_reject',
  sourceMessageId: rejectedMessage.agentMessageId,
});
assert.ok(rejectedTurn.proposal);
const beforeReject = stateCounts(snapshot);
decideChangeProposal(snapshot, {
  decision: 'reject',
  expectedProposalVersion: rejectedTurn.proposal.recordVersion,
  proposalId: rejectedTurn.proposal.proposalId,
});
assert.deepEqual(stateCounts(snapshot), {
  ...beforeReject,
  changeDecisions: beforeReject.changeDecisions + 1,
});

const registryDriftMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: 'Registry drift test.',
  contextRefs: [{ kind: 'entrypoint', entrypointId: 'skill:retake.screenplay.from-brief' }],
});
const registryDriftTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: { kind: 'reply', message: '等待批准。' },
  externalThreadId: 'thread_typed_entrypoint',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_registry_drift',
  sourceMessageId: registryDriftMessage.agentMessageId,
});
assert.ok(registryDriftTurn.proposal);
const registryManifest = builtInPackageRegistry.manifests[0];
assert.ok(registryManifest);
const originalDigest = registryManifest.digest;
registryManifest.digest = 'sha256:simulated-registry-drift';
const beforeRegistryDriftApply = stateCounts(snapshot);
const registryDriftDecision = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: registryDriftTurn.proposal.recordVersion,
  proposalId: registryDriftTurn.proposal.proposalId,
});
registryManifest.digest = originalDigest;
assert.equal(registryDriftDecision.proposal.status, 'failed');
assert.match(registryDriftDecision.proposal.applyError ?? '', /frozen source message/);
assert.deepEqual(stateCounts(snapshot), {
  ...beforeRegistryDriftApply,
  changeDecisions: beforeRegistryDriftApply.changeDecisions + 1,
});

assert.throws(
  () => applyAgentRuntimeTurn(snapshot, {
    agentSessionId: session.agentSessionId,
    decision: {
      kind: 'change_proposal',
      message: '尝试改写命令。',
      proposalKind: 'out_of_scope',
      proposedCommand: { kind: 'unsupported', reason: 'Model-authored command.' },
      summary: 'Model-authored command.',
    },
    externalThreadId: 'thread_typed_entrypoint',
    runtimeModel: 'test-model',
    runtimeTurnId: 'turn_model_rewrite',
    sourceMessageId: rejectedMessage.agentMessageId,
  }),
  /cannot replace a typed EntryPoint invocation/,
);
assert.throws(
  () => parseAgentRuntimeDecision(JSON.stringify({
    kind: 'change_proposal',
    message: '尝试改写命令。',
    proposalKind: 'out_of_scope',
    proposedCommand: { kind: 'unsupported', reason: 'Model-authored command.' },
    summary: 'Model-authored command.',
  }), {
    availableAgentRuns: [],
    boardId: snapshot.board.boardId,
    entrypointId: 'skill:retake.screenplay.from-brief',
    history: [],
    mentions: [],
    projectId: snapshot.project.projectId,
    userMessage: 'Generate.',
  }),
  /cannot replace a typed EntryPoint invocation/,
);

console.log(JSON.stringify({
  ok: true,
  deterministicTypedCommand: true,
  documentAssetLock: true,
  registryDriftRejected: true,
  stagedApplication: true,
  semanticBlockLock: true,
  layoutChangesAllowed: true,
  skillAndWorkflowDrafts: true,
  noAutomaticRuntimeSideEffects: true,
  idempotentRetry: true,
  exactEffectRecorded: true,
}));

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

function textBlock(snapshot: BoardSnapshot, blockId: string, body: string): BlockRecord {
  return {
    blockId,
    boardId: snapshot.board.boardId,
    createdAt: '2026-07-23T00:00:00.000Z',
    data: { body, title: 'Brief' },
    layerId: 'layer_default',
    position: { x: 40, y: 40 },
    size: { height: 170, width: 260 },
    type: 'text',
    updatedAt: '2026-07-23T00:00:00.000Z',
    zIndex: 1,
  };
}

function documentBlock(snapshot: BoardSnapshot, blockId: string, assetId: string): BlockRecord {
  return {
    ...textBlock(snapshot, blockId, ''),
    data: { assetId, documentKind: 'creative_brief', title: 'Creative Brief' },
    type: 'document',
  };
}

function documentAsset(snapshot: BoardSnapshot, assetId: string): AssetRecord {
  return {
    assetId,
    createdAt: '2026-07-23T00:00:00.000Z',
    kind: 'document',
    mimeType: 'text/markdown',
    previewUrl: `/api/local/assets/${snapshot.project.projectId}/${assetId}/document.md`,
    projectId: snapshot.project.projectId,
    storageKey: `assets/${assetId}/document.md`,
    storageProvider: 'local',
  };
}

function runtimeSideEffectCounts(snapshot: BoardSnapshot) {
  return {
    agentRuns: snapshot.agentRuns?.length ?? 0,
    executions: snapshot.executions.length,
    workflowRuns: snapshot.workflowRuns?.length ?? 0,
    workflowStepRuns: snapshot.workflowStepRuns?.length ?? 0,
  };
}

function stateCounts(snapshot: BoardSnapshot) {
  return {
    blocks: snapshot.blocks.length,
    changeDecisions: snapshot.changeDecisions?.length ?? 0,
    edges: snapshot.edges.length,
    ...runtimeSideEffectCounts(snapshot),
  };
}
