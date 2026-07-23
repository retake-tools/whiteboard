import { Archive, Bot, ChevronDown, CircleStop, Pause, Play, Plus, X } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { messagesForSession, proposalsForSession, runtimeEventsForSession } from '../core/agentSession';
import type {
  AgentRuntimeBindingRecord,
  AgentSessionRecord,
  ChangeProposalRecord,
} from '../core/agentSessionContracts';
import { resolvePackageEntryPoint } from '../core/packageRegistry';
import { skillUiDefinitionFor } from '../core/skillRegistry';
import type { BoardSnapshot } from '../core/types';
import { workflowUiDefinitionFor } from '../core/workflowRegistry';
import { useI18n } from '../i18n';
import { AgentWorkspaceComposer } from './AgentWorkspaceComposer';
import { TooltipIconButton } from './Tooltip';

type AgentWorkspaceTab = 'chat' | 'run' | 'changes';

export function AgentWorkspace({
  binding,
  error,
  isSending,
  onArchiveSession,
  onCancelAgentRun,
  onClose,
  onCreateSession,
  onPauseAgentRun,
  onDecideProposal,
  onResumeAgentRun,
  onSelectAgentRun,
  onSelectSession,
  onSubmitMessage,
  onViewProposalEffect,
  selectedSession,
  sessions,
  snapshot,
}: {
  binding?: AgentRuntimeBindingRecord;
  error?: string;
  isSending: boolean;
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
  onResumeAgentRun: (agentRunId: string) => void;
  onSelectAgentRun: (agentRunId?: string) => void;
  onSelectSession: (agentSessionId: string) => void;
  onSubmitMessage: (input: Parameters<typeof AgentWorkspaceComposer>[0]['onSubmit'] extends (value: infer T) => void ? T : never) => void;
  onViewProposalEffect: (proposalId: string) => void;
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
            {activeRun ? <><dl><div><dt>{t('agentWorkspace.runId')}</dt><dd>{activeRun.agentRunId}</dd></div><div><dt>{t('agentWorkspace.status')}</dt><dd>{activeRun.status}</dd></div><div><dt>{t('agentWorkspace.scope')}</dt><dd>{activeRun.scope.allowedOperationBlockIds.length} Operations · {activeRun.scope.allowedCapabilityIds.length} Capabilities</dd></div><div><dt>{t('agentWorkspace.runtime')}</dt><dd>{binding?.runtimeKind ?? '—'} · {binding?.model ?? '—'}</dd></div></dl><div className="agent-workspace-run-actions">{activeRun.status === 'paused' ? <button type="button" onClick={() => onResumeAgentRun(activeRun.agentRunId)}><Play size={14} />{t('agentRuntime.resume')}</button> : <button type="button" disabled={['succeeded', 'failed', 'canceled'].includes(activeRun.status)} onClick={() => onPauseAgentRun(activeRun.agentRunId)}><Pause size={14} />{t('agentRuntime.pause')}</button>}<button type="button" disabled={['succeeded', 'failed', 'canceled'].includes(activeRun.status)} onClick={() => onCancelAgentRun(activeRun.agentRunId)}><CircleStop size={14} />{t('agentRuntime.cancel')}</button></div></> : <p className="agent-workspace-placeholder">{t('agentWorkspace.runEmpty')}</p>}
          </div>
        ) : (
          <div className="agent-workspace-changes">
            {proposals.length === 0
              ? <p className="agent-workspace-placeholder">{t('agentWorkspace.changesEmpty')}</p>
              : proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.proposalId}
                    proposal={proposal}
                    onDecide={onDecideProposal}
                    onView={onViewProposalEffect}
                  />
                ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ProposalCard({
  onDecide,
  onView,
  proposal,
}: {
  onDecide: (
    proposalId: string,
    expectedProposalVersion: number,
    decision: 'approve' | 'reject',
  ) => void;
  onView: (proposalId: string) => void;
  proposal: ChangeProposalRecord;
}): ReactElement {
  const { t } = useI18n();
  const command = proposal.proposedCommand;
  const typedInvocation = command.kind === 'package_entrypoint.instantiate' ? command.invocation : undefined;
  const entrypointName = typedInvocation
    ? typedEntryPointName(typedInvocation.targetLock.entrypointId, t)
    : undefined;
  return (
    <article className={`is-${proposal.status}`}>
      <header>
        <strong>{typedInvocation
          ? `${entrypointName} · ${typedInvocation.targetLock.entrypointKind}`
          : proposal.kind}</strong>
        <span>{proposal.status}</span>
      </header>
      <p>{proposal.summary}</p>
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
        <button className="agent-workspace-view-effect" type="button" onClick={() => onView(proposal.proposalId)}>
          {t('agentWorkspace.viewOnCanvas')}
        </button>
      ) : null}
    </article>
  );
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
  if (ref.kind === 'block') return `@Block ${ref.blockId.slice(-8)}`;
  return `@Asset ${ref.assetId.slice(-8)}`;
}
