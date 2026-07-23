import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  agentPresetDefinitionFor,
  createAgentPresetRegistry,
  listAgentPresets,
  storyProductionDirectorPreset,
  validateAgentPresetDefinition,
} from '../src/core/agentPresetRegistry';
import { assertAgentPresetSnapshotForRun } from '../src/core/agentPresetApplication';
import {
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import type {
  ChangeProposalRecord,
  PackageEntrypointAgentLaunchTarget,
} from '../src/core/agentSessionContracts';
import {
  buildPackageEntrypointDraftLaunchCommand,
  packageEntrypointDraftLaunchRequirements,
  stagePackageEntrypointAgentLaunch,
} from '../src/core/packageEntrypointAgentLaunchApplication';
import {
  resolvePackageEntryPoint,
  storyProductionAgentPackage,
  validatePackageManifest,
} from '../src/core/packageRegistry';
import type { BoardSnapshot } from '../src/core/types';
import { resetWorkspace } from './local-store/snapshot-store';

const presetId = 'retake.agent.story-production-director';
const presetEntrypointId = 'agent:retake.agent.story-production-director';

assert.equal(listAgentPresets().length, 1);
assert.equal(agentPresetDefinitionFor(presetId).roleLabel, 'Director');
assert.deepEqual(validateAgentPresetDefinition(storyProductionDirectorPreset), []);
assert.deepEqual(validatePackageManifest(storyProductionAgentPackage), []);
assert.doesNotThrow(() => createAgentPresetRegistry([storyProductionDirectorPreset]));

const invalidPreset = structuredClone(storyProductionDirectorPreset);
invalidPreset.allowedCapabilityIds.push('missing.capability');
assert.match(validateAgentPresetDefinition(invalidPreset).join('\n'), /not registered/);
const invalidPackage = structuredClone(storyProductionAgentPackage);
invalidPackage.components.agentPresets[0].definitionHash = 'sha256:stale';
assert.match(validatePackageManifest(invalidPackage).join('\n'), /AgentPreset lock mismatch/);

const needsTarget = resolvePackageEntryPoint({ entrypointId: presetEntrypointId });
assert.equal(needsTarget.status, 'needs_target');
assert.ok(needsTarget.status === 'needs_target');
assert.equal(needsTarget.target.agentPresetLock.agentPresetId, presetId);

const skill = await appliedProposal({
  content: '一只快递猫要在日出前把最后一卷胶片送到影院。',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const skillTarget = { kind: 'capability' } as const;
assert.deepEqual(
  packageEntrypointDraftLaunchRequirements(
    skill.snapshot,
    skill.proposal.proposalId,
    skillTarget,
  ),
  {
    capabilityIds: ['story.screenplay.generate'],
    skillIds: ['retake.screenplay.from-brief'],
  },
);
const skillCommand = launchCommand(
  skill.proposal,
  skill.sessionId,
  skillTarget,
  presetEntrypointId,
);
const launchedSkill = stagePackageEntrypointAgentLaunch(skill.snapshot, skillCommand);
const skillRun = launchedSkill.stagedSnapshot.agentRuns?.find(
  (run) => run.agentRunId === launchedSkill.effect.agentRunId,
);
assert.ok(skillRun);
assert.equal(skillRun.agentPresetSnapshot?.agentPresetId, presetId);
assert.deepEqual(skillRun.agentPresetPackageLock, needsTarget.target.packageLock);
assert.deepEqual(skillRun.permissions.allowedToolPermissions, [
  'retake.read',
  'retake.execute_capability',
]);
assert.doesNotThrow(() => assertAgentPresetSnapshotForRun(
  launchedSkill.stagedSnapshot,
  skillRun,
));

const userAfterLaunch = appendAgentUserMessage(
  launchedSkill.stagedSnapshot,
  skill.sessionId,
  { content: '现在的职责和边界是什么？' },
);
const runtimeContext = agentRuntimeTurnContext(
  launchedSkill.stagedSnapshot,
  skill.sessionId,
  userAfterLaunch.agentMessageId,
);
assert.equal(runtimeContext.agentRun?.agentPreset?.agentPresetId, presetId);
assert.match(runtimeContext.agentRun?.agentPreset?.instructions ?? '', /locked target/);

const skillRetry = stagePackageEntrypointAgentLaunch(
  launchedSkill.stagedSnapshot,
  skillCommand,
);
assert.equal(skillRetry.effect.agentRunId, launchedSkill.effect.agentRunId);
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    launchedSkill.stagedSnapshot,
    { ...skillCommand, agentPresetSelection: undefined },
  ),
  /retry AgentPreset conflicts/,
);

const workflow = await appliedProposal({
  content: '一只猫在清晨完成一部短片的故事与分镜。',
  entrypointId: 'workflow:retake.workflow.story-to-storyboard',
});
const workflowTarget = { kind: 'workflow_run' } as const;
assert.deepEqual(
  packageEntrypointDraftLaunchRequirements(
    workflow.snapshot,
    workflow.proposal.proposalId,
    workflowTarget,
  ),
  {
    capabilityIds: [
      'story.screenplay.generate',
      'design.character.define',
      'design.scene.define',
      'previs.storyboard.plan',
    ],
    skillIds: [
      'retake.screenplay.from-brief',
      'retake.character-bible.from-screenplay',
      'retake.scene-bible.from-screenplay',
      'retake.storyboard-plan.from-production-design',
    ],
  },
);
const launchedWorkflow = stagePackageEntrypointAgentLaunch(
  workflow.snapshot,
  launchCommand(
    workflow.proposal,
    workflow.sessionId,
    workflowTarget,
    presetEntrypointId,
  ),
);
assert.equal(
  launchedWorkflow.stagedSnapshot.agentRuns?.[0]?.agentPresetSnapshot?.agentPresetId,
  presetId,
);

const normalize = await appliedProposal({
  content: '整理这份剧本。',
  entrypointId: 'skill:retake.screenplay.normalize',
});
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    normalize.snapshot,
    launchCommand(
      normalize.proposal,
      normalize.sessionId,
      { kind: 'capability' },
      presetEntrypointId,
    ),
  ),
  /does not allow Capability: story\.screenplay\.normalize/,
);
assert.equal(normalize.snapshot.agentRuns?.length, 0);

