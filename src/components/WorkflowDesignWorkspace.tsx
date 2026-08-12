import {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { CircleCheck, Copy, Save, Send, TriangleAlert } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import {
  confirmWorkflowSelectionCapture,
  forkInstalledWorkflow,
  loadProjectWorkflowAuthoring,
  previewWorkflowSelectionCapture,
  publishWorkflowAuthoringDraft,
  saveWorkflowAuthoringDraft,
} from '../core/workflowAuthoringClient';
import {
  addWorkflowAuthoringProjectionPosition,
  workflowAuthoringChecklistFor,
  workflowAuthoringGraphFor,
  type WorkflowAuthoringStepInsertionContextV1,
} from '../core/workflowAuthoringGraph';
import {
  validateProjectWorkflowDefinition,
  type ProjectWorkflowAuthoringSnapshotV1,
  type ProjectWorkflowRevisionV1,
  type WorkflowProjectionTemplateV1,
} from '../core/workflowAuthoringContracts';
import type { WorkflowDefinition } from '../core/workflowRegistry';
import type { WorkflowSelectionCaptureProposalV1 } from '../core/workflowSelectionCapture';
import type { ProjectedWorkflowRevisionResult } from '../app/useWorkflowDraftController';
import { useI18n } from '../i18n';
import { WorkflowDesignAddStep } from './WorkflowDesignAddStep';
import { WorkflowDesignCapture } from './WorkflowDesignCapture';
import { WorkflowDesignMetadata } from './WorkflowDesignMetadata';
import { WorkflowDesignProjectionResult } from './WorkflowDesignProjectionResult';
import { WorkflowDesignRevisionList } from './WorkflowDesignRevisionList';
import {
  WorkflowDesignDependencyEdge,
  type WorkflowDesignDependencyEdgeType,
} from './WorkflowDesignDependencyEdge';
import { WorkflowDesignStepInspector } from './WorkflowDesignStepInspector';
import { WorkflowDesignValidationChecklist } from './WorkflowDesignValidationChecklist';
import {
  WorkflowDesignStepNode,
  type WorkflowDesignStepNodeType,
} from './WorkflowDesignStepNode';

const nodeTypes = {
  workflowDesignStep: WorkflowDesignStepNode,
} satisfies NodeTypes;

const edgeTypes = {
  workflowDesignDependency: WorkflowDesignDependencyEdge,
} satisfies EdgeTypes;

export function WorkflowDesignWorkspace({
  boardId,
  onCreateWorkflowRun,
  onProjectRevision,
  projectId,
  selectedBlockIds,
  sourceLabel,
  sourceWorkflowId,
}: {
  boardId: string;
  onCreateWorkflowRun: (groupBlockId: string) => void;
  onProjectRevision: (
    revision: ProjectWorkflowRevisionV1,
  ) => Promise<ProjectedWorkflowRevisionResult>;
  projectId: string;
  selectedBlockIds: string[];
  sourceLabel: string;
  sourceWorkflowId: string;
}): ReactElement {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ProjectWorkflowAuthoringSnapshotV1>();
  const [selectedDraftId, setSelectedDraftId] = useState<string>();
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [workingDefinition, setWorkingDefinition] = useState<WorkflowDefinition>();
  const [workingTemplate, setWorkingTemplate] = useState<WorkflowProjectionTemplateV1>();
  const [error, setError] = useState<string>();
  const [captureProposal, setCaptureProposal] = useState<WorkflowSelectionCaptureProposalV1>();
  const [stepCreatorContext, setStepCreatorContext] = useState<
    WorkflowAuthoringStepInsertionContextV1
  >();
  const [busyAction, setBusyAction] = useState<'capture' | 'fork' | 'preview' | 'project' | 'publish' | 'save'>();
  const [projectedRevision, setProjectedRevision] = useState<ProjectedWorkflowRevisionResult>();
  const closeStepCreator = useCallback(() => setStepCreatorContext(undefined), []);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(undefined);
    setError(undefined);
    void loadProjectWorkflowAuthoring(projectId, controller.signal)
      .then(setSnapshot)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      });
    return () => controller.abort();
  }, [projectId]);
  useEffect(() => setProjectedRevision(undefined), [projectId]);

  const selectedDraft = snapshot?.drafts.find(
    (draft) => draft.draftId === selectedDraftId,
  );
  const activeRevisions = snapshot?.revisions.filter(
    (revision) => !snapshot.archivedRevisionIds.includes(revision.revisionId),
  ) ?? [];
  useEffect(() => {
    setWorkingDefinition(selectedDraft?.definition
      ? structuredClone(selectedDraft.definition)
      : undefined);
    setWorkingTemplate(selectedDraft?.projectionTemplate
      ? structuredClone(selectedDraft.projectionTemplate)
      : undefined);
    setSelectedStepId(selectedDraft?.definition.steps[0]?.stepId);
    setStepCreatorContext(undefined);
  }, [selectedDraft?.draftId, selectedDraft?.recordVersion]);

  const validation = useMemo(() => (
    workingDefinition ? validateProjectWorkflowDefinition(workingDefinition) : undefined
  ), [workingDefinition]);
  const graph = useMemo(() => (
    workingDefinition && workingTemplate
      ? workflowAuthoringGraphFor({
        definition: workingDefinition,
        projectionTemplate: workingTemplate,
        validationIssues: validation?.issues,
      })
      : undefined
  ), [validation?.issues, workingDefinition, workingTemplate]);
  const dirty = Boolean(
    selectedDraft
    && workingDefinition
    && workingTemplate
    && (
      JSON.stringify(selectedDraft.definition) !== JSON.stringify(workingDefinition)
      || JSON.stringify(selectedDraft.projectionTemplate) !== JSON.stringify(workingTemplate)
    )
  );
  const selectedStep = workingDefinition?.steps.find(
    (step) => step.stepId === selectedStepId,
  );
  const checklist = useMemo(() => (
    workingDefinition
      ? workflowAuthoringChecklistFor(workingDefinition, validation?.issues ?? [])
      : []
  ), [validation?.issues, workingDefinition]);
  const locateStep = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
  }, []);
  const nodes = useMemo<WorkflowDesignStepNodeType[]>(() => (
    graph?.nodes.map((node) => ({
      ariaLabel: `${node.stepId}. ${node.capabilityId}`,
      data: {
        addAfterLabel: `${t('workflowAuthoring.insertAfterStep')} · ${node.stepId}`,
        onAddAfter: () => {
          setSelectedStepId(node.stepId);
          setStepCreatorContext({ kind: 'after_step', sourceStepId: node.stepId });
        },
        view: node,
      },
      id: node.stepId,
      position: node.position,
      selected: node.stepId === selectedStepId,
      style: { height: 132, width: 248 },
      type: 'workflowDesignStep',
    })) ?? []
  ), [graph?.nodes, selectedStepId, t]);
  const edges = useMemo<WorkflowDesignDependencyEdgeType[]>(() => (
    graph?.edges.map((edge) => ({
      data: {
        insertLabel: `${t('workflowAuthoring.insertOnEdge')} · ${edge.sourceStepId} → ${edge.targetStepId}`,
        onInsert: () => setStepCreatorContext({
          kind: 'insert_edge',
          sourceStepId: edge.sourceStepId,
          targetStepId: edge.targetStepId,
        }),
      },
      id: edge.edgeId,
      markerEnd: { type: MarkerType.ArrowClosed },
      source: edge.sourceStepId,
      target: edge.targetStepId,
      type: 'workflowDesignDependency',
    })) ?? []
  ), [graph?.edges, t]);

  const forkSource = async () => {
    setBusyAction('fork');
    setError(undefined);
    try {
      const result = await forkInstalledWorkflow({ projectId, workflowId: sourceWorkflowId });
      setSnapshot(result.snapshot);
      setSelectedDraftId(result.draft.draftId);
    } catch (forkError) {
      setError(forkError instanceof Error ? forkError.message : String(forkError));
    } finally {
      setBusyAction(undefined);
    }
  };
  const saveDraft = async () => {
    if (!selectedDraft || !workingDefinition || !workingTemplate) return undefined;
    setBusyAction('save');
    setError(undefined);
    try {
      const result = await saveWorkflowAuthoringDraft({
        definition: workingDefinition,
        draftId: selectedDraft.draftId,
        expectedRecordVersion: selectedDraft.recordVersion,
        projectId,
        projectionTemplate: workingTemplate,
      });
      setSnapshot(result.snapshot);
      return result.draft;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return undefined;
    } finally {
      setBusyAction(undefined);
    }
  };
  const publishDraft = async () => {
    if (!selectedDraft || !workingDefinition || !workingTemplate) return;
    setBusyAction('publish');
    setError(undefined);
    try {
      const saved = dirty ? await saveDraft() : selectedDraft;
      if (!saved) return;
      setBusyAction('publish');
      const result = await publishWorkflowAuthoringDraft({
        draftId: saved.draftId,
        expectedRecordVersion: saved.recordVersion,
        projectId,
      });
      setSnapshot(result.snapshot);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : String(publishError));
    } finally {
      setBusyAction(undefined);
    }
  };
  const previewSelection = async () => {
    setBusyAction('preview');
    setError(undefined);
    try {
      setCaptureProposal(await previewWorkflowSelectionCapture({
        blockIds: selectedBlockIds,
        boardId,
        projectId,
      }));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError));
    } finally {
      setBusyAction(undefined);
    }
  };
  const captureSelection = async () => {
    if (!captureProposal?.valid) return;
    setBusyAction('capture');
    setError(undefined);
    try {
      const result = await confirmWorkflowSelectionCapture({
        blockIds: captureProposal.blockIds,
        boardId,
        expectedFingerprint: captureProposal.fingerprint,
        projectId,
      });
      setSnapshot(result.snapshot);
      setSelectedDraftId(result.draft.draftId);
      setCaptureProposal(undefined);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setBusyAction(undefined);
    }
  };
  const projectRevision = async (revision: ProjectWorkflowRevisionV1): Promise<void> => {
    setBusyAction('project');
    setError(undefined);
    try {
      setProjectedRevision(await onProjectRevision(revision));
    } catch (projectionError) {
      setError(projectionError instanceof Error
        ? projectionError.message
        : String(projectionError));
    } finally {
      setBusyAction(undefined);
    }
  };

  if (!snapshot) {
    return (
      <div className="workflow-design-loading">
        {error ?? t('workflowAuthoring.loading')}
      </div>
    );
  }

  return (
    <div className="workflow-design-body">
      <nav className="workflow-design-rail" aria-label={t('workflowWorkspace.designMode')}>
        <header><strong>{t('workflowAuthoring.source')}</strong></header>
        <button
          type="button"
          className={!selectedDraft ? 'is-active' : undefined}
          onClick={() => setSelectedDraftId(undefined)}
        >
          <strong>{sourceLabel}</strong>
          <small>{sourceWorkflowId}</small>
        </button>
        <WorkflowDesignCapture
          busy={Boolean(busyAction)}
          onCapture={() => void captureSelection()}
          onPreview={() => void previewSelection()}
          proposal={captureProposal}
          selectedBlockCount={selectedBlockIds.length}
        />
        <header><strong>{t('workflowAuthoring.drafts')}</strong><small>{snapshot.drafts.length}</small></header>
        {snapshot.drafts.map((draft) => (
          <button
            key={draft.draftId}
            type="button"
            className={draft.draftId === selectedDraftId ? 'is-active' : undefined}
            onClick={() => setSelectedDraftId(draft.draftId)}
          >
            <strong>{draft.definition.name}</strong>
            <small>{draft.definition.version} · v{draft.recordVersion}</small>
          </button>
        ))}
        <WorkflowDesignRevisionList
          onProjectRevision={projectRevision}
          revisions={activeRevisions}
        />
        {error ? <p className="workflow-design-rail-error">{error}</p> : null}
      </nav>

      <main className="workflow-workspace-graph workflow-design-graph">
        {graph && selectedDraft && workingDefinition && workingTemplate ? (
          <ReactFlowProvider>
            <ReactFlow<WorkflowDesignStepNodeType, WorkflowDesignDependencyEdgeType>
              id="workflow-design-graph"
              key={selectedDraft?.draftId}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesConnectable={false}
              edgesFocusable={false}
              deleteKeyCode={null}
              ariaLabelConfig={{
                'node.a11yDescription.default': t('workflowAuthoring.graphNodeDescription'),
                'node.a11yDescription.keyboardDisabled': t('workflowAuthoring.graphNodeDescription'),
              }}
              fitView
              fitViewOptions={{ maxZoom: 1, padding: 0.22 }}
              minZoom={0.35}
              maxZoom={1.5}
              onNodeClick={(_, node) => setSelectedStepId(node.id)}
              onNodeDragStop={(_, node) => setWorkingTemplate((current) => (
                current ? {
                  ...current,
                  positions: current.positions.map((position) => (
                    position.stepId === node.id
                      ? { ...position, x: node.position.x, y: node.position.y }
                      : position
                  )),
                } : current
              ))}
            >
              <Background gap={20} size={1} />
              <Controls showInteractive={false} />
              {nodes.length === 0 && !stepCreatorContext ? (
                <Panel position="top-left" className="workflow-design-first-step">
                  <strong>{t('workflowAuthoring.addFirstStep')}</strong>
                  <button
                    type="button"
                    onClick={() => setStepCreatorContext({ kind: 'first' })}
                  >
                    {t('workflowAuthoring.chooseCapability')}
                  </button>
                </Panel>
              ) : null}
              {stepCreatorContext ? (
                <Panel position="top-right" className="workflow-design-step-creator-panel">
                  <WorkflowDesignAddStep
                    context={stepCreatorContext}
                    definition={workingDefinition}
                    onAdd={(definition, stepId) => {
                      setWorkingDefinition(definition);
                      setWorkingTemplate(addWorkflowAuthoringProjectionPosition({
                        context: stepCreatorContext,
                        projectionTemplate: workingTemplate,
                        stepId,
                      }));
                      setSelectedStepId(stepId);
                    }}
                    onClose={closeStepCreator}
                  />
                </Panel>
              ) : null}
            </ReactFlow>
          </ReactFlowProvider>
        ) : (
          <div className="workflow-design-empty">
            <Copy size={22} />
            <strong>{t('workflowAuthoring.noDraft')}</strong>
            <button type="button" disabled={busyAction === 'fork'} onClick={() => void forkSource()}>
              {t('workflowAuthoring.createCopy')}
            </button>
          </div>
        )}
      </main>

      <aside className="workflow-design-inspector">
        <header><strong>{selectedStep ? selectedStep.stepId : t('workflowAuthoring.metadata')}</strong></header>
        {workingDefinition && workingTemplate && selectedDraft ? (
          <div className="workflow-design-inspector-content">
            <div className={`workflow-design-validation${validation?.valid ? ' is-valid' : ' is-invalid'}`}>
              {validation?.valid ? <CircleCheck size={14} /> : <TriangleAlert size={14} />}
              <span>{validation?.valid ? t('workflowAuthoring.valid') : `${validation?.issues.length ?? 0} ${t('workflowAuthoring.issues')}`}</span>
              {dirty ? <small>{t('workflowAuthoring.unsaved')}</small> : null}
            </div>
            <WorkflowDesignValidationChecklist
              items={checklist}
              onLocateStep={locateStep}
            />
            {projectedRevision ? (
              <WorkflowDesignProjectionResult
                onCreateWorkflowRun={onCreateWorkflowRun}
                projection={projectedRevision}
              />
            ) : null}
            <WorkflowDesignMetadata
              collapsed={Boolean(selectedStep)}
              definition={workingDefinition}
              onChange={setWorkingDefinition}
            />
            {selectedStep ? (
              <WorkflowDesignStepInspector
                definition={workingDefinition}
                issues={validation?.issues ?? []}
                onChange={setWorkingDefinition}
                onRemove={(stepId) => {
                  setWorkingTemplate({
                    ...workingTemplate,
                    positions: workingTemplate.positions.filter((position) => position.stepId !== stepId),
                  });
                  setSelectedStepId(workingDefinition.steps.find((step) => step.stepId !== stepId)?.stepId);
                }}
                stepId={selectedStep.stepId}
              />
            ) : null}
            {error ? <p className="workflow-design-error">{error}</p> : null}
            <div className="workflow-design-actions">
              <button type="button" disabled={!dirty || Boolean(busyAction)} onClick={() => void saveDraft()}>
                <Save size={14} />{t('workflowAuthoring.save')}
              </button>
              <button
                type="button"
                disabled={!validation?.valid || Boolean(busyAction)}
                onClick={() => void publishDraft()}
              >
                <Send size={14} />{t('workflowAuthoring.publish')}
              </button>
            </div>
            {selectedDraft.publishedRevisionId ? (
              <small className="workflow-design-published">
                {t('workflowAuthoring.publishedRevision')} · {selectedDraft.publishedRevisionId}
              </small>
            ) : null}
          </div>
        ) : (
          <p>{t('workflowAuthoring.selectDraft')}</p>
        )}
      </aside>
    </div>
  );
}
