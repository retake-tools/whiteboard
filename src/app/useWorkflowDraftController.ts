import { resolveExecutionConnectionPreference } from '../core/executionProviderPreferences';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import type { BoardSnapshot } from '../core/types';
import { projectWorkflowDraft } from '../core/workflowDraftProjection';
import type { ResolvedPackageEntryPointTarget } from '../core/packageRegistry';
import type { ResolvedPackageComposerInvocation } from '../core/packageComposer';
import { workflowUiDefinitionFor } from '../core/workflowRegistry';
import type { useI18n } from '../i18n';
import { textGenerationLabelsForSkill } from './skillTextLabels';

interface WorkflowDraftControllerOptions {
  centerBlockGroup: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  focusWorkflowBlocks: (blockIds: string[]) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useWorkflowDraftController(options: WorkflowDraftControllerOptions) {
  const {
    centerBlockGroup,
    focusWorkflowBlocks,
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
      const ui = workflowUiDefinitionFor(workflowId);
      const projection = projectWorkflowDraft(current, {
        workflowId,
        workflowTitle: t(ui.nameKey),
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
        labelsForSkill: (skillId) => textGenerationLabelsForSkill(skillId, t),
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

  return { createWorkflowDraft };
}
