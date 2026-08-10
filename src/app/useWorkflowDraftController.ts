import { resolveExecutionConnectionPreference } from '../core/executionProviderPreferences';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import type { BoardSnapshot } from '../core/types';
import { projectWorkflowDraft } from '../core/workflowDraftProjection';
import type { ResolvedPackageEntryPointTarget } from '../core/packageRegistry';
import type { ResolvedPackageComposerInvocation } from '../core/packageComposer';
import {
  resolvedWorkflowUiDefinitionFor,
  upsertProjectWorkflowDefinition,
} from '../core/workflowRegistry';
import type { useI18n } from '../i18n';
import { textGenerationLabelsForSkill } from './skillTextLabels';
import type { ProjectWorkflowRevisionV1 } from '../core/workflowAuthoringContracts';

interface WorkflowDraftControllerOptions {
  centerBlockGroup: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  focusWorkflowBlocks: (blockIds: string[]) => void;
  locale: string;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export interface ProjectedWorkflowRevisionResult {
  blockIds: string[];
  groupBlockId: string;
  revisionId: string;
}

export function useWorkflowDraftController(options: WorkflowDraftControllerOptions) {
  const {
    centerBlockGroup,
    focusWorkflowBlocks,
    locale,
    setSelectedBlocks,
    t,
    updateSnapshot,
  } = options;

  function createWorkflowDraft(
    target: Extract<ResolvedPackageEntryPointTarget, { kind: 'workflow' }>,
    composer?: ResolvedPackageComposerInvocation,
  ): void {
    const workflowId = target.entrypoint.ref.workflowDefinitionId;
    let workflowBlockIds: string[] = [];
    let workflowGroupId = '';
    const nextSnapshot = updateSnapshot((current) => {
      const ui = resolvedWorkflowUiDefinitionFor(workflowId, locale);
      const projection = projectWorkflowDraft(current, {
        workflowId,
        workflowTitle: ui.name,
        outputPlaceholder: t('workflowDraft.outputPending'),
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
        labelsForSkill: (skillId) => textGenerationLabelsForSkill(skillId, locale, t),
        connectionIdForCapability: (capabilityId) => {
          const definition = capabilityDefinitionFor(capabilityId);
          const useCase = definition.outputSlots.some((slot) => slot.dataType === 'image') ? 'image' : 'text';
          return resolveExecutionConnectionPreference({
            capabilityId,
            initialConnectionId: 'codex-app-server',
            projectId: current.project.projectId,
            useCase,
          }).connectionId;
        },
      });
      workflowBlockIds = projection.blockIds;
      workflowGroupId = projection.groupBlock.blockId;
      centerBlockGroup(current, workflowBlockIds);
      return current;
    }, { history: true, persist: true });
    if (workflowBlockIds.length === 0) return;
    setSelectedBlocks(nextSnapshot, workflowGroupId ? [workflowGroupId] : workflowBlockIds);
    focusWorkflowBlocks(workflowBlockIds);
  }

  function projectPublishedWorkflowRevision(
    revision: ProjectWorkflowRevisionV1,
  ): ProjectedWorkflowRevisionResult {
    let workflowBlockIds: string[] = [];
    let workflowGroupId = '';
    const nextSnapshot = updateSnapshot((current) => {
      if (current.project.projectId !== revision.projectId) {
        throw new Error(
          `Project Workflow Revision belongs to another Project: ${revision.projectId}`,
        );
      }
      upsertProjectWorkflowDefinition(revision.projectId, revision.definition);
      const projection = projectWorkflowDraft(current, {
        connectionIdForCapability: (capabilityId) => {
          const definition = capabilityDefinitionFor(capabilityId);
          const useCase = definition.outputSlots.some((slot) => slot.dataType === 'image')
            ? 'image'
            : 'text';
          return resolveExecutionConnectionPreference({
            capabilityId,
            initialConnectionId: 'codex-app-server',
            projectId: current.project.projectId,
            useCase,
          }).connectionId;
        },
        labelsForSkill: (skillId) => textGenerationLabelsForSkill(skillId, locale, t),
        outputPlaceholder: t('workflowDraft.outputPending'),
        projectionTemplate: revision.projectionTemplate,
        projectRevisionId: revision.revisionId,
        workflowDefinition: revision.definition,
        workflowId: revision.definition.workflowId,
        workflowTitle: revision.definition.name,
      });
      workflowBlockIds = projection.blockIds;
      workflowGroupId = projection.groupBlock.blockId;
      centerBlockGroup(current, workflowBlockIds);
      return current;
    }, { history: true, persist: true });
    if (workflowBlockIds.length === 0 || !workflowGroupId) {
      throw new Error(`Project Workflow Revision projection created no Workflow Group: ${revision.revisionId}`);
    }
    setSelectedBlocks(nextSnapshot, workflowGroupId ? [workflowGroupId] : workflowBlockIds);
    focusWorkflowBlocks(workflowBlockIds);
    return {
      blockIds: workflowBlockIds,
      groupBlockId: workflowGroupId,
      revisionId: revision.revisionId,
    };
  }

  return { createWorkflowDraft, projectPublishedWorkflowRevision };
}
