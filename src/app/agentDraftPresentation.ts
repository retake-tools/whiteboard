import type { BoardSnapshot } from '../core/types';
import {
  resolveAgentExecutionConnection,
} from '../core/executionProviderPreferences';
import { resolvedWorkflowUiDefinitionFor, workflowDefinitionFor } from '../core/workflowRegistry';
import type { useI18n } from '../i18n';
import type { WhiteboardAgentDraftPresentationV1 } from '../whiteboard/application/whiteboardAgentWorkspaceCommands';
import { textGenerationLabelsForSkill } from './skillTextLabels';

export function createAgentDraftPresentation(input: {
  explicitConnectionId?: string;
  locale: string;
  placementCenter: { x: number; y: number };
  proposalId: string;
  snapshot: BoardSnapshot;
  t: ReturnType<typeof useI18n>['t'];
}): WhiteboardAgentDraftPresentationV1 {
  const proposal = input.snapshot.changeProposals?.find(
    (candidate) => candidate.proposalId === input.proposalId,
  );
  if (!proposal) throw new Error(`Change Proposal not found: ${input.proposalId}`);
  const invocation = proposal.proposedCommand.kind === 'package_entrypoint.instantiate'
    ? proposal.proposedCommand.invocation
    : proposal.proposedCommand.kind === 'goal_plan.instantiate'
      ? proposal.proposedCommand.draftCommand.invocation
      : undefined;
  const capabilityIds: string[] = [];
  const skillIds: string[] = [];
  let workflowTitle: string | undefined;
  if (invocation?.targetLock.entrypointKind === 'skill') {
    capabilityIds.push(invocation.targetLock.capabilityLock.capabilityId);
    skillIds.push(invocation.targetLock.skillLock.skillId);
  } else if (invocation?.targetLock.entrypointKind === 'workflow') {
    const workflowDefinitionId = invocation.targetLock.workflowDefinitionLock.workflowDefinitionId;
    const definition = workflowDefinitionFor(workflowDefinitionId);
    capabilityIds.push(...definition.steps.map((step) => step.capabilityLock.capabilityId));
    skillIds.push(...definition.steps.map((step) => step.skillLock.skillId));
    workflowTitle = resolvedWorkflowUiDefinitionFor(workflowDefinitionId, input.locale).name;
  }
  return {
    connectionIdsByCapability: Object.fromEntries(
      [...new Set(capabilityIds)].map((capabilityId) => [
        capabilityId,
        resolveAgentExecutionConnection({
          capabilityId,
          explicitConnectionId: input.explicitConnectionId,
          initialConnectionId: 'codex-app-server',
          projectId: input.snapshot.project.projectId,
        })?.connectionId,
      ]),
    ),
    labelsBySkillId: Object.fromEntries(
      [...new Set(skillIds)].map((skillId) => [
        skillId,
        textGenerationLabelsForSkill(skillId, input.locale, input.t),
      ]),
    ),
    outputPlaceholder: input.t('workflowDraft.outputPending'),
    placementCenter: input.placementCenter,
    workflowTitle,
  };
}
