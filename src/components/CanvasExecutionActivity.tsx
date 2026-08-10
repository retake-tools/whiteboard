import { LoaderCircle, LocateFixed } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { subscribeExecutionEvents } from '../core/executionEventClient';
import type { ExecutionProgressEvent } from '../core/executionEventContracts';
import type { BoardSnapshot, ExecutionRecord } from '../core/types';
import { useI18n, type TranslationKey } from '../i18n';

interface CanvasExecutionActivityProps {
  agentExecutionIds?: readonly string[];
  agentRunId?: string;
  agentIsWorking: boolean;
  agentStartedAt?: string;
  onLocateBlock: (blockId: string) => void;
  snapshot: BoardSnapshot;
  workflowRunIds?: readonly string[];
  workingOperationBlockId?: string;
}

export function CanvasExecutionActivity({
  agentExecutionIds = [],
  agentRunId,
  agentIsWorking,
  agentStartedAt,
  onLocateBlock,
  snapshot,
  workflowRunIds = [],
  workingOperationBlockId,
}: CanvasExecutionActivityProps): ReactElement | null {
  const { t } = useI18n();
  const agentExecutionIdKey = agentExecutionIds.join('\u0000');
  const workflowRunIdKey = workflowRunIds.join('\u0000');
  const activeExecutions = useMemo(
    () => executionActivityRecordsForAgent(snapshot, {
      agentExecutionIds: agentExecutionIdKey ? agentExecutionIdKey.split('\u0000') : [],
      agentRunId,
      workflowRunIds: workflowRunIdKey ? workflowRunIdKey.split('\u0000') : [],
      workingOperationBlockId,
    }),
    [
      agentExecutionIdKey,
      agentRunId,
      snapshot,
      workflowRunIdKey,
      workingOperationBlockId,
    ],
  );
  const activeExecutionKey = activeExecutions
    .map((execution) => execution.executionId)
    .sort()
    .join('\u0000');
  const [progressByExecutionId, setProgressByExecutionId] = useState<
    Record<string, ExecutionProgressEvent>
  >({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activeExecutionKey) return undefined;
    const activeExecutionIds = activeExecutionKey.split('\u0000');
    const activeExecutionIdSet = new Set(activeExecutionIds);
    setProgressByExecutionId((current) => Object.fromEntries(
      Object.entries(current).filter(([executionId]) => activeExecutionIdSet.has(executionId)),
    ));
    const unsubscribes = activeExecutionIds.map((executionId) => (
      subscribeExecutionEvents({
        boardId: snapshot.board.boardId,
        executionId,
        projectId: snapshot.project.projectId,
        onEvent: (event) => {
          if (event.type !== 'execution.progress') return;
          setProgressByExecutionId((current) => ({
            ...current,
            [executionId]: event,
          }));
        },
      })
    ));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [
    activeExecutionKey,
    snapshot.board.boardId,
    snapshot.project.projectId,
  ]);

  useEffect(() => {
    const activityKey = activeExecutionKey || (agentIsWorking ? 'agent' : '');
    if (!activityKey) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeExecutionKey, agentIsWorking]);

  if (activeExecutions.length === 0) {
    if (!agentIsWorking) return null;
    const agentElapsed = agentStartedAt ? elapsedLabel(agentStartedAt, now) : undefined;
    return (
      <div className="agent-execution-activity" role="status" aria-live="polite">
        <span className="agent-execution-activity-icon" aria-hidden="true">
          <LoaderCircle size={16} />
        </span>
        <span className="agent-execution-activity-copy">
          <strong>{t('canvasActivity.agentWorking')}</strong>
          <small>
            {t('canvasActivity.agentPlanning')}
            {agentElapsed ? ` · ${agentElapsed}` : ''}
          </small>
        </span>
      </div>
    );
  }
  const execution = primaryExecution(activeExecutions);
  const operationBlockId = operationBlockIdFor(snapshot, execution);
  const operation = operationBlockId
    ? snapshot.blocks.find((block) => block.blockId === operationBlockId)
    : undefined;
  const progress = progressByExecutionId[execution.executionId];
  const phaseLabel = t(executionActivityPhaseKey(execution, progress));
  const candidateLabel = progress?.current && progress.total
    ? `${progress.current}/${progress.total}`
    : undefined;
  const elapsed = elapsedLabel(execution.startedAt, now);
  const content = (
    <>
      <span className="agent-execution-activity-icon" aria-hidden="true">
        <LoaderCircle size={16} />
      </span>
      <span className="agent-execution-activity-copy">
        <strong>{operation?.data.title || t('canvasActivity.systemRunning')}</strong>
        <small>
          {phaseLabel}
          {candidateLabel ? ` · ${candidateLabel}` : ''}
          {elapsed ? ` · ${elapsed}` : ''}
        </small>
      </span>
      {activeExecutions.length > 1 ? (
        <span className="agent-execution-activity-count">+{activeExecutions.length - 1}</span>
      ) : null}
      {operationBlockId ? <LocateFixed size={14} aria-hidden="true" /> : null}
    </>
  );

  return operationBlockId ? (
    <button
      type="button"
      className="agent-execution-activity"
      aria-label={t('canvasActivity.locate')}
      onClick={() => onLocateBlock(operationBlockId)}
    >
      {content}
    </button>
  ) : (
    <div className="agent-execution-activity" role="status" aria-live="polite">
      {content}
    </div>
  );
}

export function executionActivityRecordsForAgent(
  snapshot: BoardSnapshot,
  input: {
    agentExecutionIds?: readonly string[];
    agentRunId?: string;
    workflowRunIds?: readonly string[];
    workingOperationBlockId?: string;
  },
): ExecutionRecord[] {
  const executionIds = new Set(input.agentExecutionIds ?? []);
  const workflowRunIds = new Set(input.workflowRunIds ?? []);
  return snapshot.executions.filter((execution) => (
    (execution.status === 'queued' || execution.status === 'running')
    && (
      Boolean(input.agentRunId && execution.agentRunId === input.agentRunId)
      || executionIds.has(execution.executionId)
      || Boolean(execution.workflowRunId && workflowRunIds.has(execution.workflowRunId))
      || Boolean(
        input.workingOperationBlockId
        && execution.params?.operationBlockId === input.workingOperationBlockId
      )
    )
  ));
}

function primaryExecution(executions: ExecutionRecord[]): ExecutionRecord {
  return executions.reduce((latest, execution) => (
    execution.startedAt > latest.startedAt ? execution : latest
  ));
}

function operationBlockIdFor(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): string | undefined {
  const declared = execution.params?.operationBlockId;
  if (typeof declared === 'string') return declared;
  if (!execution.stepRunId) return undefined;
  return snapshot.workflowStepRuns?.find(
    (step) => step.stepRunId === execution.stepRunId,
  )?.operationBlockId;
}

export function executionActivityPhaseKey(
  execution: ExecutionRecord,
  progress: ExecutionProgressEvent | undefined,
): TranslationKey {
  if (progress?.phase === 'provider_starting') return 'canvasActivity.providerStarting';
  if (progress?.phase === 'provider_generating') return 'canvasActivity.providerGenerating';
  if (progress?.phase === 'result_importing') return 'canvasActivity.resultImporting';
  if (progress?.phase === 'board_writing') return 'canvasActivity.boardWriting';
  return execution.status === 'queued'
    ? 'canvasActivity.preparing'
    : 'canvasActivity.running';
}

function elapsedLabel(startedAt: string, now: number): string | undefined {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return undefined;
  const elapsedSeconds = Math.max(0, Math.floor((now - started) / 1_000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}
