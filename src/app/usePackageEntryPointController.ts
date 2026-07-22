import {
  type ResolvedPackageEntryPointTarget,
} from '../core/packageRegistry';
import {
  resolvePackageComposerInvocation,
  type PackageComposerInvocation,
  type ResolvedPackageComposerInvocation,
} from '../core/packageComposer';
import type { BoardSnapshot } from '../core/types';
import type { RefObject } from 'react';

interface PackageEntryPointControllerOptions {
  createSkillDraft: (
    target: Extract<ResolvedPackageEntryPointTarget, { kind: 'skill' }>,
    composer: ResolvedPackageComposerInvocation,
  ) => void;
  createWorkflowDraft: (
    target: Extract<ResolvedPackageEntryPointTarget, { kind: 'workflow' }>,
    composer: ResolvedPackageComposerInvocation,
  ) => void;
  snapshotRef: RefObject<BoardSnapshot>;
}

export function usePackageEntryPointController(options: PackageEntryPointControllerOptions) {
  function invokeEntryPoint(invocation: PackageComposerInvocation): void {
    const resolved = resolvePackageComposerInvocation(options.snapshotRef.current, invocation);
    if (resolved.target.kind === 'skill') {
      options.createSkillDraft(resolved.target, resolved);
      return;
    }
    options.createWorkflowDraft(resolved.target, resolved);
  }

  return { invokeEntryPoint };
}
