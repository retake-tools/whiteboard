import { resolveExecutionConnectionPreference } from '../core/executionProviderPreferences';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import type { ResolvedPackageEntryPointTarget } from '../core/packageRegistry';
import type { ResolvedPackageComposerInvocation } from '../core/packageComposer';
import {
  resolvedWorkflowUiDefinitionFor,
  workflowDefinitionFor,
  type WorkflowDefinition,
} from '../core/workflowRegistry';
import type { useI18n } from '../i18n';
import { textGenerationLabelsForSkill } from './skillTextLabels';
import type { ProjectWorkflowRevisionV1 } from '../core/workflowAuthoringContracts';
import type { RefObject } from 'react';
import type { BoardSnapshot } from '../core/types';
import type {
  WhiteboardProductCommandsV1,
  WhiteboardWorkflowProjectionPresentationV1,
} from '../whiteboard/application/whiteboardProductCommands';

interface WorkflowDraftControllerOptions {
  focusWorkflowBlocks: (blockIds: string[]) => void;
  getViewportCenter: () => { x: number; y: number };
  locale: string;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export interface ProjectedWorkflowRevisionResult {
  blockIds: string[];
  groupBlockId: string;
  revisionId: string;
}

export function useWorkflowDraftController(options: WorkflowDraftControllerOptions) {
  const {
    focusWorkflowBlocks,
    getViewportCenter,
    locale,
    runProductCommand,
    setSelectedBlocks,
    snapshotRef,
    t,
  } = options;

  async function createWorkflowDraft(
    target: Extract<ResolvedPackageEntryPointTarget, { kind: 'workflow' }>,
    composer?: ResolvedPackageComposerInvocation,
  ): Promise<void> {
    const workflowId = target.entrypoint.ref.workflowDefinitionId;
    const workflow = workflowDefinitionFor(workflowId);
    const ui = resolvedWorkflowUiDefinitionFor(workflowId, locale);
    const projectId = snapshotRef.current.project.projectId;
    const projection = await requireProductCommands(runProductCommand)(
      (commands) => commands.workflow.projectDraft({
        composerInput: composer ? {
          mentions: composer.invocation.mentions,
          inlineValues: composer.invocation.inlineValues ?? [],
          instruction: composer.instructionSlotId && composer.invocation.instruction
            ? { body: composer.invocation.instruction, slotId: composer.instructionSlotId }
            : undefined,
          parameters: composer.invocation.parameters ?? {},
        } : undefined,
        packageContext: {
          entrypointId: target.entrypoint.entrypointId,
          packageLock: target.packageLock,
        },
        presentation: projectionPresentation(workflow, projectId),
        projectId,
        workflowId,
        workflowTitle: ui.name,
      }),
      { history: true },
    );
    const nextSnapshot = snapshotRef.current;
    if (projection.blockIds.length === 0) return;
    setSelectedBlocks(nextSnapshot, [projection.groupBlockId]);
    focusWorkflowBlocks(projection.blockIds);
  }

  async function projectPublishedWorkflowRevision(
    revision: ProjectWorkflowRevisionV1,
  ): Promise<ProjectedWorkflowRevisionResult> {
    const projection = await requireProductCommands(runProductCommand)(
      (commands) => commands.workflow.projectRevision({
        presentation: projectionPresentation(revision.definition, revision.projectId),
        revision,
      }),
      { history: true },
    );
    if (projection.blockIds.length === 0 || !projection.groupBlockId) {
      throw new Error(`Project Workflow Revision projection created no Workflow Group: ${revision.revisionId}`);
    }
    setSelectedBlocks(snapshotRef.current, [projection.groupBlockId]);
    focusWorkflowBlocks(projection.blockIds);
    return {
      blockIds: projection.blockIds,
      groupBlockId: projection.groupBlockId,
      revisionId: revision.revisionId,
    };
  }

  return { createWorkflowDraft, projectPublishedWorkflowRevision };

  function projectionPresentation(
    workflow: WorkflowDefinition,
    projectId: string,
  ): WhiteboardWorkflowProjectionPresentationV1 {
    const capabilityIds = [...new Set(workflow.steps.map(
      (step) => step.capabilityLock.capabilityId,
    ))];
    const skillIds = [...new Set(workflow.steps.map((step) => step.skillLock.skillId))];
    return {
      connectionIdsByCapability: Object.fromEntries(capabilityIds.map((capabilityId) => {
        const definition = capabilityDefinitionFor(capabilityId);
        const useCase = definition.outputSlots.some((slot) => slot.dataType === 'image')
          ? 'image'
          : 'text';
        return [capabilityId, resolveExecutionConnectionPreference({
          capabilityId,
          initialConnectionId: 'codex-app-server',
          projectId,
          useCase,
        }).connectionId];
      })),
      labelsBySkillId: Object.fromEntries(skillIds.map((skillId) => [
        skillId,
        textGenerationLabelsForSkill(skillId, locale, t),
      ])),
      outputPlaceholder: t('workflowDraft.outputPending'),
      placementCenter: getViewportCenter(),
    };
  }
}

function requireProductCommands(
  runProductCommand: WorkflowDraftControllerOptions['runProductCommand'],
): NonNullable<WorkflowDraftControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard Workflow projection command facade is unavailable.');
  }
  return runProductCommand;
}
