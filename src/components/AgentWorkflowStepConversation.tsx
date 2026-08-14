import {
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  File,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { getAssetPreviewUrl } from '../core/assetStore';
import type { BoardSnapshot } from '../core/types';
import type {
  WorkflowRunExperienceItemView,
  WorkflowRunExperienceStepView,
} from '../core/workflowRunExperience';
import type { WorkflowStepRunRecord } from '../core/workflowRuntimeContracts';
import { useI18n, type TranslationKey } from '../i18n';

export function AgentWorkflowStepConversation({
  onLocateBlock,
  onRerunOperation,
  onSelectWorkflowOutput,
  run,
  snapshot,
}: {
  onLocateBlock: (blockId: string) => void;
  onRerunOperation: (operationBlockId: string) => void | Promise<void>;
  onSelectWorkflowOutput: (
    stepRunId: string,
    assetId: string,
    expectedStepRunVersion: number,
  ) => void | Promise<void>;
  run?: WorkflowRunExperienceItemView;
  snapshot: BoardSnapshot;
}): ReactElement | null {
  const reachedSteps = useMemo(
    () => run?.steps.filter(
      (step) => step.status !== 'pending' && step.status !== 'blocked',
    ) ?? [],
    [run],
  );
  if (!run || reachedSteps.length === 0) return null;

  return (
    <section
      className="agent-workflow-step-conversation"
      aria-label={run.label}
    >
      {reachedSteps.map((step) => (
        <AgentWorkflowStepMessage
          key={step.stepRunId}
          onLocateBlock={onLocateBlock}
          onRerunOperation={onRerunOperation}
          onSelectWorkflowOutput={onSelectWorkflowOutput}
          snapshot={snapshot}
          step={step}
          stepIndex={run.steps.findIndex((candidate) => candidate.stepRunId === step.stepRunId)}
          totalStepCount={run.totalStepCount}
        />
      ))}
    </section>
  );
}

export function AgentWorkflowStepMessage({
  candidateDecisionPlacement = 'inline',
  onLocateBlock,
  onRerunOperation,
  onSelectWorkflowOutput,
  snapshot,
  step,
  stepIndex,
  totalStepCount,
}: {
  candidateDecisionPlacement?: 'dock' | 'inline';
  onLocateBlock: (blockId: string) => void;
  onRerunOperation: (operationBlockId: string) => void | Promise<void>;
  onSelectWorkflowOutput: (
    stepRunId: string,
    assetId: string,
    expectedStepRunVersion: number,
  ) => void | Promise<void>;
  snapshot: BoardSnapshot;
  step: WorkflowRunExperienceStepView;
  stepIndex: number;
  totalStepCount: number;
}): ReactElement {
  const { t } = useI18n();
  const stepRun = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.stepRunId === step.stepRunId,
  );
  const candidates = candidateViewsForStep(snapshot, stepRun);
  const resultCandidates = stepRun?.acceptedOutputAssetIds.length
    ? candidates.filter((candidate) => stepRun.acceptedOutputAssetIds.includes(candidate.assetId))
    : candidates;
  const [userSelectedCandidateId, setUserSelectedCandidateId] = useState('');
  const selectedCandidateId = candidates.some(
    (candidate) => candidate.assetId === userSelectedCandidateId,
  )
    ? userSelectedCandidateId
    : candidates[0]?.assetId ?? '';
  const [pendingAction, setPendingAction] = useState('');
  const selectedCandidate = candidates.find(
    (candidate) => candidate.assetId === selectedCandidateId,
  );
  const stepNumber = Math.max(1, stepIndex + 1);
  const isWaitingSelection = step.status === 'waiting_selection' && Boolean(stepRun);

  async function acceptCandidate(assetId: string): Promise<void> {
    if (!stepRun || pendingAction) return;
    setPendingAction(`accept:${assetId}`);
    try {
      await onSelectWorkflowOutput(stepRun.stepRunId, assetId, stepRun.recordVersion);
    } finally {
      setPendingAction('');
    }
  }

  async function rerun(): Promise<void> {
    if (pendingAction) return;
    setPendingAction('rerun');
    try {
      await onRerunOperation(step.operationBlockId);
    } finally {
      setPendingAction('');
    }
  }

  return (
    <article className={`agent-workflow-step-message is-${step.role} is-${step.status}${step.freshness === 'outdated' ? ' is-outdated' : ''}`}>
      <span className="agent-workflow-step-avatar" aria-hidden="true">
        {stepStatusIcon(step)}
      </span>
      <div className="agent-workflow-step-message-body">
        <header>
          <span>{`${t('agentWorkspace.workflowStep')} ${stepNumber}/${totalStepCount}`}</span>
          <small>{t(step.freshness === 'outdated'
            ? 'agentWorkspace.workflowAttentionWaiting'
            : workflowStepStatusKey(step.status))}</small>
        </header>
        <strong>{step.label}</strong>
        <p>{t(workflowStepBodyKey(step))}</p>
        {isWaitingSelection ? (
          <div className="agent-workflow-candidate-decision">
            <strong>
              {candidates.length === 1
                ? t('agentWorkspace.workflowCandidateSingle')
                : t('agentWorkspace.workflowCandidateMultiple')}
            </strong>
            {candidateDecisionPlacement === 'inline' && candidates.length > 0 ? (
              <div className={`agent-workflow-candidate-grid${candidates.length === 1 ? ' is-single' : ''}`}>
                {candidates.map((candidate, index) => {
                  const isSelected = candidate.assetId === selectedCandidateId;
                  return (
                    <button
                      key={candidate.assetId}
                      type="button"
                      className={isSelected ? 'is-selected' : undefined}
                      aria-pressed={isSelected}
                      aria-label={`${t('agentWorkspace.workflowCandidate')} ${index + 1}`}
                      disabled={Boolean(pendingAction)}
                      onClick={() => {
                        if (candidates.length === 1) return;
                        setUserSelectedCandidateId(candidate.assetId);
                      }}
                    >
                      {candidate.previewUrl && candidate.kind === 'image' ? (
                        <img src={candidate.previewUrl} alt="" />
                      ) : (
                        <span className="agent-workflow-candidate-fallback">
                          {assetKindIcon(candidate.kind)}
                        </span>
                      )}
                      <span>{index + 1}</span>
                      {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : candidateDecisionPlacement === 'inline' ? (
              <small>{t('agentWorkspace.workflowCandidatePreparing')}</small>
            ) : <small>{t('agentWorkspace.workflowCandidateDockHint')}</small>}
            <div className="agent-workflow-step-actions">
              {candidateDecisionPlacement === 'dock' ? (
                <button
                  type="button"
                  className="is-primary"
                  disabled={candidates.length === 0}
                  onClick={() => onLocateBlock(candidates[0]?.blockId ?? step.operationBlockId)}
                >
                  <ImageIcon size={14} />
                  {t('agentWorkspace.workflowViewCandidates')}
                </button>
              ) : candidates.length === 1 ? (
                <button
                  type="button"
                  className="is-primary"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void acceptCandidate(candidates[0]!.assetId)}
                >
                  <Check size={14} />
                  {t('agentWorkspace.workflowAcceptContinue')}
                </button>
              ) : (
                <button
                  type="button"
                  className="is-primary"
                  disabled={!selectedCandidate || Boolean(pendingAction)}
                  onClick={() => selectedCandidate
                    ? void acceptCandidate(selectedCandidate.assetId)
                    : undefined}
                >
                  <Check size={14} />
                  {t('agentWorkspace.workflowUseCandidate')}
                </button>
              )}
              <button
                type="button"
                disabled={Boolean(pendingAction)}
                onClick={() => void rerun()}
              >
                <RefreshCw size={14} />
                {t('agentWorkspace.workflowRegenerate')}
              </button>
              <button
                type="button"
                disabled={Boolean(pendingAction)}
                onClick={() => onLocateBlock(step.operationBlockId)}
              >
                <MapPin size={14} />
                {t('agentWorkspace.workflowLocateStep')}
              </button>
            </div>
          </div>
        ) : step.status === 'succeeded' && resultCandidates.length > 0 ? (
          <div className="agent-workflow-step-result">
            {resultCandidates.slice(0, 3).map((candidate) => (
              <button
                key={candidate.assetId}
                type="button"
                aria-label={t('agentWorkspace.workflowViewResult')}
                title={t('agentWorkspace.workflowViewResult')}
                onClick={() => onLocateBlock(candidate.blockId ?? step.operationBlockId)}
              >
                {candidate.previewUrl && candidate.kind === 'image' ? (
                  <img src={candidate.previewUrl} alt="" />
                ) : (
                  <span className="agent-workflow-step-result-icon" aria-hidden="true">
                    {assetKindIcon(candidate.kind)}
                  </span>
                )}
              </button>
            ))}
            <small>{t('agentWorkspace.workflowViewResult')}</small>
          </div>
        ) : step.status === 'waiting_input' || step.status === 'failed' || step.status === 'blocked' ? (
          <div className="agent-workflow-step-actions">
            <button type="button" onClick={() => onLocateBlock(step.operationBlockId)}>
              <MapPin size={14} />
              {t('agentWorkspace.workflowLocateStep')}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function candidateViewsForStep(
  snapshot: BoardSnapshot,
  stepRun?: WorkflowStepRunRecord,
): Array<{ assetId: string; blockId?: string; kind: string; previewUrl?: string }> {
  if (!stepRun) return [];
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));
  return stepRun.outputAssetIds.flatMap((assetId) => {
    const asset = assetById.get(assetId);
    if (!asset) return [];
    const outputBlock = stepRun.outputBlockIds
      .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
      .find((block) => block?.data.assetId === assetId)
      ?? snapshot.blocks.find((block) => block.data.assetId === assetId);
    return [{
      assetId,
      ...(outputBlock ? { blockId: outputBlock.blockId } : {}),
      kind: asset.kind,
      previewUrl: getAssetPreviewUrl(snapshot.assets, assetId),
    }];
  });
}

function assetKindIcon(kind: string): ReactElement {
  if (kind === 'document') return <FileText size={22} />;
  if (kind === 'video') return <Film size={22} />;
  if (kind === 'image') return <ImageIcon size={22} />;
  return <File size={22} />;
}

function stepStatusIcon(step: WorkflowRunExperienceStepView): ReactElement {
  if (step.freshness === 'outdated') return <CircleAlert size={14} />;
  if (step.status === 'running' || step.status === 'queued') {
    return <LoaderCircle size={14} className="is-spinning" />;
  }
  if (step.status === 'succeeded' || step.status === 'skipped') {
    return <CheckCircle2 size={14} />;
  }
  if (
    step.status === 'waiting_selection'
    || step.status === 'waiting_input'
    || step.status === 'failed'
    || step.status === 'blocked'
  ) {
    return <CircleAlert size={14} />;
  }
  return <Clock3 size={14} />;
}

function workflowStepStatusKey(status: WorkflowRunExperienceStepView['status']): TranslationKey {
  return `workflowRuntime.stepStatus.${status}` as TranslationKey;
}

function workflowStepBodyKey(step: WorkflowRunExperienceStepView): TranslationKey {
  if (step.freshness === 'outdated') return 'agentWorkspace.workflowStepNeedsAttention';
  if (step.status === 'waiting_selection') return 'agentWorkspace.workflowStepWaitingSelection';
  if (step.status === 'waiting_input') return 'agentWorkspace.workflowStepWaitingInput';
  if (step.status === 'running' || step.status === 'queued') return 'agentWorkspace.workflowStepRunning';
  if (step.status === 'succeeded' || step.status === 'skipped') return 'agentWorkspace.workflowStepSucceeded';
  if (step.status === 'failed' || step.status === 'blocked') return 'agentWorkspace.workflowStepNeedsAttention';
  return 'agentWorkspace.workflowStepReady';
}