const incompatibleRuntime = await appliedProposal({
  content: 'Runtime mismatch.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const runtimeBinding = incompatibleRuntime.snapshot.agentRuntimeBindings?.[0];
assert.ok(runtimeBinding);
runtimeBinding.status = 'stale';
assert.throws(
  () => stagePackageEntrypointAgentLaunch(
    incompatibleRuntime.snapshot,
    launchCommand(
      incompatibleRuntime.proposal,
      incompatibleRuntime.sessionId,
      { kind: 'capability' },
      presetEntrypointId,
    ),
  ),
  /active Agent Runtime binding/,
);

const noPreset = await appliedProposal({
  content: 'No preset remains supported.',
  entrypointId: 'skill:retake.screenplay.from-brief',
});
const launchedWithoutPreset = stagePackageEntrypointAgentLaunch(
  noPreset.snapshot,
  launchCommand(
    noPreset.proposal,
    noPreset.sessionId,
    { kind: 'capability' },
  ),
);
assert.equal(launchedWithoutPreset.stagedSnapshot.agentRuns?.[0]?.agentPresetSnapshot, undefined);

const [workspaceSource, runtimePortSource, composerSource] = await Promise.all([
  readFile(new URL('../src/components/AgentWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./agent-runtime-port.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AgentWorkspaceComposer.tsx', import.meta.url), 'utf8'),
]);
assert.match(workspaceSource, /agentWorkspace\.noAgentPreset/);
assert.match(workspaceSource, /agentPresetOptionsForDraft/);
assert.match(workspaceSource, /agentPresetSnapshot/);
assert.match(runtimePortSource, /agentRun\.agentPreset/);
assert.doesNotMatch(composerSource, /kind === 'agent_preset'/);

console.log(JSON.stringify({
  ok: true,
  typedRegistryAndPackageLock: true,
  needsTargetResolution: true,
  targetCompatibility: true,
  fullSnapshotAndPackageProvenance: true,
  noPresetCompatibility: true,
  idempotentPresetRetry: true,
  runtimeBindingGuard: true,
  runtimeContextInjection: true,
  providerPromptIsolation: true,
  launchReviewAndRunUi: true,
}));

async function appliedProposal(input: {
  content: string;
  entrypointId: string;
}): Promise<{
  proposal: ChangeProposalRecord;
  sessionId: string;
  snapshot: BoardSnapshot;
}> {
  const snapshot = await emptySnapshot();
  const session = createAgentSession(snapshot, { model: 'test-model' }).session;
  const message = appendAgentUserMessage(snapshot, session.agentSessionId, {
    content: input.content,
    contextRefs: [{ entrypointId: input.entrypointId, kind: 'entrypoint' }],
  });
  const turn = applyAgentRuntimeTurn(snapshot, {
    agentSessionId: session.agentSessionId,
    decision: { kind: 'reply', message: 'Create a Draft.' },
    externalThreadId: 'thread_agent_preset',
    runtimeModel: 'test-model',
    runtimeTurnId: `turn_${input.entrypointId}`,
    sourceMessageId: message.agentMessageId,
  });
  assert.ok(turn.proposal);
  const approved = decideChangeProposal(snapshot, {
    decision: 'approve',
    expectedProposalVersion: turn.proposal.recordVersion,
    proposalId: turn.proposal.proposalId,
  });
  assert.equal(approved.proposal.status, 'applied');
  return {
    proposal: approved.proposal,
    sessionId: session.agentSessionId,
    snapshot,
  };
}

function launchCommand(
  proposal: ChangeProposalRecord,
  agentSessionId: string,
  target: PackageEntrypointAgentLaunchTarget,
  agentPresetEntryPointId?: string,
) {
  return buildPackageEntrypointDraftLaunchCommand({
    agentPresetEntryPointId,
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
