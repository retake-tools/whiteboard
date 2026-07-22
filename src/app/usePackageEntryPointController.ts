import {
  resolvePackageEntryPoint,
  type ResolvedPackageEntryPointTarget,
} from '../core/packageRegistry';

interface PackageEntryPointControllerOptions {
  createSkillDraft: (target: Extract<ResolvedPackageEntryPointTarget, { kind: 'skill' }>) => void;
  createWorkflowDraft: (target: Extract<ResolvedPackageEntryPointTarget, { kind: 'workflow' }>) => void;
}

export function usePackageEntryPointController(options: PackageEntryPointControllerOptions) {
  function invokeEntryPoint(entrypointId: string): void {
    const resolution = resolvePackageEntryPoint({ entrypointId });
    if (resolution.status !== 'resolved') {
      throw new Error(`Package EntryPoint could not be resolved: ${entrypointId} (${resolution.status})`);
    }
    if (resolution.target.kind === 'skill') {
      options.createSkillDraft(resolution.target);
      return;
    }
    options.createWorkflowDraft(resolution.target);
  }

  return { invokeEntryPoint };
}
