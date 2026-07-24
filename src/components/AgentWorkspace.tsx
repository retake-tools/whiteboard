import { Archive, Bot, ChevronDown, CircleStop, Pause, Play, Plus, X } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { operationReadinessFor } from '../core/capabilities';
import {
  agentPresetCompatibilityForRequirements,
} from '../core/agentPresetApplication';
import { agentPresetDefinitionFor } from '../core/agentPresetRegistry';
import { messagesForSession, proposalsForSession, runtimeEventsForSession } from '../core/agentSession';
import type {
  AgentDraftLaunchTarget,
  AgentRuntimeBindingRecord,
  AgentSessionRecord,
  ChangeProposalRecord,
  PackageEntrypointAgentLaunchTarget,
} from '../core/agentSessionContracts';
import {
  listPackageEntryPoints,
  resolvePackageEntryPoint,
} from '../core/packageRegistry';
import { skillUiDefinitionFor } from '../core/skillRegistry';
import type { BoardSnapshot } from '../core/types';
import { packageEntrypointDraftLaunchRequirements } from '../core/packageEntrypointAgentLaunchApplication';
import { goalPlanDraftLaunchRequirements } from '../core/goalPlanAgentLaunchApplication';
import { listWorkflows, workflowUiDefinitionFor } from '../core/workflowRegistry';
import { useI18n } from '../i18n';
import { AgentWorkspaceComposer } from './AgentWorkspaceComposer';
import { TooltipIconButton } from './Tooltip';
import { WorkflowAgentTargetPicker } from './WorkflowAgentTargetPicker';

type AgentWorkspaceTab = 'chat' | 'run' | 'changes';

