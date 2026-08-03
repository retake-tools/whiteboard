import { Activity, Bot, CircleAlert, CircleStop, MapPin, Pause, Play } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { operationReadinessFor, operationReadinessMessageKey } from '../core/capabilities';
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
  ChangeProposalStatus,
  PackageEntrypointAgentLaunchTarget,
} from '../core/agentSessionContracts';
import type { AgentRunRecord } from '../core/agentRuntimeContracts';
import {
  agentRunInterventionFor,
  type AgentRunInterventionKind,
} from '../core/agentRunIntervention';
import {
  listPackageEntryPoints,
  resolvePackageEntryPoint,
} from '../core/packageRegistry';
import { resolvedSkillUiDefinitionFor } from '../core/skillRegistry';
import type { BoardSnapshot } from '../core/types';
import { packageEntrypointDraftLaunchRequirements } from '../core/packageEntrypointAgentLaunchApplication';
import { goalPlanDraftLaunchRequirements } from '../core/goalPlanAgentLaunchApplication';
import {
  listWorkflows,
  resolvedWorkflowUiDefinitionFor,
} from '../core/workflowRegistry';
import { useI18n } from '../i18n';
import { AgentMessageCard } from './AgentMessageCard';
import { AgentOperationRunCard } from './AgentOperationRunCard';
import { AgentWorkspaceComposer } from './AgentWorkspaceComposer';
import { AgentWorkspaceHeader } from './AgentWorkspaceHeader';
import { AgentWorkflowRunNavigator } from './AgentWorkflowRunNavigator';
import { WorkflowAgentTargetPicker } from './WorkflowAgentTargetPicker';
import {
  currentInstalledRuntimeRegistryRevision,
  subscribeInstalledRuntimeRegistry,
} from '../core/installedRuntimeRegistry';
import {
  currentExecutionProviderSettings,
  readyAutomatedExecutionConnections,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';

export function AgentWorkspace({
  binding,
  error,
  focusedAgentRunId,
  isSending,
  launchingProposalId,
  onArchiveSession,
  onAttachFiles,
  onCancelAgentRun,
  onClose,
  onCreateSession,
  onPauseAgentRun,
  onDecideProposal,
  onLaunchProposal,
  onLocateBlock,
  onOpenWorkflowRun,
  onResumeAgentRun,
  onRequestCanvasMode,
  onRenameSession,
  onSelectLaunchConnection,
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
  onAttachFiles?: Parameters<typeof AgentWorkspaceComposer>[0]['onAttachFiles'];
  onCancelAgentRun: (agentRunId: string) => void;
  onClose: () => void;
  onCreateSession: (connectionId?: string) => void;
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
  onLocateBlock: (blockId: string) => void;
  onOpenWorkflowRun: (workflowRunId: string) => void;
  onResumeAgentRun: (agentRunId: string) => void;
  onRequestCanvasMode: () => void;
  onRenameSession: (title: string) => boolean;
  onSelectLaunchConnection: (
    blockId: string,
    connectionId: string,
  ) => void;
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
  useSyncExternalStore(
    subscribeInstalledRuntimeRegistry,
    currentInstalledRuntimeRegistryRevision,
    currentInstalledRuntimeRegistryRevision,
  );
  useSyncExternalStore(
    subscribeExecutionProviderSettings,
    () => currentExecutionProviderSettings(),
    () => currentExecutionProviderSettings(),
  );
  const runCardRef = useRef<HTMLElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const messages = selectedSession ? messagesForSession(snapshot, selectedSession.agentSessionId) : [];
  const proposals = selectedSession
    ? [...proposalsForSession(snapshot, selectedSession.agentSessionId)]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];
  const runtimeEvents = selectedSession ? runtimeEventsForSession(snapshot, selectedSession.agentSessionId) : [];
  const latestRuntimeEvent = runtimeEvents.at(-1);
  const agentRuns = [...(snapshot.agentRuns ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeRun = selectedSession?.activeAgentRunId
    ? agentRuns.find((run) => run.agentRunId === selectedSession.activeAgentRunId)
    : undefined;
  const pendingProposalCount = proposals.filter(
    (proposal) => proposal.status === 'awaiting_decision',
  ).length;
  const sourceMessageIdsWithReply = new Set(
    messages.flatMap((message) => message.sourceMessageId ? [message.sourceMessageId] : []),
  );
  const orphanProposals = proposals.filter(
    (proposal) => !sourceMessageIdsWithReply.has(proposal.sourceMessageId),
  );
  const runtimeConnection = currentExecutionProviderSettings()?.connections.find(
    (connection) => connection.connectionId === binding?.connectionId,
  );

  useEffect(() => {
    if (focusedAgentRunId) runCardRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusedAgentRunId]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: 'end' });
  }, [
    activeRun?.status,
    isSending,
    messages.length,
    proposals.length,
    selectedSession?.agentSessionId,
  ]);

  return (
    <aside
      className="agent-workspace"
      aria-label={t('agentWorkspace.title')}
      onKeyDown={trapNarrowWorkspaceFocus}
    >
      <AgentWorkspaceHeader
        onArchiveSession={onArchiveSession}
        onClose={onClose}
        onCreateSession={onCreateSession}
        onRenameSession={onRenameSession}
        onSelectSession={onSelectSession}
        projectId={snapshot.project.projectId}
        runtimeLabel={binding
          ? `${runtimeConnection?.displayName ?? binding.connectionId} · ${binding.model}`
          : undefined}
        selectedSession={selectedSession}
        sessions={sessions}
      />
      {selectedSession && (activeRun || pendingProposalCount > 0) ? (
        <div
          className="agent-workspace-context-bar"
          role="status"
          aria-atomic="true"
          aria-live="polite"
        >
          {activeRun ? (
            <span><Activity size={13} />{`${t('agentWorkspace.run')} · ${t(agentRunStatusKey(activeRun.status))}`}</span>
          ) : <span />}
          {pendingProposalCount > 0 ? (
            <span className="is-attention">
              <CircleAlert size={13} />
              {t('agentWorkspace.pendingChanges')} · {pendingProposalCount}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="agent-workspace-body">
        {!selectedSession ? (
          <div className="agent-workspace-empty">
            <Bot size={24} />
            <strong>{t('agentWorkspace.preparingSession')}</strong>
          </div>
        ) : (
          <div className="agent-workspace-chat">
            <AgentWorkflowRunNavigator
              activeAgentRun={activeRun}
              onOpenWorkflowRun={onOpenWorkflowRun}
              snapshot={snapshot}
            />
            <div
              className="agent-workspace-messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {messages.length === 0 && proposals.length === 0 && !activeRun
                ? (
                  <div className="agent-workspace-welcome">
                    <Bot size={20} />
                    <strong>{t('agentWorkspace.chatEmptyTitle')}</strong>
                    <p>{t('agentWorkspace.chatEmpty')}</p>
                    <div className="agent-workspace-quick-starts">
                      {[
                        t('agentWorkspace.quickStartPoster'),
                        t('agentWorkspace.quickStartEdit'),
                        t('agentWorkspace.quickStartPlan'),
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent(
                            'retake:focus-unified-composer',
                            { detail: { instruction: prompt } },
                          ))}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )
                : null}
              {messages.map((message) => {
                const messageProposals = message.role === 'assistant' && message.sourceMessageId
                  ? proposals.filter((proposal) => proposal.sourceMessageId === message.sourceMessageId)
                  : [];
                const operationReceipt = message.role === 'assistant'
                  ? message.contextRefs.find((ref) => ref.kind === 'operation_receipt')
                  : undefined;
                return (
                  <div key={message.agentMessageId} className="agent-workspace-timeline-item">
                    <AgentMessageCard message={message} />
                    {message.role === 'assistant' && message.suggestions?.length ? (
                      <div className="agent-workspace-suggestions" aria-label={t('agentWorkspace.suggestions')}>
                        {message.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent(
                              'retake:focus-unified-composer',
                              { detail: { instruction: suggestion } },
                            ))}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {operationReceipt ? (
                      <AgentOperationRunCard
                        onLocateBlock={onLocateBlock}
                        receipt={operationReceipt}
                        snapshot={snapshot}
                      />
                    ) : null}
                    {messageProposals.map((proposal) => (
                      <ProposalCard
                        agentSessionId={selectedSession.agentSessionId}
                        key={proposal.proposalId}
                        isLaunching={launchingProposalId === proposal.proposalId}
                        proposal={proposal}
                        snapshot={snapshot}
                        onDecide={onDecideProposal}
                        onLaunch={onLaunchProposal}
                        onSelectLaunchConnection={onSelectLaunchConnection}
                        onView={onViewProposalEffect}
                        onViewRun={onViewProposalRun}
                      />
                    ))}
                  </div>
                );
              })}
              {orphanProposals.map((proposal) => (
                <ProposalCard
                  agentSessionId={selectedSession.agentSessionId}
                  key={proposal.proposalId}
                  isLaunching={launchingProposalId === proposal.proposalId}
                  proposal={proposal}
                  snapshot={snapshot}
                  onDecide={onDecideProposal}
                  onLaunch={onLaunchProposal}
                  onSelectLaunchConnection={onSelectLaunchConnection}
                  onView={onViewProposalEffect}
                  onViewRun={onViewProposalRun}
                />
              ))}
              {activeRun ? (
                <AgentRunSummaryCard
                  cardRef={runCardRef}
                  activeRun={activeRun}
                  agentRuns={agentRuns}
                  binding={binding}
                  selectedSession={selectedSession}
                  onCancelAgentRun={onCancelAgentRun}
                  onPauseAgentRun={onPauseAgentRun}
                  onResumeAgentRun={onResumeAgentRun}
                  onSelectAgentRun={onSelectAgentRun}
                  onLocateBlock={onLocateBlock}
                  snapshot={snapshot}
                />
              ) : null}
              {isSending ? (
                <article
                  className="is-assistant is-pending"
                  role="status"
                  aria-atomic="true"
                  aria-live="polite"
                >
                  <span>{t('agentWorkspace.agent')}</span>
                  <p>{latestRuntimeEvent?.kind === 'decision_delta'
                    ? t('agentWorkspace.streaming')
                    : t('agentWorkspace.thinking')}</p>
                </article>
              ) : null}
              <div ref={timelineEndRef} aria-hidden="true" />
            </div>
            {error ? <p className="agent-workspace-error" role="alert">{error}</p> : null}
            <AgentWorkspaceComposer
              disabled={isSending}
              onAttachFiles={onAttachFiles}
              snapshot={snapshot}
              onRequestCanvasMode={onRequestCanvasMode}
              onSubmit={onSubmitMessage}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

const AgentRunSummaryCard = function AgentRunSummaryCard({
  activeRun,
  agentRuns,
  binding,
  cardRef,
  onCancelAgentRun,
  onPauseAgentRun,
  onLocateBlock,
  onResumeAgentRun,
  onSelectAgentRun,
  selectedSession,
  snapshot,
}: {
  activeRun?: AgentRunRecord;
  agentRuns: AgentRunRecord[];
  binding?: AgentRuntimeBindingRecord;
  cardRef: Ref<HTMLElement>;
  onCancelAgentRun: (agentRunId: string) => void;
  onPauseAgentRun: (agentRunId: string) => void;
  onLocateBlock: (blockId: string) => void;
  onResumeAgentRun: (agentRunId: string) => void;
  onSelectAgentRun: (agentRunId?: string) => void;
  selectedSession: AgentSessionRecord;
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const intervention = activeRun
    ? agentRunInterventionFor(snapshot, activeRun)
    : undefined;
  const isTerminal = activeRun
    ? ['succeeded', 'failed', 'canceled'].includes(activeRun.status)
    : false;
  return (
    <article ref={cardRef} className={`agent-workspace-run-card${activeRun ? ` is-${activeRun.status}` : ''}`}>
      <header>
        <span><Activity size={14} />{t('agentWorkspace.run')}</span>
        <strong>{activeRun ? t(agentRunStatusKey(activeRun.status)) : t('agentWorkspace.noRun')}</strong>
      </header>
      {activeRun ? (
        <>
          <p>{agentRunTargetLabel(activeRun, snapshot)}</p>
          {intervention ? (
            <section className="agent-workspace-run-intervention" aria-label={t('agentWorkspace.intervention')}>
              <strong>{t(agentRunInterventionTitleKey(intervention.kind))}</strong>
              <p>{t(agentRunInterventionBodyKey(intervention.kind))}</p>
              {intervention.targetLabel ? <small>{intervention.targetLabel}</small> : null}
              {intervention.readinessIssues.length > 0 ? (
                <ul>
                  {intervention.readinessIssues.map((issue) => (
                    <li key={issue}>{t(operationReadinessMessageKey(issue))}</li>
                  ))}
                </ul>
              ) : null}
              {intervention.detail ? <small>{intervention.detail}</small> : null}
              {intervention.locateBlockId ? (
                <button type="button" onClick={() => onLocateBlock(intervention.locateBlockId!)}>
                  <MapPin size={14} />
                  {t('agentWorkspace.locateIntervention')}
                </button>
              ) : null}
            </section>
          ) : null}
          <div className="agent-workspace-run-actions">
            {activeRun.status === 'paused'
              ? <button type="button" onClick={() => onResumeAgentRun(activeRun.agentRunId)}><Play size={14} />{t('agentRuntime.resume')}</button>
              : <button type="button" disabled={isTerminal} onClick={() => onPauseAgentRun(activeRun.agentRunId)}><Pause size={14} />{t('agentRuntime.pause')}</button>}
            <button type="button" disabled={isTerminal} onClick={() => onCancelAgentRun(activeRun.agentRunId)}><CircleStop size={14} />{t('agentRuntime.cancel')}</button>
          </div>
        </>
      ) : <p>{t('agentWorkspace.runEmpty')}</p>}
      <details>
        <summary>{t('agentWorkspace.runDetails')}</summary>
        <label>
          <span>{t('agentWorkspace.targetRun')}</span>
          <select
            value={selectedSession.activeAgentRunId ?? ''}
            onChange={(event) => onSelectAgentRun(event.target.value || undefined)}
          >
            <option value="">{t('agentWorkspace.noRun')}</option>
            {agentRuns.map((run) => (
              <option key={run.agentRunId} value={run.agentRunId}>
                {agentRunTargetLabel(run, snapshot)} · {t(agentRunStatusKey(run.status))}
              </option>
            ))}
          </select>
        </label>
        {activeRun ? (
          <dl>
            <div><dt>{t('agentWorkspace.runId')}</dt><dd>{activeRun.agentRunId}</dd></div>
            <div><dt>{t('agentWorkspace.scope')}</dt><dd>{activeRun.scope.allowedOperationBlockIds.length} Operations · {activeRun.scope.allowedCapabilityIds.length} Capabilities</dd></div>
            <div><dt>{t('agentWorkspace.runtime')}</dt><dd>{binding?.runtimeKind ?? '—'} · {binding?.model ?? '—'}</dd></div>
            <div><dt>{t('agentWorkspace.agentPreset')}</dt><dd>{activeRun.agentPresetSnapshot ? `${activeRun.agentPresetSnapshot.name} · ${activeRun.agentPresetSnapshot.version}` : t('agentWorkspace.noAgentPreset')}</dd></div>
          </dl>
        ) : null}
      </details>
    </article>
  );
};

function agentRunStatusKey(status: AgentRunRecord['status']) {
  return `agentRuntime.status.${status}` as const;
}

function agentRunInterventionTitleKey(kind: AgentRunInterventionKind) {
  return `agentWorkspace.intervention.${kind}.title` as const;
}

function agentRunInterventionBodyKey(kind: AgentRunInterventionKind) {
  return `agentWorkspace.intervention.${kind}.body` as const;
}

function proposalStatusKey(status: ChangeProposalStatus) {
  return `agentWorkspace.proposalStatus.${status}` as const;
}

function trapNarrowWorkspaceFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || !window.matchMedia('(max-width: 640px)').matches) return;
  const focusableElements = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getClientRects().length > 0);
  const first = focusableElements.at(0);
  const last = focusableElements.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function agentRunTargetLabel(run: AgentRunRecord, snapshot: BoardSnapshot): string {
  if (run.target.kind === 'goal') return run.target.goalPlanSnapshot.goal;
  if (run.target.kind === 'capability') {
    return operationBlockLabel(snapshot, run.target.operationBlockId) ?? 'Capability';
  }
  const currentStepLabel = run.currentOperationBlockId
    ? operationBlockLabel(snapshot, run.currentOperationBlockId)
    : undefined;
  if (run.target.kind === 'workflow_run') {
    return currentStepLabel ? `Workflow · ${currentStepLabel}` : 'Workflow';
  }
  const targetStepRunId = run.target.until.kind === 'step'
    ? run.target.until.stepRunId
    : run.target.until.kind === 'artifact'
      ? run.target.until.stepRunId
      : run.target.until.kind === 'gate'
        ? run.target.until.subjectStepRunId
        : undefined;
  const targetStep = targetStepRunId
    ? snapshot.workflowStepRuns?.find((step) => step.stepRunId === targetStepRunId)
    : undefined;
  const targetStepLabel = targetStep
    ? operationBlockLabel(snapshot, targetStep.operationBlockId)
    : undefined;
  if (currentStepLabel || targetStepLabel) {
    return `Workflow · ${currentStepLabel ?? targetStepLabel}`;
  }
  return `Workflow · ${run.target.until.kind}`;
}

function operationBlockLabel(snapshot: BoardSnapshot, blockId: string): string | undefined {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  return typeof block?.data.title === 'string' && block.data.title.trim()
    ? block.data.title.trim()
    : undefined;
}

function ProposalCard({
  agentSessionId,
  isLaunching,
  onDecide,
  onLaunch,
  onSelectLaunchConnection,
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
  onSelectLaunchConnection: (
    blockId: string,
    connectionId: string,
  ) => void;
  onView: (proposalId: string) => void;
  onViewRun: (proposalId: string) => void;
  proposal: ChangeProposalRecord;
  snapshot: BoardSnapshot;
}): ReactElement {
  const { locale, t } = useI18n();
  const [isLaunchReviewOpen, setIsLaunchReviewOpen] = useState(false);
  const [workflowTarget, setWorkflowTarget] = useState<
    Exclude<PackageEntrypointAgentLaunchTarget, { kind: 'capability' }>
  >({ kind: 'workflow_run' });
  const [agentPresetEntryPointId, setAgentPresetEntryPointId] = useState('');
  const providerSettings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );
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
    ? typedEntryPointName(typedInvocation.targetLock.entrypointId, locale)
    : undefined;
  const skillOperation = proposal.appliedEffect?.kind === 'package_entrypoint_draft'
    && proposal.appliedEffect.entrypointKind === 'skill'
    ? snapshot.blocks.find(
        (block) =>
          block.blockId === proposal.appliedEffect?.primaryBlockId
          && block.type === 'operation',
    )
    : undefined;
  const launchOperations = skillOperation
    ? [skillOperation]
    : (proposal.appliedEffect?.createdBlockIds
      .flatMap((blockId) => {
        const block = snapshot.blocks.find(
          (candidate) => candidate.blockId === blockId && candidate.type === 'operation',
        );
        return block ? [block] : [];
      }) ?? []);
  const launchOperation = launchOperations.find(
    (block) => block.data.capabilityId === 'previs.storyboard_sheet.generate',
  ) ?? launchOperations[0];
  const launchConnectionOptions = launchOperations.flatMap((operation) => {
    const capabilityId = typeof operation.data.capabilityId === 'string'
      ? operation.data.capabilityId
      : '';
    const connections = capabilityId
      ? readyAutomatedExecutionConnections({
          capabilityId,
          settings: providerSettings,
        })
      : [];
    return connections.length > 0 ? [{ connections, operation }] : [];
  });
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
    <article className={`agent-workspace-proposal is-${proposal.status}`}>
      <header>
        <strong>{goalPlan
          ? `${t('agentWorkspace.goalPlan')} · ${entrypointName}`
          : typedInvocation
          ? `${entrypointName} · ${typedInvocation.targetLock.entrypointKind}`
          : proposal.kind}</strong>
        <span>{t(proposalStatusKey(proposal.status))}</span>
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
                </div>
              ) : null}
              {launchConnectionOptions.length > 0 ? (
                <div className="agent-workspace-preset-summary">
                  {launchConnectionOptions.map(({ connections, operation }) => {
                    const selectedConnectionId = typeof operation.data.connectionId === 'string'
                      ? operation.data.connectionId
                      : connections[0]?.connectionId ?? '';
                    return (
                      <label key={`launch-connection:${operation.blockId}`}>
                        <span>
                          {operation.data.title} · {t('operationToolbar.generator')}
                        </span>
                        <select
                          value={connections.some(
                            (connection) => connection.connectionId === selectedConnectionId,
                          ) ? selectedConnectionId : connections[0]?.connectionId}
                          onChange={(event) => onSelectLaunchConnection(
                            operation.blockId,
                            event.target.value,
                          )}
                        >
                          {connections.map((connection) => (
                            <option
                              key={connection.connectionId}
                              value={connection.connectionId}
                            >
                              {connection.displayName}
                              {connection.modelId ? ` · ${connection.modelId}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              ) : launchOperation ? (
                <small>
                  {t('operationToolbar.generator')}: {
                    typeof launchOperation.data.connectionId === 'string'
                      ? launchOperation.data.connectionId
                      : '—'
                  } · {typeof launchOperation.data.adapter === 'string'
                    ? launchOperation.data.adapter
                    : '—'}
                </small>
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
  locale: string,
): string {
  const resolution = resolvePackageEntryPoint({ entrypointId });
  if (resolution.status !== 'resolved') return entrypointId;
  if (resolution.target.kind === 'skill') {
    return resolvedSkillUiDefinitionFor(
      resolution.target.skillLock.skillId,
      locale,
    ).name;
  }
  return resolvedWorkflowUiDefinitionFor(
    resolution.target.workflowDefinitionLock.workflowDefinitionId,
    locale,
  ).name;
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
