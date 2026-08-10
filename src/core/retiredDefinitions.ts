import type { RetakePackageEntryPoint, RetakePackageManifest } from './packageContracts';

export const retiredGuidedImageAgentPresetId = 'retake.agent.guided-image-operator';
export const retiredGuidedImageSkillId = 'retake.image.guided-edit';
export const retiredGuidedImageWorkflowId = 'retake.workflow.guided-image-review';

export function withoutRetiredPackageDefinitions(
  manifests: RetakePackageManifest[],
): RetakePackageManifest[] {
  return manifests.map((manifest) => ({
    ...structuredClone(manifest),
    components: {
      ...structuredClone(manifest.components),
      agentPresets: manifest.components.agentPresets.filter(
        (lock) => lock.agentPresetId !== retiredGuidedImageAgentPresetId,
      ),
      skills: manifest.components.skills.filter(
        (lock) => lock.skillId !== retiredGuidedImageSkillId,
      ),
      workflows: manifest.components.workflows.filter(
        (lock) => lock.workflowDefinitionId !== retiredGuidedImageWorkflowId,
      ),
    },
    entrypoints: manifest.entrypoints.filter((entrypoint) => (
      !isRetiredPackageEntrypoint(entrypoint)
    )),
  }));
}

function isRetiredPackageEntrypoint(entrypoint: RetakePackageEntryPoint): boolean {
  if (entrypoint.kind === 'skill') {
    return entrypoint.ref.skillId === retiredGuidedImageSkillId;
  }
  if (entrypoint.kind === 'workflow') {
    return entrypoint.ref.workflowDefinitionId === retiredGuidedImageWorkflowId;
  }
  return entrypoint.ref.agentPresetId === retiredGuidedImageAgentPresetId;
}

export class RetiredDefinitionError extends Error {
  readonly code = 'retired_definition';

  constructor(message: string) {
    super(message);
    this.name = 'RetiredDefinitionError';
  }
}

export function retiredSkillExecutionError(skillId: string): RetiredDefinitionError | undefined {
  if (skillId !== retiredGuidedImageSkillId) return undefined;
  return new RetiredDefinitionError(
    'This retired image-editing flow is read-only. Start a regular image-to-image task from the original image.',
  );
}

export function isRetiredDefinitionError(error: unknown): boolean {
  return error instanceof RetiredDefinitionError
    || (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'retired_definition'
    );
}