export function AgentWorkspace({
  binding,
  error,
  focusedAgentRunId,
  isSending,
  launchingProposalId,
  onArchiveSession,
  onCancelAgentRun,
  onClose,
  onCreateSession,
  onPauseAgentRun,
  onDecideProposal,
  onLaunchProposal,
  onResumeAgentRun,
  onSelectAgentRun,
  onSelectSession,
  onSubmitMessage,
  onViewProposalEffect,
  onViewProposalRun,
  selectedSession,
  sessions,
  snapshot,
}: {
  binding?: AgentRuntimeBindingRecord;
  error?: string;
  focusedAgentRunId?: string;
  isSending: boolean;
  launchingProposalId?: string;
  onArchiveSession: () => void;
  onCancelAgentRun: (agentRunId: string) => void;
  onClose: () => void;
  onCreateSession: () => void;
  onPauseAgentRun: (agentRunId: string) => void;
  onDecideProposal: (
    proposalId: string,
    expectedProposalVersion: number,
    decision: 'approve' | 'reject',
  ) => void;
  onLaunchProposal: (
    proposalId: string,
    expectedProposalVersion: number,
    target: AgentDraftLaunchTarget,
    agentPresetEntryPointId?: string,
  ) => void;
  onResumeAgentRun: (agentRunId: string) => void;
  onSelectAgentRun: (agentRunId?: string) => void;
  onSelectSession: (agentSessionId: string) => void;
  onSubmitMessage: (input: Parameters<typeof AgentWorkspaceComposer>[0]['onSubmit'] extends (value: infer T) => void ? T : never) => void;
  onViewProposalEffect: (proposalId: string) => void;
  onViewProposalRun: (proposalId: string) => void;
  selectedSession?: AgentSessionRecord;
  sessions: AgentSessionRecord[];
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = useState<AgentWorkspaceTab>('chat');
  const messages = selectedSession ? messagesForSession(snapshot, selectedSession.agentSessionId) : [];
  const proposals = selectedSession ? proposalsForSession(snapshot, selectedSession.agentSessionId) : [];
  const runtimeEvents = selectedSession ? runtimeEventsForSession(snapshot, selectedSession.agentSessionId) : [];
  const latestRuntimeEvent = runtimeEvents.at(-1);
  const agentRuns = [...(snapshot.agentRuns ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeRun = selectedSession?.activeAgentRunId
    ? agentRuns.find((run) => run.agentRunId === selectedSession.activeAgentRunId)
    : undefined;

  useEffect(() => {
    if (focusedAgentRunId) setTab('run');
  }, [focusedAgentRunId]);

  return (
    <aside className="agent-workspace" aria-label={t('agentWorkspace.title')}>
      <header>
        <div><span><Bot size={15} />{t('agentWorkspace.eyebrow')}</span><strong>{t('agentWorkspace.title')}</strong></div>
        <div>
          <TooltipIconButton className="icon-button" label={t('agentWorkspace.newSession')} onClick={onCreateSession}><Plus size={15} /></TooltipIconButton>
          <TooltipIconButton className="icon-button" label={t('agentWorkspace.archiveSession')} disabled={!selectedSession} onClick={onArchiveSession}><Archive size={15} /></TooltipIconButton>
          <TooltipIconButton className="icon-button" label={t('context.close')} onClick={onClose}><X size={15} /></TooltipIconButton>
        </div>
      </header>
      <label className="agent-workspace-session-select">
        <span>{t('agentWorkspace.session')}</span>
        <div>
          <select value={selectedSession?.agentSessionId ?? ''} disabled={sessions.length === 0} onChange={(event) => onSelectSession(event.target.value)}>
            {sessions.length === 0 ? <option value="">{t('agentWorkspace.noSession')}</option> : null}
            {sessions.map((session) => <option key={session.agentSessionId} value={session.agentSessionId}>{session.title}</option>)}
          </select>
          <ChevronDown size={13} />
        </div>
      </label>
      <nav>
        {(['chat', 'run', 'changes'] as AgentWorkspaceTab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>
            {t(`agentWorkspace.${item}`)}{item === 'changes' && proposals.some((proposal) => proposal.status === 'awaiting_decision') ? <span /> : null}
          </button>
        ))}
      </nav>
      <div className="agent-workspace-body">
        {!selectedSession ? (
          <div className="agent-workspace-empty"><Bot size={24} /><strong>{t('agentWorkspace.emptyTitle')}</strong><p>{t('agentWorkspace.emptyBody')}</p><button type="button" onClick={onCreateSession}>{t('agentWorkspace.createSession')}</button></div>
        ) : tab === 'chat' ? (
          <div className="agent-workspace-chat">
            <div className="agent-workspace-messages">
              {messages.length === 0 ? <p className="agent-workspace-placeholder">{t('agentWorkspace.chatEmpty')}</p> : messages.map((message) => (
                <article key={message.agentMessageId} className={`is-${message.role}`}>
                  <span>{message.role === 'user' ? t('agentWorkspace.you') : t('agentWorkspace.agent')}</span>
                  <p>{message.content}</p>
                  {message.contextRefs.length > 0 ? <small>{message.contextRefs.map(contextRefLabel).join(' · ')}</small> : null}
                </article>
              ))}
              {isSending ? <article className="is-assistant is-pending"><span>{t('agentWorkspace.agent')}</span><p>{latestRuntimeEvent?.kind === 'decision_delta' ? t('agentWorkspace.streaming') : t('agentWorkspace.thinking')}</p></article> : null}
            </div>
            {error ? <p className="agent-workspace-error" role="alert">{error}</p> : null}
            <AgentWorkspaceComposer disabled={isSending} snapshot={snapshot} onSubmit={onSubmitMessage} />
          </div>
        ) : tab === 'run' ? (
          <div className="agent-workspace-run">
            <label><span>{t('agentWorkspace.targetRun')}</span><select value={selectedSession.activeAgentRunId ?? ''} onChange={(event) => onSelectAgentRun(event.target.value || undefined)}><option value="">{t('agentWorkspace.noRun')}</option>{agentRuns.map((run) => <option key={run.agentRunId} value={run.agentRunId}>{run.target.kind} · {run.status} · {run.agentRunId.slice(-8)}</option>)}</select></label>
            {activeRun ? <><dl><div><dt>{t('agentWorkspace.runId')}</dt><dd>{activeRun.agentRunId}</dd></div><div><dt>{t('agentWorkspace.status')}</dt><dd>{activeRun.status}</dd></div>{activeRun.target.kind === 'goal' ? <><div><dt>{t('agentWorkspace.goalPlan')}</dt><dd>{activeRun.target.goalPlanSnapshot.goalPlanId}</dd></div><div><dt>{t('agentWorkspace.coverage')}</dt><dd>{activeRun.target.goalPlanSnapshot.coverage} · {activeRun.target.workflowRunId}</dd></div></> : null}<div><dt>{t('agentWorkspace.scope')}</dt><dd>{activeRun.scope.allowedOperationBlockIds.length} Operations · {activeRun.scope.allowedCapabilityIds.length} Capabilities</dd></div><div><dt>{t('agentWorkspace.runtime')}</dt><dd>{binding?.runtimeKind ?? '—'} · {binding?.model ?? '—'}</dd></div><div><dt>{t('agentWorkspace.agentPreset')}</dt><dd>{activeRun.agentPresetSnapshot ? `${activeRun.agentPresetSnapshot.name} · ${activeRun.agentPresetSnapshot.version}` : t('agentWorkspace.noAgentPreset')}</dd></div>{activeRun.agentPresetSnapshot ? <><div><dt>{t('agentWorkspace.package')}</dt><dd>{activeRun.agentPresetPackageLock?.packageId ?? '—'} · {activeRun.agentPresetPackageLock?.version ?? '—'}</dd></div><div><dt>{t('agentWorkspace.presetTools')}</dt><dd>{activeRun.permissions.allowedToolPermissions.join(' · ')}</dd></div></> : null}</dl><div className="agent-workspace-run-actions">{activeRun.status === 'paused' ? <button type="button" onClick={() => onResumeAgentRun(activeRun.agentRunId)}><Play size={14} />{t('agentRuntime.resume')}</button> : <button type="button" disabled={['succeeded', 'failed', 'canceled'].includes(activeRun.status)} onClick={() => onPauseAgentRun(activeRun.agentRunId)}><Pause size={14} />{t('agentRuntime.pause')}</button>}<button type="button" disabled={['succeeded', 'failed', 'canceled'].includes(activeRun.status)} onClick={() => onCancelAgentRun(activeRun.agentRunId)}><CircleStop size={14} />{t('agentRuntime.cancel')}</button></div></> : <p className="agent-workspace-placeholder">{t('agentWorkspace.runEmpty')}</p>}
          </div>
        ) : (
          <div className="agent-workspace-changes">
            {error ? <p className="agent-workspace-error" role="alert">{error}</p> : null}
            {proposals.length === 0
              ? <p className="agent-workspace-placeholder">{t('agentWorkspace.changesEmpty')}</p>
              : proposals.map((proposal) => (
                  <ProposalCard
                    agentSessionId={selectedSession.agentSessionId}
                    key={proposal.proposalId}
                    isLaunching={launchingProposalId === proposal.proposalId}
                    proposal={proposal}
                    snapshot={snapshot}
                    onDecide={onDecideProposal}
                    onLaunch={onLaunchProposal}
                    onView={onViewProposalEffect}
                    onViewRun={(proposalId) => {
                      onViewProposalRun(proposalId);
                      setTab('run');
                    }}
                  />
                ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ProposalCard({
  agentSessionId,
  isLaunching,
  onDecide,
  onLaunch,
  onView,
  onViewRun,
  proposal,
  snapshot,
}: {
  agentSessionId: string;
  isLaunching: boolean;
  onDecide: (
    proposalId: string,
    expectedProposalVersion: number,
    decision: 'approve' | 'reject',
  ) => void;
  onLaunch: (
    proposalId: string,
    expectedProposalVersion: number,
    target: AgentDraftLaunchTarget,
    agentPresetEntryPointId?: string,
  ) => void;
  onView: (proposalId: string) => void;
  onViewRun: (proposalId: string) => void;
  proposal: ChangeProposalRecord;
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const [isLaunchReviewOpen, setIsLaunchReviewOpen] = useState(false);
  const [workflowTarget, setWorkflowTarget] = useState<
    Exclude<PackageEntrypointAgentLaunchTarget, { kind: 'capability' }>
  >({ kind: 'workflow_run' });
  const [agentPresetEntryPointId, setAgentPresetEntryPointId] = useState('');
  const command = proposal.proposedCommand;
  const goalPlan = command.kind === 'goal_plan.instantiate'
    ? command.goalPlan
    : undefined;
  const typedInvocation = command.kind === 'package_entrypoint.instantiate'
    ? command.invocation
    : command.kind === 'goal_plan.instantiate'
      ? command.draftCommand.invocation
      : undefined;
  const entrypointName = typedInvocation
    ? typedEntryPointName(typedInvocation.targetLock.entrypointId, t)
    : undefined;
  const skillOperation = proposal.appliedEffect?.kind === 'package_entrypoint_draft'
    && proposal.appliedEffect.entrypointKind === 'skill'
    ? snapshot.blocks.find(
        (block) =>
          block.blockId === proposal.appliedEffect?.primaryBlockId
          && block.type === 'operation',
    )
    : undefined;
  const launchOperation = skillOperation ?? proposal.appliedEffect?.createdBlockIds
    .flatMap((blockId) => {
      const block = snapshot.blocks.find(
        (candidate) => candidate.blockId === blockId && candidate.type === 'operation',
      );
      return block ? [block] : [];
    })
    .find((block) => block.data.capabilityId === 'previs.storyboard_sheet.generate');
  const readiness = skillOperation
    ? operationReadinessFor(snapshot, skillOperation)
    : undefined;
  const workflowDefinitionId = typedInvocation?.targetLock.entrypointKind === 'workflow'
    ? typedInvocation.targetLock.workflowDefinitionLock.workflowDefinitionId
    : undefined;
  const isWorkflowEntrypoint = Boolean(workflowDefinitionId);
  const workflowDefinition = workflowDefinitionId
    ? listWorkflows().find((definition) => definition.workflowId === workflowDefinitionId)
    : undefined;
  const launchTarget: AgentDraftLaunchTarget = goalPlan
    ? { kind: 'goal' }
    : isWorkflowEntrypoint
    ? workflowTarget
    : { kind: 'capability' };
  const presetOptions = isLaunchReviewOpen
    ? agentPresetOptionsForDraft(
        snapshot,
        proposal,
        agentSessionId,
        launchTarget,
      )
    : [];
  const selectedPreset = presetOptions.find(
    (option) => option.entrypointId === agentPresetEntryPointId,
  );
  return (
    <article className={`is-${proposal.status}`}>
      <header>
        <strong>{goalPlan
          ? `${t('agentWorkspace.goalPlan')} · ${entrypointName}`
          : typedInvocation
          ? `${entrypointName} · ${typedInvocation.targetLock.entrypointKind}`
          : proposal.kind}</strong>
        <span>{proposal.status}</span>
      </header>
      <p>{proposal.summary}</p>
      {goalPlan ? (
        <dl className="agent-workspace-proposal-details">
          <div>
            <dt>{t('agentWorkspace.goal')}</dt>
            <dd>{goalPlan.goal}</dd>
          </div>
          <div>
            <dt>{t('agentWorkspace.coverage')}</dt>
            <dd>{goalPlan.coverage}</dd>
          </div>
          <div>
            <dt>{t('agentWorkspace.planScope')}</dt>
            <dd>
              {goalPlan.steps.length} Steps · {
                new Set(goalPlan.steps.map((step) => step.capabilityLock.capabilityId)).size
              } Capabilities
            </dd>
          </div>
          <div>
            <dt>{t('agentWorkspace.budget')}</dt>
            <dd>
              ≤ {goalPlan.budget.maxExecutionCount} Executions · 0 Package installs · {
                goalPlan.budget.externalActionPolicy
              }
            </dd>
          </div>
          {goalPlan.limitations.map((limitation) => (
            <div key={limitation}>
              <dt>{t('agentWorkspace.limitation')}</dt>
              <dd>{limitation}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {typedInvocation ? (
        <dl className="agent-workspace-proposal-details">
          <div>
            <dt>EntryPoint</dt>
            <dd>{typedInvocation.targetLock.entrypointId}</dd>
          </div>
          <div>
            <dt>{t('agentWorkspace.package')}</dt>
            <dd>{typedInvocation.targetLock.packageLock.packageId} · {typedInvocation.targetLock.packageLock.version}</dd>
          </div>
          <div>
            <dt>{t('agentWorkspace.instruction')}</dt>
            <dd>{typedInvocation.instruction || '—'}</dd>
          </div>
          {typedInvocation.mentionLocks.map((mention) => (
            <div key={`${mention.kind}:${mention.kind === 'block' ? mention.blockId : mention.assetId}:${mention.slotId}`}>
              <dt>{t('agentWorkspace.sourceBinding')}</dt>
              <dd>
                @{mention.kind === 'block' ? `Block ${mention.blockId.slice(-8)}` : `Asset ${mention.assetId.slice(-8)}`}
                {' → '}{mention.slotId} · {mention.kind === 'block' ? mention.expectedBlockType : mention.expectedAssetKind}
              </dd>
            </div>
          ))}
          {typedInvocation.inlineValues.map((value) => (
            <div key={`inline:${value.slotId}`}>
              <dt>{value.slotId}</dt>
              <dd>{inlineValueSummary(value.value)}</dd>
            </div>
          ))}
          <div>
            <dt>{t('agentWorkspace.parameters')}</dt>
            <dd>{invocationParameterSummary(typedInvocation.parameters)}</dd>
          </div>
          <div>
            <dt>{t('agentWorkspace.effect')}</dt>
            <dd>{typedInvocation.targetLock.entrypointKind === 'skill'
              ? t('agentWorkspace.skillDraftEffect')
              : t('agentWorkspace.workflowDraftEffect')}</dd>
          </div>
        </dl>
      ) : (
        <>
          <small>{proposal.instruction}</small>
          <small>{command.kind}</small>
        </>
      )}
      {typedInvocation ? <p className="agent-workspace-draft-only">{t('agentWorkspace.draftOnly')}</p> : null}
      {proposal.applyError ? <p className="agent-workspace-error">{proposal.applyError}</p> : null}
      {proposal.status === 'awaiting_decision' ? (
        <div className="agent-workspace-proposal-actions">
          <button
            type="button"
            disabled={command.kind === 'unsupported'}
            onClick={() => onDecide(proposal.proposalId, proposal.recordVersion, 'approve')}
          >
            {t('agentWorkspace.approveProposal')}
          </button>
          <button
            type="button"
            onClick={() => onDecide(proposal.proposalId, proposal.recordVersion, 'reject')}
          >
            {t('agentWorkspace.rejectProposal')}
          </button>
        </div>
      ) : null}
      {proposal.status === 'applied' && proposal.appliedEffect ? (
        <>
          <div className="agent-workspace-applied-actions">
            <button className="agent-workspace-view-effect" type="button" onClick={() => onView(proposal.proposalId)}>
              {t('agentWorkspace.viewOnCanvas')}
            </button>
            {proposal.draftLaunchEffect ? (
              <button type="button" onClick={() => onViewRun(proposal.proposalId)}>
                {t('agentWorkspace.viewRun')}
              </button>
            ) : (
              <button type="button" onClick={() => setIsLaunchReviewOpen((current) => !current)}>
                <Play size={13} />{t('agentWorkspace.launchAgent')}
              </button>
            )}
          </div>
          {isLaunchReviewOpen && !proposal.draftLaunchEffect ? (
            <div className="agent-workspace-launch-review">
              <strong>{t('agentWorkspace.launchReview')}</strong>
              {readiness ? (
                <small>
                  {readiness.canRun
                    ? t('agentWorkspace.launchReady')
                    : t('agentWorkspace.launchWaitingInput')}
                </small>
              ) : null}
              {typedInvocation ? (
                <div className="agent-workspace-preset-summary">
                  {typedInvocation.inlineValues.map((value) => (
                    <small key={`launch-inline:${value.slotId}`}>
                      {value.slotId}: {inlineValueSummary(value.value)}
                    </small>
                  ))}
                  <small>
                    {t('agentWorkspace.sourceBinding')}: {typedInvocation.mentionLocks.map(
                      (mention) => `${mention.slotId}=${mention.kind === 'block'
                        ? `Block ${mention.blockId.slice(-8)}`
                        : `Asset ${mention.assetId.slice(-8)}`}`,
                    ).join(' · ') || '—'}
                  </small>
                  <small>{t('agentWorkspace.parameters')}: {invocationParameterSummary(typedInvocation.parameters)}</small>
                  <small>
                    {t('operationToolbar.generator')}: {
                      typeof launchOperation?.data.connectionId === 'string'
                        ? launchOperation.data.connectionId
                        : '—'
                    } · {typeof launchOperation?.data.adapter === 'string' ? launchOperation.data.adapter : '—'}
                  </small>
                </div>
              ) : null}
              {workflowDefinition && !goalPlan ? (
                <WorkflowAgentTargetPicker
                  definition={workflowDefinition}
                  value={workflowTarget}
                  onChange={setWorkflowTarget}
                />
              ) : null}
              {isWorkflowEntrypoint && !workflowDefinition ? (
                <small className="agent-workspace-error">
                  {t('agentWorkspace.launchDefinitionMissing')}
                </small>
              ) : null}
              <label>
                <span>{t('agentWorkspace.agentPreset')}</span>
                <select
                  value={agentPresetEntryPointId}
                  onChange={(event) => setAgentPresetEntryPointId(event.target.value)}
                >
                  <option value="">{t('agentWorkspace.noAgentPreset')}</option>
                  {presetOptions.map((option) => (
                    <option
                      key={option.entrypointId}
                      value={option.entrypointId}
                      disabled={!option.compatible}
                    >
                      {option.name}{option.compatible ? '' : ` — ${option.issues.join('; ')}`}
                    </option>
                  ))}
                </select>
              </label>
              {selectedPreset ? (
                <div className="agent-workspace-preset-summary">
                  <strong>{selectedPreset.roleLabel ?? selectedPreset.name}</strong>
                  <small>{selectedPreset.packageId} · {selectedPreset.version}</small>
                  <small>{t('agentWorkspace.presetTools')}: {selectedPreset.toolPermissions.join(' · ')}</small>
                  <small>{t('agentWorkspace.presetRuntime')}: {selectedPreset.runtimeKinds.join(' · ')} · {selectedPreset.requiredFeatures.join(' · ')}</small>
                  <small>{t('agentWorkspace.presetBoundary')}</small>
                </div>
              ) : null}
              <p>{goalPlan
                ? t('agentWorkspace.goalLaunchWarning')
                : t('agentWorkspace.launchWarning')}</p>
              <button
                type="button"
                disabled={
                  isLaunching
                  || (isWorkflowEntrypoint && !workflowDefinition)
                  || Boolean(agentPresetEntryPointId && !selectedPreset?.compatible)
                }
                onClick={() => onLaunch(
                  proposal.proposalId,
                  proposal.recordVersion,
                  launchTarget,
                  agentPresetEntryPointId || undefined,
                )}
              >
                <Play size={13} />
                {isLaunching
                  ? t('agentWorkspace.launching')
                  : t('agentWorkspace.confirmLaunch')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function agentPresetOptionsForDraft(
  snapshot: BoardSnapshot,
  proposal: ChangeProposalRecord,
  agentSessionId: string,
  target: AgentDraftLaunchTarget,
): Array<{
  compatible: boolean;
  entrypointId: string;
  issues: string[];
  name: string;
  packageId: string;
  roleLabel?: string;
  runtimeKinds: string[];
  requiredFeatures: string[];
  toolPermissions: string[];
  version: string;
}> {
  let requirements;
  try {
    requirements = target.kind === 'goal'
      ? goalPlanDraftLaunchRequirements(snapshot, proposal.proposalId)
      : packageEntrypointDraftLaunchRequirements(
          snapshot,
          proposal.proposalId,
          target,
        );
  } catch (error) {
    return listPackageEntryPoints()
      .filter((registration) => registration.entrypoint.kind === 'agent_preset')
      .map((registration) => ({
        compatible: false,
        entrypointId: registration.entrypoint.entrypointId,
        issues: [error instanceof Error ? error.message : String(error)],
        name: registration.entrypoint.name,
        packageId: registration.packageLock.packageId,
        requiredFeatures: [],
        runtimeKinds: [],
        toolPermissions: [],
        version: registration.packageLock.version,
      }));
  }
  return listPackageEntryPoints().flatMap((registration) => {
    if (registration.entrypoint.kind !== 'agent_preset') return [];
    const resolution = resolvePackageEntryPoint({
      entrypointId: registration.entrypoint.entrypointId,
    });
    if (resolution.status !== 'needs_target') return [];
    const definition = agentPresetDefinitionFor(
      resolution.target.agentPresetLock.agentPresetId,
    );
    const compatibility = agentPresetCompatibilityForRequirements(
      snapshot,
      agentSessionId,
      definition,
      requirements,
    );
    return [{
      compatible: compatibility.compatible,
      entrypointId: registration.entrypoint.entrypointId,
      issues: compatibility.issues,
      name: definition.name,
      packageId: registration.packageLock.packageId,
      ...(definition.roleLabel ? { roleLabel: definition.roleLabel } : {}),
      requiredFeatures: definition.runtimePreference.requiredFeatures,
      runtimeKinds: definition.runtimePreference.compatibleRuntimeKinds,
      toolPermissions: definition.toolPolicy.allowedToolPermissions,
      version: definition.version,
    }];
  });
}

function typedEntryPointName(
  entrypointId: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const resolution = resolvePackageEntryPoint({ entrypointId });
  if (resolution.status !== 'resolved') return entrypointId;
  if (resolution.target.kind === 'skill') {
    return t(skillUiDefinitionFor(resolution.target.skillLock.skillId).nameKey);
  }
  return t(workflowUiDefinitionFor(
    resolution.target.workflowDefinitionLock.workflowDefinitionId,
  ).nameKey);
}

function contextRefLabel(ref: NonNullable<ReturnType<typeof messagesForSession>[number]>['contextRefs'][number]): string {
  if (ref.kind === 'entrypoint') return `/${ref.entrypointId}`;
  if (ref.kind === 'agent_run') return `Run ${ref.agentRunId.slice(-8)}`;
  if (ref.kind === 'inline') return `${ref.slotId}: ${inlineValueSummary(ref.value)}`;
  if (ref.kind === 'parameters') return invocationParameterSummary(ref.value);
  if (ref.kind === 'block') return `@Block ${ref.blockId.slice(-8)}`;
  return `@Asset ${ref.assetId.slice(-8)}`;
}

function invocationParameterSummary(parameters: Record<string, unknown>): string {
  const entries = Object.entries(parameters);
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' · ');
}

function inlineValueSummary(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
