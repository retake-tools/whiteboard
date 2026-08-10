import { Activity, Bot, CircleAlert, CircleStop, MapPin, Pause, Play } from 'lucide-react';
import {
  useEffect,
  useMemo,
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
import {
  messagesForSession,
  proposalsForSession,
  workflowRunIdsForAgentSession,
} from '../core/agentSession';
import type {
  AgentDraftLaunchTarget,
  AgentRuntimeBindingRecord,
  AgentSessionRecord,
  ChangeProposalRecord,
  ChangeProposalStatus,
  PackageEntrypointAgentLaunchTarget,
  WorkflowLaunchPreferences,
} from '../core/agentSessionContracts';
import type { AgentRunRecord, WorkflowInteractionMode } from '../core/agentRuntimeContracts';
import {
  agentConversationTimeline,
  workflowTaskSummary,
} from '../core/agentConversationTimeline';
import {
  agentRunInterventionFor,
  type AgentRunInterventionKind,
} from '../core/agentRunIntervention';
import { isResolvedAgentRunBlockerProposal } from '../core/agentChangeApplication';
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
import { CanvasExecutionActivity } from './CanvasExecutionActivity';
import { AgentWorkspaceComposer } from './AgentWorkspaceComposer';
import { AgentWorkspaceHeader } from './AgentWorkspaceHeader';
import { AgentWorkflowRunNavigator } from './AgentWorkflowRunNavigator';
import { AgentWorkflowApprovalMessage } from './AgentWorkflowApprovalMessage';
import { AgentWorkflowAttentionMessage } from './AgentWorkflowAttentionMessage';
import { AgentWorkflowStepMessage } from './AgentWorkflowStepConversation';
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
import { useUnifiedComposerDraft } from './UnifiedComposerProvider';
import { workflowRunExperienceFor } from '../core/workflowRunExperience';
import {
  imageGenerateAspectRatioPresets,
  imageGenerateCapabilityId,
  imageGenerateResolutionPresets,
} from '../core/imageGenerateContracts';

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
  onDecideWorkflowApproval,
  onPauseAgentRun,
  onDecideProposal,
  onLaunchProposal,
  onLocateBlock,
  onOpenWorkflowRun,
  onPrepareWorkflowReview,
  onResumeAgentRun,
  onRequestCanvasMode,
  onRenameSession,
  onRerunOperation,
  onRetryAgentRun,
  onSelectLaunchConnection,
  onSelectAgentRun,
  onSelectWorkflowOutput,
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
  onDecideWorkflowApproval: (
    approvalRequestId: string,
    expectedApprovalRequestVersion: number,
    decision: 'approve' | 'reject',
  ) => void | Promise<void>;
  onPauseAgentRun: (agentRunId: string) => void;
  onDecideProposal: (
    proposalId: string,
    expectedProposalVersion: number,
    decision: 'approve' | 'reject',
    workflowPreferences?: WorkflowLaunchPreferences,
  ) => void | Promise<void>;
  onLaunchProposal: (
    proposalId: string,
    expectedProposalVersion: number,
    target: AgentDraftLaunchTarget,
    agentPresetEntryPointId?: string,
  ) => void;
  onLocateBlock: (blockId: string) => void;
  onOpenWorkflowRun: (workflowRunId: string) => void;
  onPrepareWorkflowReview: (stepRunId: string) => void | Promise<void>;
  onResumeAgentRun: (agentRunId: string) => void;
  onRequestCanvasMode: () => void;
  onRenameSession: (title: string) => boolean;
  onRerunOperation: (operationBlockId: string) => void | Promise<void>;
  onRetryAgentRun: (agentRunId: string, retryExecutionId?: string) => void | Promise<void>;
  onSelectLaunchConnection: (
    blockId: string,
    connectionId: string,
  ) => void;
  onSelectAgentRun: (agentRunId?: string) => void;
  onSelectWorkflowOutput: (
    stepRunId: string,
    assetId: string,
    expectedStepRunVersion: number,
  ) => void | Promise<void>;
  onSelectSession: (agentSessionId: string) => void;
  onSubmitMessage: (input: Parameters<typeof AgentWorkspaceComposer>[0]['onSubmit'] extends (value: infer T) => void ? T : never) => void;
  onViewProposalEffect: (proposalId: string) => void;
  onViewProposalRun: (proposalId: string) => void;
  selectedSession?: AgentSessionRecord;
  sessions: AgentSessionRecord[];
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const { agentPreferences, reset: resetComposer } = useUnifiedComposerDraft();
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
  const visibleProposals = proposals.filter(
    (proposal) =>
      proposal.status !== 'superseded'
      &&
      !isResolvedAgentRunBlockerProposal(snapshot, proposal)
      && (proposal.status !== 'applied' || !proposal.draftLaunchEffect),
  );
  const agentRuns = [...(snapshot.agentRuns ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeRun = selectedSession?.activeAgentRunId
    ? agentRuns.find((run) => run.agentRunId === selectedSession.activeAgentRunId)
    : undefined;
  const activeWorkflowRunIds = activeRun && activeRun.target.kind !== 'capability'
    ? [activeRun.target.workflowRunId]
    : [];
  const agentIsWorking = isSending
    || activeRun?.status === 'queued'
    || activeRun?.status === 'running';
  const sessionWorkflowRunIds = selectedSession
    ? workflowRunIdsForAgentSession(snapshot, selectedSession.agentSessionId)
    : [];
  const workflowExperience = useMemo(
    () => workflowRunExperienceFor(snapshot, activeRun, {
      workflowRunIds: sessionWorkflowRunIds,
    }),
    [activeRun, sessionWorkflowRunIds.join('\u0000'), snapshot],
  );
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] = useState('');
  const selectedWorkflowRun = workflowExperience.runs.find(
    (run) => run.workflowRunId === selectedWorkflowRunId,
  ) ?? workflowExperience.runs[0];
  const activeIntervention = useMemo(
    () => activeRun ? agentRunInterventionFor(snapshot, activeRun) : undefined,
    [activeRun, snapshot],
  );
  const conversationTimeline = useMemo(
    () => agentConversationTimeline({
      intervention: activeRun
        && activeIntervention
        && activeRun.target.kind !== 'capability'
        && (
          activeIntervention.kind === 'approval'
          || activeIntervention.kind === 'attention'
        ) ? {
          agentRunId: activeRun.agentRunId,
          kind: activeIntervention.kind,
          occurredAt: activeIntervention.occurredAt,
        } : undefined,
      messages,
      run: activeRun?.target.kind === 'capability' ? undefined : selectedWorkflowRun,
      stepRuns: snapshot.workflowStepRuns ?? [],
    }),
    [activeIntervention, activeRun, messages, selectedWorkflowRun, snapshot.workflowStepRuns],
  );
  const taskSummary = useMemo(
    () => workflowTaskSummary(messages, activeRun),
    [activeRun, messages],
  );
  const pendingProposalCount = visibleProposals.filter(
    (proposal) => proposal.status === 'awaiting_decision',
  ).length;
  const sourceMessageIdsWithReply = new Set(
    messages.flatMap((message) => message.sourceMessageId ? [message.sourceMessageId] : []),
  );
  const orphanProposals = visibleProposals.filter(
    (proposal) => !sourceMessageIdsWithReply.has(proposal.sourceMessageId),
  );
  const runtimeConnection = currentExecutionProviderSettings()?.connections.find(
    (connection) => connection.connectionId === binding?.connectionId,
  );

  useEffect(() => {
    if (focusedAgentRunId) runCardRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusedAgentRunId]);

  useEffect(() => {
    setSelectedWorkflowRunId(workflowExperience.defaultWorkflowRunId ?? '');
  }, [selectedSession?.agentSessionId, workflowExperience.defaultWorkflowRunId]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: 'end' });
  }, [
    activeIntervention?.locateBlockId,
    activeRun?.status,
    isSending,
    messages.length,
    proposals.length,
    selectedSession?.agentSessionId,
  ]);

  function submitSuggestedMessage(content: string, sourceMessageId?: string): void {
    if (isSending || !content.trim()) return;
    const operationBlockId = exactOperationIdInSuggestion(snapshot, content);
    onSubmitMessage({
      agentPreferences,
      content: content.trim(),
      imageReferenceSettings: {},
      inlineValues: [],
      mentions: [],
      parameters: {},
      ...(sourceMessageId ? {
        suggestionAction: {
          sourceMessageId,
          ...(operationBlockId ? { operationBlockId } : {}),
        },
      } : {}),
    });
    resetComposer();
  }

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
        snapshot={snapshot}
      />
      {selectedSession
      && (activeRun?.target.kind === 'capability' || pendingProposalCount > 0) ? (
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
            {workflowExperience.runs.length > 0 ? (
              <AgentWorkflowRunNavigator
                activeAgentRun={activeRun}
                experience={workflowExperience}
                onCancelAgentRun={onCancelAgentRun}
                onOpenWorkflowRun={onOpenWorkflowRun}
                onPauseAgentRun={onPauseAgentRun}
                onResumeAgentRun={onResumeAgentRun}
                onSelectWorkflowRun={setSelectedWorkflowRunId}
                selectedWorkflowRunId={selectedWorkflowRun?.workflowRunId ?? ''}
                taskSummary={taskSummary}
              />
            ) : null}
            <div
              className="agent-workspace-messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {messages.length === 0 && visibleProposals.length === 0 && !activeRun
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
                          disabled={isSending}
                          onClick={() => submitSuggestedMessage(prompt)}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )
                : null}
              {conversationTimeline.map((timelineItem) => {
                if (timelineItem.kind === 'workflow_step') {
                  const step = selectedWorkflowRun?.steps.find(
                    (candidate) => candidate.stepRunId === timelineItem.stepRunId,
                  );
                  if (!step || !selectedWorkflowRun) return null;
                  return (
                    <div key={timelineItem.itemId} className="agent-workspace-timeline-item">
                      <AgentWorkflowStepMessage
                        onLocateBlock={onLocateBlock}
                        onRerunOperation={onRerunOperation}
                        onSelectWorkflowOutput={onSelectWorkflowOutput}
                        snapshot={snapshot}
                        step={step}
                        stepIndex={selectedWorkflowRun.steps.findIndex(
                          (candidate) => candidate.stepRunId === step.stepRunId,
                        )}
                        totalStepCount={selectedWorkflowRun.totalStepCount}
                      />
                    </div>
                  );
                }
                if (timelineItem.kind === 'intervention') {
                  if (
                    !activeRun
                    || timelineItem.agentRunId !== activeRun.agentRunId
                    || timelineItem.interventionKind !== activeIntervention?.kind
                  ) return null;
                  return (
                    <div key={timelineItem.itemId} className="agent-workspace-timeline-item">
                      {activeIntervention.kind === 'approval' ? (
                        <AgentWorkflowApprovalMessage
                          agentRunId={activeRun.agentRunId}
                          intervention={activeIntervention}
                          onCancelAgentRun={onCancelAgentRun}
                          onDecideWorkflowApproval={onDecideWorkflowApproval}
                          onLocateBlock={onLocateBlock}
                        />
                      ) : (
                        <AgentWorkflowAttentionMessage
                          agentRunId={activeRun.agentRunId}
                          canRetry={
                            activeRun.stopReason === 'operation_execution_missing'
                            || Boolean(activeIntervention.retryExecutionId)
                          }
                          intervention={activeIntervention}
                          onLocateBlock={onLocateBlock}
                          onPrepareWorkflowReview={onPrepareWorkflowReview}
                          onRequestAgentHelp={() => submitSuggestedMessage(
                            t('agentWorkspace.workflowAttentionAskAgentPrompt'),
                          )}
                          onRetryAgentRun={onRetryAgentRun}
                          retryResultCount={activeIntervention.retryableResultBlockIds?.length}
                        />
                      )}
                    </div>
                  );
                }
                const message = messages.find(
                  (candidate) => candidate.agentMessageId === timelineItem.messageId,
                );
                if (!message) return null;
                const messageProposals = message.role === 'assistant' && message.sourceMessageId
                  ? visibleProposals.filter((proposal) => proposal.sourceMessageId === message.sourceMessageId)
                  : [];
                const messageHasSupersededProposal = message.role === 'assistant'
                  && Boolean(message.sourceMessageId)
                  && proposals.some((proposal) =>
                    proposal.sourceMessageId === message.sourceMessageId
                    && (
                      proposal.status === 'superseded'
                      || isResolvedAgentRunBlockerProposal(snapshot, proposal)
                    ));
                const operationReceipt = message.role === 'assistant'
                  ? message.contextRefs.find((ref) => ref.kind === 'operation_receipt')
                  : undefined;
                return (
                  <div key={timelineItem.itemId} className="agent-workspace-timeline-item">
                    <AgentMessageCard message={message} />
                    {message.role === 'assistant'
                      && message.suggestions?.length
                      && !messageHasSupersededProposal ? (
                      <div className="agent-workspace-suggestions" aria-label={t('agentWorkspace.suggestions')}>
                        {message.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            disabled={isSending}
                            onClick={() => submitSuggestedMessage(
                              suggestion,
                              message.agentMessageId,
                            )}
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
              {activeRun?.target.kind === 'capability' ? (
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
              <div ref={timelineEndRef} aria-hidden="true" />
            </div>
            {error ? <p className="agent-workspace-error" role="alert">{error}</p> : null}
            <CanvasExecutionActivity
              agentExecutionIds={activeRun?.executionIds}
              agentRunId={activeRun?.agentRunId}
              agentIsWorking={agentIsWorking}
              agentStartedAt={activeRun?.updatedAt}
              onLocateBlock={onLocateBlock}
              snapshot={snapshot}
              workflowRunIds={activeWorkflowRunIds}
              workingOperationBlockId={selectedSession.workingOperation?.operationBlockId}
            />
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

function exactOperationIdInSuggestion(
  snapshot: BoardSnapshot,
  suggestion: string,
): string | undefined {
  const matches = snapshot.blocks.filter(
    (block) => block.type === 'operation' && suggestion.includes(block.blockId),
  );
  return matches.length === 1 ? matches[0]?.blockId : undefined;
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
    workflowPreferences?: WorkflowLaunchPreferences,
  ) => void | Promise<void>;
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
  const isRecommendedSkill = proposal.kind === 'plan_skill'
    && typedInvocation?.targetLock.entrypointKind === 'skill';
  const workflowDefinition = workflowDefinitionId
    ? listWorkflows().find((definition) => definition.workflowId === workflowDefinitionId)
    : undefined;
  const conceptStep = workflowDefinition?.steps.find((step) => (
    step.capabilityLock.capabilityId === imageGenerateCapabilityId
    && step.outputAcceptancePolicy === 'manual_single'
  ));
  const hasImageSteps = workflowDefinition?.steps.some(
    (step) => step.capabilityLock.capabilityId === imageGenerateCapabilityId,
  ) ?? false;
  const workflowLaunchParameters = proposal.workflowLaunchParameters
    ?? typedInvocation?.parameters;
  const imageConnections = readyAutomatedExecutionConnections({
    capabilityId: imageGenerateCapabilityId,
    settings: providerSettings,
  });
  const [workflowInteractionMode, setWorkflowInteractionMode] = useState<WorkflowInteractionMode>(
    proposal.workflowInteractionMode ?? 'automatic',
  );
  const [conceptVariationCount, setConceptVariationCount] = useState<1 | 2 | 3 | 4>(() => (
    workflowConceptVariationCount(workflowLaunchParameters, conceptStep?.stepId)
    ?? workflowConceptVariationCount(conceptStep?.defaultParameters)
    ?? 1
  ));
  const [workflowImageConnectionId, setWorkflowImageConnectionId] = useState(() => (
    stringParameter(workflowLaunchParameters, 'connectionId') ?? ''
  ));
  const [workflowAspectRatio, setWorkflowAspectRatio] = useState(() => (
    stringParameter(workflowLaunchParameters, 'aspectRatioPreset') ?? ''
  ));
  const [workflowResolution, setWorkflowResolution] = useState(() => (
    stringParameter(workflowLaunchParameters, 'targetResolution') ?? ''
  ));
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
          ? `${t('agentWorkspace.recommendedWorkflow')} · ${entrypointName}`
          : isRecommendedSkill
          ? `${t('agentWorkspace.recommendedSkill')} · ${entrypointName}`
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
            <dt>{t('agentWorkspace.workflowStepCount')}</dt>
            <dd>{goalPlan.steps.length}</dd>
          </div>
          {goalPlan.limitations.map((limitation) => (
            <div key={limitation}>
              <dt>{t('agentWorkspace.limitation')}</dt>
              <dd>{limitation}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {goalPlan && proposal.status === 'awaiting_decision' ? (
        <p className="agent-workspace-workflow-confirm-hint">
          {t('agentWorkspace.workflowConfirmHint')}
        </p>
      ) : null}
      {isRecommendedSkill && proposal.status === 'awaiting_decision' ? (
        <p className="agent-workspace-workflow-confirm-hint">
          {t('agentWorkspace.skillConfirmHint')}
        </p>
      ) : null}
      {isWorkflowEntrypoint && proposal.status === 'awaiting_decision' ? (
        <section className="agent-workspace-workflow-launch-settings">
          <div className="agent-workspace-workflow-mode" role="group" aria-label={t('skillComposer.workflowExecutionMode')}>
            <button
              type="button"
              className={workflowInteractionMode === 'automatic' ? 'is-selected' : undefined}
              aria-pressed={workflowInteractionMode === 'automatic'}
              onClick={() => setWorkflowInteractionMode('automatic')}
            >
              <strong>{t('skillComposer.workflowAutomatic')}</strong>
              <span>{t('agentWorkspace.workflowAutomaticDescription')}</span>
            </button>
            <button
              type="button"
              className={workflowInteractionMode === 'manual' ? 'is-selected' : undefined}
              aria-pressed={workflowInteractionMode === 'manual'}
              onClick={() => setWorkflowInteractionMode('manual')}
            >
              <strong>{t('skillComposer.workflowManual')}</strong>
              <span>{t('agentWorkspace.workflowManualDescription')}</span>
            </button>
          </div>
          {hasImageSteps ? <div className="agent-workspace-workflow-image-settings">
            {conceptStep ? (
              <label>
                <span>{t('agentWorkspace.conceptCandidateCount')}</span>
                <select
                  value={conceptVariationCount}
                  onChange={(event) => setConceptVariationCount(Number(event.target.value) as 1 | 2 | 3 | 4)}
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <span>{t('skillComposer.imageExecutionConnection')}</span>
              <select
                value={workflowImageConnectionId}
                onChange={(event) => setWorkflowImageConnectionId(event.target.value)}
              >
                <option value="">{t('skillComposer.followWorkspaceDefault')}</option>
                {imageConnections.map((connection) => (
                  <option key={connection.connectionId} value={connection.connectionId}>
                    {connection.displayName}{connection.modelId ? ` · ${connection.modelId}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('skillComposer.aspectRatio')}</span>
              <select
                value={workflowAspectRatio}
                onChange={(event) => setWorkflowAspectRatio(event.target.value)}
              >
                <option value="">{t('skillComposer.useModelDefault')}</option>
                {imageGenerateAspectRatioPresets.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('skillComposer.resolution')}</span>
              <select
                value={workflowResolution}
                onChange={(event) => setWorkflowResolution(event.target.value)}
              >
                <option value="">{t('skillComposer.useConnectionDefault')}</option>
                {imageGenerateResolutionPresets.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div> : null}
          {workflowInteractionMode === 'automatic' && conceptVariationCount > 1 ? (
            <p>{t('agentWorkspace.workflowMultipleCandidatesPause')}</p>
          ) : null}
        </section>
      ) : null}
      {typedInvocation ? (
        isRecommendedSkill || goalPlan ? null : <dl className="agent-workspace-proposal-details">
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
      {typedInvocation && !goalPlan && !isWorkflowEntrypoint && !isRecommendedSkill
        && proposal.status === 'awaiting_decision'
        ? <p className="agent-workspace-draft-only">{t('agentWorkspace.draftOnly')}</p>
        : null}
      {proposal.applyError ? <p className="agent-workspace-error">{proposal.applyError}</p> : null}
      {proposal.status === 'awaiting_decision' ? (
        <div className="agent-workspace-proposal-actions">
          <button
            type="button"
            disabled={command.kind === 'unsupported'}
            onClick={() => onDecide(
              proposal.proposalId,
              proposal.recordVersion,
              'approve',
              isWorkflowEntrypoint ? {
                ...(hasImageSteps ? {
                  aspectRatioPreset: workflowAspectRatio || undefined,
                  connectionId: workflowImageConnectionId || undefined,
                  targetResolution: workflowResolution || undefined,
                } : {}),
                ...(conceptStep ? {
                  conceptStepId: conceptStep.stepId,
                  conceptVariationCount,
                } : {}),
                interactionMode: workflowInteractionMode,
              } : undefined,
            )}
          >
            {isWorkflowEntrypoint
              ? t('agentWorkspace.useWorkflow')
              : isRecommendedSkill
              ? t('agentWorkspace.useSkill')
              : t('agentWorkspace.approveProposal')}
          </button>
          <button
            type="button"
            onClick={() => onDecide(proposal.proposalId, proposal.recordVersion, 'reject')}
          >
            {goalPlan
              ? t('agentWorkspace.skipWorkflow')
              : isRecommendedSkill
              ? t('agentWorkspace.skipSkill')
              : t('agentWorkspace.rejectProposal')}
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

function workflowConceptVariationCount(
  parameters: Record<string, unknown> | undefined,
  stepId?: string,
): 1 | 2 | 3 | 4 | undefined {
  if (!parameters) return undefined;
  if (stepId) {
    const rawOverrides = parameters.stepParameterOverrides;
    if (rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
      const rawStep = (rawOverrides as Record<string, unknown>)[stepId];
      if (rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep)) {
        const value = (rawStep as Record<string, unknown>).variationCount;
        if (isWorkflowCandidateCount(value)) return value;
      }
    }
  }
  const value = parameters.variationCount;
  return isWorkflowCandidateCount(value) ? value : undefined;
}

function isWorkflowCandidateCount(value: unknown): value is 1 | 2 | 3 | 4 {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 4;
}

function stringParameter(
  parameters: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = parameters?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function inlineValueSummary(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
