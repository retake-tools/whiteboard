import { Bot, Check, ChevronLeft, ChevronRight, CirclePause, Download, ImageIcon, Layers3, Play, Square, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { directGroupChildren, descendantBlockIds, groupMediaItems, type GroupMediaItem } from '../core/grouping';
import type { BlockRecord, BoardSnapshot, GroupKind } from '../core/types';
import type {
  WorkflowGateDefinitionLock,
  WorkflowStepRunRecord,
} from '../core/workflowRuntimeContracts';
import {
  workflowRunViewForGroup,
  workflowRunViewForId,
  type WorkflowRunRuntimeView,
} from '../core/workflowRuntime';
import type { WorkflowApprovalDecisionValue } from '../core/workflowGateContracts';
import {
  workflowGateViewsForRun,
  type WorkflowGateRuntimeView,
} from '../core/workflowGateRuntime';
import { latestAgentRunForWorkflowRun, type AgentRunRuntimeView } from '../core/agentRuntime';
import type { AgentWorkflowGateCompletion } from '../core/agentRuntimeContracts';
import type { PackageEntrypointAgentLaunchTarget } from '../core/agentSessionContracts';
import { useI18n } from '../i18n';
import {
  ExecutionDetailContent,
  getExecutionDetailContextForExecution,
  type ExecutionDetailCopySource,
} from './ExecutionDetailContent';
import { TooltipIconButton } from './Tooltip';
import { WorkflowAgentTargetPicker } from './WorkflowAgentTargetPicker';

interface CopyPromptInput {
  blockIds?: string[];
  copyKey: string;
  executionId?: string;
  prompt: string;
  source: ExecutionDetailCopySource;
}

interface GroupInspectorProps {
  copiedPromptKey?: string;
  group?: BlockRecord;
  snapshot: BoardSnapshot;
  onClose: () => void;
  onCopyPrompt: (input: CopyPromptInput) => void | Promise<void>;
  onCancelAgentRun: (agentRunId: string) => void;
  onCreateWorkflowArtifactSliceAgentRun: (
    workflowRunId: string,
    workflowOutputSlotId: string,
  ) => void;
  onCreateWorkflowAgentRun: (workflowRunId: string) => void;
  onCreateWorkflowGateSliceAgentRun: (
    workflowRunId: string,
    gateId: string,
    completion: AgentWorkflowGateCompletion,
  ) => void;
  onCreateWorkflowSliceAgentRun: (workflowRunId: string, stepRunId: string) => void;
  onCreateWorkflowStageSliceAgentRun: (workflowRunId: string, stageId: string) => void;
  onDecideWorkflowApproval: (
    approvalRequestId: string,
    expectedApprovalRequestVersion: number,
    decision: WorkflowApprovalDecisionValue,
  ) => void;
  onDownloadAll: (groupId: string) => void;
  onPauseAgentRun: (agentRunId: string) => void;
  onResumeAgentRun: (agentRunId: string) => void;
  onSelectWorkflowOutput: (stepRunId: string, assetId: string, expectedStepRunVersion: number) => void;
}

export function GroupInspector({
  copiedPromptKey,
  group,
  snapshot,
  onClose,
  onCopyPrompt,
  onCancelAgentRun,
  onCreateWorkflowArtifactSliceAgentRun,
  onCreateWorkflowAgentRun,
  onCreateWorkflowGateSliceAgentRun,
  onCreateWorkflowSliceAgentRun,
  onCreateWorkflowStageSliceAgentRun,
  onDecideWorkflowApproval,
  onDownloadAll,
  onPauseAgentRun,
  onResumeAgentRun,
  onSelectWorkflowOutput,
}: GroupInspectorProps): ReactElement | null {
  const { t } = useI18n();
  const [selectedBlockId, setSelectedBlockId] = useState<string | undefined>();
  const groupId = group?.type === 'group' ? group.blockId : undefined;
  const mediaItems = useMemo(
    () => (groupId ? groupMediaItems(snapshot, groupId) : []),
    [groupId, snapshot.assets, snapshot.blocks],
  );
  const selectedIndex = Math.max(0, mediaItems.findIndex((item) => item.block.blockId === selectedBlockId));
  const selectedItem = mediaItems[selectedIndex];
  const firstMediaBlockId = mediaItems[0]?.block.blockId;
  const directItemCount = groupId ? directGroupChildren(snapshot, groupId).length : 0;
  const descendantCount = groupId ? descendantBlockIds(snapshot, [groupId]).length : 0;
  const executionId = typeof group?.data.groupExecutionId === 'string' ? group.data.groupExecutionId : undefined;
  const execution = executionId
    ? snapshot.executions.find((candidate) => candidate.executionId === executionId)
    : undefined;
  const outputSelectionStep = execution?.stepRunId
    ? (snapshot.workflowStepRuns ?? []).find((candidate) => candidate.stepRunId === execution.stepRunId)
    : undefined;
  const executionContext = execution ? getExecutionDetailContextForExecution(snapshot, execution) : undefined;
  const workflowRun = groupId
    ? workflowRunViewForGroup(snapshot, groupId)
      ?? (execution?.workflowRunId ? workflowRunViewForId(snapshot, execution.workflowRunId) : undefined)
    : undefined;
  const agentRun = workflowRun ? latestAgentRunForWorkflowRun(snapshot, workflowRun.record.workflowRunId) : undefined;
  const gateViews = workflowRun
    ? workflowGateViewsForRun(snapshot, workflowRun.record.workflowRunId)
    : [];

  useEffect(() => {
    setSelectedBlockId(firstMediaBlockId);
  }, [firstMediaBlockId, groupId]);

  useEffect(() => {
    if (!groupId) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        onClose();
      }
      if (event.key === 'ArrowLeft') {
        event.stopImmediatePropagation();
        setSelectedBlockId((current) => siblingBlockId(mediaItems, current, -1));
      }
      if (event.key === 'ArrowRight') {
        event.stopImmediatePropagation();
        setSelectedBlockId((current) => siblingBlockId(mediaItems, current, 1));
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [groupId, mediaItems, onClose]);

  if (!group || group.type !== 'group') return null;

  return (
    <div className="execution-inspector-backdrop" role="presentation" onClick={onClose}>
      <section
        className="execution-inspector group-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={t('group.browserTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{t('group.browserTitle')}</span>
            <strong>{group.data.title}</strong>
          </div>
          <div className="execution-inspector-header-actions">
            {mediaItems.length > 0 ? (
              <span className="execution-result-counter">
                {selectedIndex + 1} / {mediaItems.length}
              </span>
            ) : null}
            <TooltipIconButton
              disabled={mediaItems.length === 0}
              label={t('group.downloadAssets')}
              onClick={() => onDownloadAll(group.blockId)}
            >
              <Download size={17} />
            </TooltipIconButton>
            <TooltipIconButton label={t('group.closeBrowser')} onClick={onClose}>
              <X size={17} />
            </TooltipIconButton>
          </div>
        </header>

        <div className="execution-inspector-layout">
          <section className="execution-result-viewer" aria-label={t('group.media')}>
            <div className="execution-result-stage">
              {selectedItem ? (
                <GroupMedia item={selectedItem} />
              ) : (
                <div className="execution-result-empty">
                  <Layers3 size={28} />
                  <span>{t('group.noMedia')}</span>
                </div>
              )}
              {mediaItems.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="execution-result-navigation is-previous"
                    aria-label={t('inspector.previousPreview')}
                    onClick={() => setSelectedBlockId(siblingBlockId(mediaItems, selectedBlockId, -1))}
                  >
                    <ChevronLeft size={26} />
                  </button>
                  <button
                    type="button"
                    className="execution-result-navigation is-next"
                    aria-label={t('inspector.nextPreview')}
                    onClick={() => setSelectedBlockId(siblingBlockId(mediaItems, selectedBlockId, 1))}
                  >
                    <ChevronRight size={26} />
                  </button>
                </>
              ) : null}
            </div>
            {mediaItems.length > 1 ? (
              <div className="execution-result-thumbnails">
                {mediaItems.map((item, index) => (
                  <button
                    key={item.block.blockId}
                    type="button"
                    className={[
                      item.block.blockId === selectedItem?.block.blockId ? 'is-selected' : '',
                      outputSelectionStep?.acceptedOutputAssetIds.includes(item.asset.assetId) ? 'is-accepted' : '',
                    ].filter(Boolean).join(' ') || undefined}
                    aria-label={[
                      `${item.block.data.title} ${index + 1}`,
                      outputSelectionStep?.acceptedOutputAssetIds.includes(item.asset.assetId)
                        ? t('workflowRuntime.selectedOutput')
                        : '',
                    ].filter(Boolean).join(', ')}
                    onClick={() => setSelectedBlockId(item.block.blockId)}
                  >
                    {item.asset.kind === 'video' ? (
                      <span className="group-media-video-thumbnail"><Video size={20} /></span>
                    ) : (
                      <img src={item.asset.previewUrl} alt="" />
                    )}
                    <span>{index + 1}</span>
                    {outputSelectionStep?.acceptedOutputAssetIds.includes(item.asset.assetId) ? (
                      <span className="execution-result-selected-mark" aria-hidden="true"><Check size={11} /></span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="execution-inspector-details">
            <GroupSummary
              descendantCount={descendantCount}
              directItemCount={directItemCount}
              agentRun={agentRun}
              gateViews={gateViews}
              group={group}
              mediaCount={mediaItems.length}
              selectedItem={selectedItem}
              snapshot={snapshot}
              workflowRun={workflowRun}
              onCancelAgentRun={onCancelAgentRun}
              onCreateWorkflowArtifactSliceAgentRun={onCreateWorkflowArtifactSliceAgentRun}
              onCreateWorkflowAgentRun={onCreateWorkflowAgentRun}
              onCreateWorkflowGateSliceAgentRun={onCreateWorkflowGateSliceAgentRun}
              onCreateWorkflowSliceAgentRun={onCreateWorkflowSliceAgentRun}
              onCreateWorkflowStageSliceAgentRun={onCreateWorkflowStageSliceAgentRun}
              onDecideWorkflowApproval={onDecideWorkflowApproval}
              onPauseAgentRun={onPauseAgentRun}
              onResumeAgentRun={onResumeAgentRun}
              onSelectWorkflowOutput={onSelectWorkflowOutput}
              outputSelectionStep={outputSelectionStep}
            />
            {executionContext ? (
              <ExecutionDetailContent
                context={executionContext}
                copiedPromptKey={copiedPromptKey}
                copyKey={`group-inspector:${executionContext.execution.executionId}`}
                copySource="group_inspector"
                onCopyPrompt={onCopyPrompt}
                onSelectAsset={(asset) => {
                  const item = mediaItems.find((candidate) => candidate.asset.assetId === asset.assetId);
                  if (item) setSelectedBlockId(item.block.blockId);
                }}
              />
            ) : null}
          </aside>
        </div>
      </section>
    </div>
  );
}

function GroupMedia({ item }: { item: GroupMediaItem }): ReactElement {
  if (item.asset.kind === 'video') {
    return <video src={item.asset.previewUrl} aria-label={item.block.data.title} controls preload="metadata" />;
  }
  return <img src={item.asset.previewUrl} alt={item.block.data.title} />;
}

function GroupSummary({
  agentRun,
  descendantCount,
  directItemCount,
  gateViews,
  group,
  mediaCount,
  selectedItem,
  snapshot,
  workflowRun,
  onCancelAgentRun,
  onCreateWorkflowArtifactSliceAgentRun,
  onCreateWorkflowAgentRun,
  onCreateWorkflowGateSliceAgentRun,
  onCreateWorkflowSliceAgentRun,
  onCreateWorkflowStageSliceAgentRun,
  onDecideWorkflowApproval,
  onPauseAgentRun,
  onResumeAgentRun,
  onSelectWorkflowOutput,
  outputSelectionStep,
}: {
  agentRun?: AgentRunRuntimeView;
  descendantCount: number;
  directItemCount: number;
  gateViews: WorkflowGateRuntimeView[];
  group: BlockRecord;
  mediaCount: number;
  selectedItem?: GroupMediaItem;
  snapshot: BoardSnapshot;
  workflowRun?: WorkflowRunRuntimeView;
  onCancelAgentRun: (agentRunId: string) => void;
  onCreateWorkflowArtifactSliceAgentRun: (
    workflowRunId: string,
    workflowOutputSlotId: string,
  ) => void;
  onCreateWorkflowAgentRun: (workflowRunId: string) => void;
  onCreateWorkflowGateSliceAgentRun: (
    workflowRunId: string,
    gateId: string,
    completion: AgentWorkflowGateCompletion,
  ) => void;
  onCreateWorkflowSliceAgentRun: (workflowRunId: string, stepRunId: string) => void;
  onCreateWorkflowStageSliceAgentRun: (workflowRunId: string, stageId: string) => void;
  onDecideWorkflowApproval: (
    approvalRequestId: string,
    expectedApprovalRequestVersion: number,
    decision: WorkflowApprovalDecisionValue,
  ) => void;
  onPauseAgentRun: (agentRunId: string) => void;
  onResumeAgentRun: (agentRunId: string) => void;
  onSelectWorkflowOutput: (stepRunId: string, assetId: string, expectedStepRunVersion: number) => void;
  outputSelectionStep?: WorkflowStepRunRecord;
}): ReactElement {
  const { t } = useI18n();
  const [agentTarget, setAgentTarget] = useState<
    Exclude<PackageEntrypointAgentLaunchTarget, { kind: 'capability' }>
  >({ kind: 'workflow_run' });
  const kind = (group.data.groupKind ?? 'manual') as GroupKind;
  const dimensions = selectedItem
    ? mediaDimensions(selectedItem.asset.width, selectedItem.asset.height)
    : undefined;
  const selectedAssetId = selectedItem?.asset.assetId;
  const isAcceptedOutput = Boolean(
    selectedAssetId && outputSelectionStep?.acceptedOutputAssetIds.includes(selectedAssetId),
  );
  const selectableOutput = selectedItem
    && selectedAssetId
    && outputSelectionStep
    && outputSelectionStep.outputAcceptancePolicy !== 'automatic'
    && outputSelectionStep.outputAssetIds.includes(selectedAssetId)
    && (outputSelectionStep.status === 'waiting_selection' || outputSelectionStep.status === 'succeeded')
    ? { assetId: selectedAssetId, step: outputSelectionStep }
    : undefined;

  useEffect(() => {
    setAgentTarget({ kind: 'workflow_run' });
  }, [workflowRun?.record.workflowRunId]);

  return (
    <section className="group-inspector-summary">
      <h3>{t('group.summary')}</h3>
      <dl className="execution-inspector-meta">
        <Meta label={t('group.kind')} value={t(`group.kind.${kind}`)} />
        <Meta label={t('group.directItems')} value={String(directItemCount)} />
        <Meta label={t('group.descendants')} value={String(descendantCount)} />
        <Meta label={t('group.media')} value={String(mediaCount)} />
      </dl>
      {workflowRun ? (
        <>
          <h3>{t('workflowRuntime.run')}</h3>
          <dl className="execution-inspector-meta">
            <Meta label={t('workflowRuntime.runId')} value={workflowRun.record.workflowRunId} mono />
            <Meta label={t('inspector.status')} value={t(workflowRunStatusKey(workflowRun.status))} />
            <Meta
              label={t('workflowRuntime.definition')}
              value={`${workflowRun.record.workflowDefinitionLock.workflowId}@${workflowRun.record.workflowDefinitionLock.version}`}
              mono
            />
          </dl>
          {workflowRun.stages.length > 0 ? (
            <>
              <h3>{t('workflowRuntime.stages')}</h3>
              <div className="workflow-stage-list">
                {workflowRun.stages.map((stage) => (
                  <div
                    key={stage.stageDefinitionLock.stageId}
                    className={`workflow-stage is-${stage.status}`}
                  >
                    <div className="workflow-stage-heading">
                      <span>{stage.stageDefinitionLock.name}</span>
                      <strong>
                        {t(workflowStageStatusKey(stage.status))}
                        {stage.freshness === 'outdated' ? ` · ${t('workflowRuntime.outdated')}` : ''}
                      </strong>
                    </div>
                    <small>
                      {t('workflowRuntime.stageSteps')}: {stage.requiredStepRunIds.length}
                      {stage.optionalStepRunIds.length > 0
                        ? ` · ${t('workflowRuntime.stageOptionalSteps')}: ${stage.optionalStepRunIds.length}`
                        : ''}
                    </small>
                    <small>
                      {t('workflowRuntime.stageOutputs')}: {stage.outputArtifactBindings.length}
                      /{stage.stageDefinitionLock.outputSlotLocks.length}
                      {' · '}{t(workflowStageOutputReadinessKey(stage.outputReadiness))}
                    </small>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <h3>{t('workflowRuntime.steps')}</h3>
          <div className="workflow-run-step-list">
            {workflowRun.steps.map((step) => {
              const operation = snapshot.blocks.find((block) => block.blockId === step.record.operationBlockId);
              return (
                <div key={step.record.stepRunId} className={`workflow-run-step is-${step.status}`}>
                  <span>{operation?.data.title ?? step.record.stepId}</span>
                  <strong>
                    {t(workflowStepStatusKey(step.status))}
                    {step.freshness === 'outdated' ? ` · ${t('workflowRuntime.outdated')}` : ''}
                  </strong>
                  <small>{t('workflowRuntime.stepExecutions')}: {step.record.executionIds.length}</small>
                </div>
              );
            })}
          </div>
          {gateViews.length > 0 ? (
            <>
              <h3>{t('workflowRuntime.gates')}</h3>
              <div className="workflow-gate-list">
                {gateViews.map((gate) => (
                  <div
                    key={gate.gateDefinitionLock.gateId}
                    className={`workflow-gate is-${gate.evaluation?.status ?? 'not_ready'}`}
                  >
                    <div className="workflow-gate-heading">
                      <span title={gate.gateDefinitionLock.gateId}>
                        {workflowGateDefinitionLabel(gate.gateDefinitionLock, workflowRun, snapshot)}
                      </span>
                      <strong>{t(workflowGateStatusKey(gate))}</strong>
                    </div>
                    <small>
                      {t('workflowRuntime.gateSubject')}:{' '}
                      {gate.gateDefinitionLock.subject.kind === 'artifact_revision'
                        ? `${t('workflowRuntime.gateArtifactRevision')} · ${gate.gateDefinitionLock.subject.workflowOutputSlotId}`
                        : `${gate.gateDefinitionLock.subject.stepId} / ${gate.gateDefinitionLock.subject.outputSlotId}`}
                    </small>
                    {gate.evaluation?.subjectArtifactRevisionId ? (
                      <small>
                        {t('workflowRuntime.gateArtifactRevision')}:{' '}
                        {gate.evaluation.subjectArtifactRevisionId}
                      </small>
                    ) : null}
                    {gate.evaluation ? (
                      <small>
                        {t('workflowRuntime.gateAssets')}: {gate.evaluation.subjectAssetIds.length}
                      </small>
                    ) : null}
                    {(gate.gateDefinitionLock.reviewChecklist?.length ?? 0) > 0 ? (
                      <ul>
                        {gate.gateDefinitionLock.reviewChecklist?.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                    {gate.canDecide && gate.request ? (
                      <div className="workflow-gate-actions">
                        <button
                          type="button"
                          onClick={() => onDecideWorkflowApproval(
                            gate.request!.approvalRequestId,
                            gate.request!.recordVersion,
                            'approve',
                          )}
                        >
                          <Check size={14} />{t('workflowRuntime.gateApprove')}
                        </button>
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() => onDecideWorkflowApproval(
                            gate.request!.approvalRequestId,
                            gate.request!.recordVersion,
                            'reject',
                          )}
                        >
                          <X size={14} />{t('workflowRuntime.gateReject')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <h3>{t('agentRuntime.run')}</h3>
          {agentRun ? (
            <div className="agent-run-summary">
              <dl className="execution-inspector-meta">
                <Meta label={t('agentRuntime.runId')} value={agentRun.record.agentRunId} mono />
                <Meta label={t('inspector.status')} value={t(agentRunStatusKey(agentRun.status))} />
                <Meta
                  label={t('agentRuntime.target')}
                  value={agentRunTargetLabel(agentRun, snapshot)}
                />
                <Meta label={t('agentRuntime.stopPolicy')} value={agentRun.record.stopPolicy.kind} />
                <Meta label={t('agentRuntime.permissions')} value={agentRun.record.permissions.allowedToolPermissions.join(', ')} />
                <Meta label={t('agentRuntime.executions')} value={String(agentRun.record.executionIds.length)} />
              </dl>
              {agentRun.record.error ? <p className="agent-run-error">{agentRun.record.error}</p> : null}
              <div className="agent-run-actions">
                {agentRun.canPause ? (
                  <button type="button" onClick={() => onPauseAgentRun(agentRun.record.agentRunId)}>
                    <CirclePause size={14} />{t('agentRuntime.pause')}
                  </button>
                ) : null}
                {agentRun.canResume ? (
                  <button type="button" onClick={() => onResumeAgentRun(agentRun.record.agentRunId)}>
                    <Play size={14} />{t('agentRuntime.resume')}
                  </button>
                ) : null}
                {agentRun.canCancel ? (
                  <button type="button" className="is-danger" onClick={() => onCancelAgentRun(agentRun.record.agentRunId)}>
                    <Square size={13} />{t('agentRuntime.cancel')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!agentRun?.canCancel ? (
            <div className="agent-run-create">
              <WorkflowAgentTargetPicker
                definition={{
                  gates: gateViews.map((gate) => ({
                    gateId: gate.gateDefinitionLock.gateId,
                    name: workflowGateDefinitionLabel(
                      gate.gateDefinitionLock,
                      workflowRun,
                      snapshot,
                    ),
                  })),
                  outputSlots: workflowRun.record.outputSlotLocks.map((output) => ({
                    slotId: output.workflowOutputSlotId,
                  })),
                  stages: workflowRun.stages.map((stage) => ({
                    name: stage.stageDefinitionLock.name,
                    stageId: stage.stageDefinitionLock.stageId,
                  })),
                  steps: workflowRun.steps.map((step) => ({
                    stepId: step.record.stepId,
                  })),
                }}
                value={agentTarget}
                onChange={setAgentTarget}
              />
              <button
                type="button"
                className="agent-run-start"
                onClick={() => {
                  if (agentTarget.kind === 'workflow_run') {
                    onCreateWorkflowAgentRun(workflowRun.record.workflowRunId);
                    return;
                  }
                  const until = agentTarget.until;
                  if (until.kind === 'gate') {
                    onCreateWorkflowGateSliceAgentRun(
                      workflowRun.record.workflowRunId,
                      until.gateId,
                      until.completion,
                    );
                    return;
                  }
                  if (until.kind === 'stage') {
                    onCreateWorkflowStageSliceAgentRun(
                      workflowRun.record.workflowRunId,
                      until.stageId,
                    );
                    return;
                  }
                  if (until.kind === 'artifact') {
                    onCreateWorkflowArtifactSliceAgentRun(
                      workflowRun.record.workflowRunId,
                      until.workflowOutputSlotId,
                    );
                    return;
                  }
                  if (until.kind === 'step') {
                    const step = workflowRun.steps.find(
                      (candidate) => candidate.record.stepId === until.stepId,
                    );
                    if (!step) return;
                    onCreateWorkflowSliceAgentRun(
                      workflowRun.record.workflowRunId,
                      step.record.stepRunId,
                    );
                  }
                }}
              >
                <Bot size={15} />
                <span>{t('agentRuntime.startSelectedTarget')}</span>
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {selectedItem ? (
        <>
          <h3>{t('group.mediaInfo')}</h3>
          <dl className="execution-inspector-meta">
            <Meta label={t('group.media')} value={selectedItem.block.data.title} />
            <Meta label={t('group.dimensions')} value={dimensions} />
            <Meta label={t('group.mimeType')} value={selectedItem.asset.mimeType} />
            <Meta label={t('group.assetId')} value={selectedItem.asset.assetId} mono />
            <Meta label={t('group.blockId')} value={selectedItem.block.blockId} mono />
          </dl>
          {selectableOutput ? (
            <button
              type="button"
              className={`workflow-output-selection${isAcceptedOutput ? ' is-accepted' : ''}`}
              disabled={isAcceptedOutput}
              onClick={() => onSelectWorkflowOutput(
                selectableOutput.step.stepRunId,
                selectableOutput.assetId,
                selectableOutput.step.recordVersion,
              )}
            >
              <Check size={15} />
              <span>
                {isAcceptedOutput
                  ? t('workflowRuntime.selectedOutput')
                  : selectableOutput.step.acceptedOutputAssetIds.length > 0
                    ? t('workflowRuntime.changeSelectedOutput')
                    : t('workflowRuntime.selectOutput')}
              </span>
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function workflowRunStatusKey(status: WorkflowRunRuntimeView['status']) {
  return `workflowRuntime.runStatus.${status}` as const;
}

function workflowStepStatusKey(status: WorkflowRunRuntimeView['steps'][number]['status']) {
  return `workflowRuntime.stepStatus.${status}` as const;
}

function workflowStageStatusKey(status: WorkflowRunRuntimeView['stages'][number]['status']) {
  return `workflowRuntime.stageStatus.${status}` as const;
}

function workflowStageOutputReadinessKey(
  readiness: WorkflowRunRuntimeView['stages'][number]['outputReadiness'],
) {
  return `workflowRuntime.stageOutputReadiness.${readiness}` as const;
}

function agentRunStatusKey(status: AgentRunRuntimeView['status']) {
  return `agentRuntime.status.${status}` as const;
}

function agentRunTargetLabel(agentRun: AgentRunRuntimeView, snapshot: BoardSnapshot): string {
  const target = agentRun.record.target;
  if (target.kind !== 'workflow_slice') return target.kind;
  const until = target.until;
  if (until.kind === 'stage') {
    const stageId = until.stageId;
    const stage = workflowRunViewForId(snapshot, target.workflowRunId)?.stages.find(
      (candidate) => candidate.stageDefinitionLock.stageId === stageId,
    );
    return `${target.kind} · ${stage?.stageDefinitionLock.name ?? stageId}`;
  }
  if (until.kind === 'gate') {
    const workflow = workflowRunViewForId(snapshot, target.workflowRunId);
    const label = workflow
      ? workflowGateDefinitionLabel(until.gateDefinitionLock, workflow, snapshot)
      : until.gateDefinitionLock.name ?? until.gateDefinitionLock.gateId;
    return `${target.kind} · ${label} · ${until.completion}`;
  }
  const operationBlockId = (snapshot.workflowStepRuns ?? []).find(
    (step) => step.stepRunId === until.stepRunId,
  )?.operationBlockId;
  const operation = snapshot.blocks.find((block) => block.blockId === operationBlockId);
  return until.kind === 'artifact'
    ? `${target.kind} · ${operation?.data.title ?? until.stepId} · ${until.workflowOutputSlotId}`
    : `${target.kind} · ${operation?.data.title ?? until.stepId}`;
}

function workflowGateDefinitionLabel(
  gate: WorkflowGateDefinitionLock,
  workflow: WorkflowRunRuntimeView,
  snapshot: BoardSnapshot,
): string {
  if (gate.name?.trim()) return gate.name.trim();
  const subjectStep = workflow.steps.find(
    (step) => step.record.stepId === gate.subject.stepId,
  );
  const operation = snapshot.blocks.find(
    (block) => block.blockId === subjectStep?.record.operationBlockId,
  );
  const operationLabel = String(operation?.data.title ?? gate.subject.stepId);
  const outputLabel = gate.subject.kind === 'artifact_revision'
    ? gate.subject.workflowOutputSlotId
    : gate.subject.outputSlotId;
  return `${operationLabel} · ${outputLabel}`;
}

function workflowGateStatusKey(gate: WorkflowGateRuntimeView) {
  return `workflowRuntime.gateStatus.${gate.evaluation?.status ?? 'not_ready'}` as const;
}

function Meta({ label, mono, value }: { label: string; mono?: boolean; value?: string }): ReactElement | null {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : undefined} title={value}>{value}</dd>
    </>
  );
}

function mediaDimensions(width?: number, height?: number): string | undefined {
  return width && height ? `${width} x ${height}` : undefined;
}

function siblingBlockId(items: GroupMediaItem[], currentBlockId: string | undefined, offset: number): string | undefined {
  if (items.length === 0) return undefined;
  const currentIndex = Math.max(0, items.findIndex((item) => item.block.blockId === currentBlockId));
  return items[(currentIndex + offset + items.length) % items.length]?.block.blockId;
}
