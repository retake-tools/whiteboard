import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import {
  Activity,
  Bot,
  Box,
  GitBranch,
  LockKeyhole,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { AgentRunRecord } from '../core/agentRuntimeContracts';
import type { BoardSnapshot } from '../core/types';
import { workflowRunExperienceFor } from '../core/workflowRunExperience';
import {
  workflowWorkspaceGraphFor,
  workflowWorkspaceNodeHeight,
  workflowWorkspaceNodeWidth,
} from '../core/workflowWorkspaceGraph';
import type { WorkflowRunStatus } from '../core/workflowRuntimeContracts';
import type { ProjectWorkflowRevisionV1 } from '../core/workflowAuthoringContracts';
import type { ProjectedWorkflowRevisionResult } from '../app/useWorkflowDraftController';
import { useI18n, type TranslationKey } from '../i18n';
import {
  WorkflowGraphStepNode,
  type WorkflowGraphStepNodeType,
} from './WorkflowGraphStepNode';
import { WorkflowDesignWorkspace } from './WorkflowDesignWorkspace';
import { WorkflowRunStepInspector } from './WorkflowRunStepInspector';
import './workflow-workspace.css';

const nodeTypes = {
  workflowStep: WorkflowGraphStepNode,
} satisfies NodeTypes;

export function WorkflowWorkspace({
  activeAgentRun,
  initialWorkflowRunId,
  onCreateWorkflowRun,
  onClose,
  onLocateBlock,
  onOpenAgentRun,
  onProjectWorkflowRevision,
  onStartWorkflowRun,
  onStartWorkflowStep,
  selectedBlockIds,
  snapshot,
}: {
  activeAgentRun?: AgentRunRecord;
  initialWorkflowRunId: string;
  onCreateWorkflowRun: (groupBlockId: string) => string | undefined;
  onClose: () => void;
  onLocateBlock: (blockId: string) => void;
  onOpenAgentRun: (agentRunId: string) => void;
  onProjectWorkflowRevision: (revision: ProjectWorkflowRevisionV1) => ProjectedWorkflowRevisionResult;
  onStartWorkflowRun: (workflowRunId: string) => void;
  onStartWorkflowStep: (workflowRunId: string, stepRunId: string) => void;
  selectedBlockIds: string[];
  snapshot: BoardSnapshot;
}): ReactElement {
  const { locale, t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<'design' | 'run'>('run');
  const experience = useMemo(
    () => workflowRunExperienceFor(snapshot, activeAgentRun),
    [activeAgentRun, snapshot],
  );
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] = useState(
    initialWorkflowRunId,
  );
  const effectiveWorkflowRunId = experience.runs.some(
    (run) => run.workflowRunId === selectedWorkflowRunId,
  )
    ? selectedWorkflowRunId
    : experience.defaultWorkflowRunId ?? '';
  const graph = useMemo(
    () => workflowWorkspaceGraphFor(
      snapshot,
      effectiveWorkflowRunId,
      activeAgentRun,
    ),
    [activeAgentRun, effectiveWorkflowRunId, snapshot],
  );
  const [selectedStepRunId, setSelectedStepRunId] = useState<string>();
  const effectiveStepRunId = graph?.nodes.some(
    (node) => node.step.stepRunId === selectedStepRunId,
  )
    ? selectedStepRunId
    : graph?.defaultSelectedStepRunId;
  const selectedNode = graph?.nodes.find(
    (node) => node.step.stepRunId === effectiveStepRunId,
  );
  const selectedRunRecord = (snapshot.workflowRuns ?? []).find(
    (run) => run.workflowRunId === effectiveWorkflowRunId,
  );
  const activeBoardAgentRun = useMemo(
    () => [...(snapshot.agentRuns ?? [])].reverse().find((run) => (
      run.status === 'queued'
      || run.status === 'running'
      || run.status === 'waiting_input'
      || run.status === 'waiting_selection'
      || run.status === 'waiting_approval'
      || run.status === 'paused'
      || run.status === 'needs_attention'
    )),
    [snapshot.agentRuns],
  );
  const runIsTerminal = graph
    ? graph.run.status === 'canceled'
      || graph.run.status === 'failed'
      || graph.run.status === 'succeeded'
    : true;
  const stepIsComplete = selectedNode
    ? selectedNode.step.status === 'canceled'
      || selectedNode.step.status === 'skipped'
      || (selectedNode.step.status === 'succeeded'
        && selectedNode.step.freshness === 'current')
    : true;
  const nodes = useMemo<WorkflowGraphStepNodeType[]>(() => (
    graph?.nodes.map((node) => ({
      data: { view: node },
      id: node.step.stepRunId,
      ariaLabel: `${node.step.label}. ${t(stepStatusKey(node.step.status))}. ${node.capabilityId}`,
      position: node.position,
      selected: node.step.stepRunId === effectiveStepRunId,
      style: {
        height: workflowWorkspaceNodeHeight,
        width: workflowWorkspaceNodeWidth,
      },
      type: 'workflowStep',
    })) ?? []
  ), [effectiveStepRunId, graph?.nodes, t]);
  const edges = useMemo<Edge[]>(() => (
    graph?.edges.map((edge) => ({
      animated: graph.nodes.find(
        (node) => node.step.stepRunId === edge.targetStepRunId,
      )?.step.role === 'current',
      id: edge.edgeId,
      markerEnd: { type: MarkerType.ArrowClosed },
      source: edge.sourceStepRunId,
      target: edge.targetStepRunId,
      type: 'smoothstep',
    })) ?? []
  ), [graph]);
  const attentionNodes = useMemo(() => graph?.nodes.filter((node) => {
    const stepRun = (snapshot.workflowStepRuns ?? []).find(
      (record) => record.stepRunId === node.step.stepRunId,
    );
    return node.step.role === 'blocked'
      || node.step.freshness === 'outdated'
      || node.step.status === 'failed'
      || node.step.status === 'canceled'
      || node.step.status === 'waiting_input'
      || node.step.status === 'waiting_selection'
      || Boolean(stepRun?.error)
      || node.gates.some((gate) => (
        gate.freshness === 'outdated'
        || gate.status === 'failed'
        || gate.status === 'waiting_approval'
      ));
  }) ?? [], [graph?.nodes, snapshot.workflowStepRuns]);
  const locateRunStep = (stepRunId: string): void => {
    setSelectedStepRunId(stepRunId);
  };

  useEffect(() => setSelectedWorkflowRunId(initialWorkflowRunId), [initialWorkflowRunId]);
  useEffect(() => setSelectedStepRunId(graph?.defaultSelectedStepRunId), [
    graph?.defaultSelectedStepRunId,
    graph?.run.workflowRunId,
  ]);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        event.target instanceof Element
        && event.target.closest('.workflow-design-step-creator')
      ) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="workflow-workspace-overlay" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="workflow-workspace"
        role="dialog"
        aria-modal="true"
        aria-label={t('workflowWorkspace.title')}
        tabIndex={-1}
      >
        <header className="workflow-workspace-header">
          <div className="workflow-workspace-heading">
            <span><GitBranch size={18} /></span>
            <div>
              <small>{t('workflowWorkspace.title')}</small>
              <strong>{graph?.run.label ?? t('workflowWorkspace.noRuns')}</strong>
            </div>
          </div>
          <div className="workflow-workspace-modes" aria-label={t('workflowWorkspace.title')}>
            <button
              type="button"
              className={mode === 'run' ? 'is-active' : undefined}
              aria-pressed={mode === 'run'}
              onClick={() => setMode('run')}
            >
              <Activity size={14} />{t('workflowWorkspace.runView')}
            </button>
            <button
              type="button"
              className={mode === 'design' ? 'is-active' : undefined}
              aria-pressed={mode === 'design'}
              onClick={() => setMode('design')}
            >
              <Box size={14} />{t('workflowWorkspace.designMode')}
            </button>
          </div>
          {mode === 'run' && graph ? (
            activeBoardAgentRun ? (
              <button
                type="button"
                className="workflow-workspace-agent-action is-secondary"
                onClick={() => onOpenAgentRun(activeBoardAgentRun.agentRunId)}
              >
                <Bot size={14} /><span>{t('workflowWorkspace.openActiveAgent')}</span>
              </button>
            ) : (
              <button
                type="button"
                className="workflow-workspace-agent-action"
                disabled={runIsTerminal}
                onClick={() => onStartWorkflowRun(graph.run.workflowRunId)}
              >
                <Bot size={14} /><span>{t('workflowWorkspace.runEntireWorkflow')}</span>
              </button>
            )
          ) : null}
          <span className="workflow-workspace-readonly">
            <LockKeyhole size={13} />
            {mode === 'run'
              ? t('workflowWorkspace.readOnly')
              : t('workflowAuthoring.projectDraft')}
          </span>
          <button
            type="button"
            className="workflow-workspace-close"
            aria-label={t('workflowWorkspace.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {mode === 'design' && selectedRunRecord ? (
          <WorkflowDesignWorkspace
            boardId={snapshot.board.boardId}
            onCreateWorkflowRun={(groupBlockId) => {
              const workflowRunId = onCreateWorkflowRun(groupBlockId);
              if (!workflowRunId) return;
              setSelectedWorkflowRunId(workflowRunId);
              setMode('run');
            }}
            onProjectRevision={onProjectWorkflowRevision}
            projectId={snapshot.project.projectId}
            selectedBlockIds={selectedBlockIds}
            sourceLabel={graph?.run.label ?? selectedRunRecord.workflowDefinitionLock.workflowId}
            sourceWorkflowId={selectedRunRecord.workflowDefinitionLock.workflowId}
          />
        ) : (
        <div className="workflow-workspace-body">
          <nav className="workflow-workspace-runs" aria-label={t('agentWorkspace.workflowRuns')}>
            <header>
              <strong>{t('agentWorkspace.workflowRuns')}</strong>
              <small>{experience.runs.length}</small>
            </header>
            <div>
              {experience.runs.map((run) => (
                <button
                  key={run.workflowRunId}
                  type="button"
                  className={run.workflowRunId === effectiveWorkflowRunId ? 'is-active' : undefined}
                  onClick={() => setSelectedWorkflowRunId(run.workflowRunId)}
                >
                  <span>
                    <strong>{run.label}</strong>
                    <small>{t(runStatusKey(run.status))}</small>
                  </span>
                  <span>
                    <small>{run.completedStepCount}/{run.totalStepCount}</small>
                    <small>{formatUpdatedAt(run.updatedAt, locale)}</small>
                  </span>
                </button>
              ))}
              {attentionNodes.length > 0 ? (
                <section className="workflow-run-attention-checklist">
                  <header>
                    <TriangleAlert size={13} />
                    <strong>{t('workflowWorkspace.attentionChecklist')}</strong>
                    <small>{attentionNodes.length}</small>
                  </header>
                  {attentionNodes.map((node) => (
                    <button
                      key={node.step.stepRunId}
                      type="button"
                      className={node.step.stepRunId === effectiveStepRunId ? 'is-active' : undefined}
                      onClick={() => locateRunStep(node.step.stepRunId)}
                    >
                      <span>
                        <strong>{node.step.label}</strong>
                        <small>{t(stepStatusKey(node.step.status))}</small>
                      </span>
                      <small>{t('workflowWorkspace.locateStep')}</small>
                    </button>
                  ))}
                </section>
              ) : null}
            </div>
          </nav>
          <main className="workflow-workspace-graph">
            {graph && nodes.length > 0 ? (
              <ReactFlowProvider>
                <ReactFlow<WorkflowGraphStepNodeType, Edge>
                  id="workflow-workspace-graph"
                  key={graph.run.workflowRunId}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  nodesConnectable={false}
                  nodesDraggable={false}
                  edgesFocusable={false}
                  deleteKeyCode={null}
                  ariaLabelConfig={{
                    'node.a11yDescription.default': t('workflowWorkspace.graphNodeDescription'),
                    'node.a11yDescription.keyboardDisabled': t('workflowWorkspace.graphNodeDescription'),
                  }}
                  fitView
                  fitViewOptions={{ maxZoom: 1, padding: 0.22 }}
                  minZoom={0.35}
                  maxZoom={1.5}
                  onNodeClick={(_, node) => setSelectedStepRunId(node.id)}
                >
                  <Background gap={20} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </ReactFlowProvider>
            ) : (
              <div className="workflow-workspace-empty">{t('workflowWorkspace.noRuns')}</div>
            )}
          </main>
          <aside className="workflow-workspace-inspector">
            <header><strong>{t('workflowWorkspace.inspector')}</strong></header>
            {selectedNode ? (
              <WorkflowRunStepInspector
                canRunToStep={!activeBoardAgentRun && !runIsTerminal && !stepIsComplete}
                node={selectedNode}
                onLocate={() => {
                  onClose();
                  onLocateBlock(selectedNode.operationBlockId);
                }}
                onRunToStep={() => onStartWorkflowStep(
                  graph!.run.workflowRunId,
                  selectedNode.step.stepRunId,
                )}
                snapshot={snapshot}
              />
            ) : (
              <p>{t('workflowWorkspace.selectStep')}</p>
            )}
          </aside>
        </div>
        )}
      </section>
    </div>
  );
}

function runStatusKey(status: WorkflowRunStatus): TranslationKey {
  return `workflowRuntime.runStatus.${status}`;
}

function stepStatusKey(
  status: WorkflowGraphStepNodeType['data']['view']['step']['status'],
): TranslationKey {
  return `workflowRuntime.stepStatus.${status}`;
}

function formatUpdatedAt(value: string, locale: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(time);
}
