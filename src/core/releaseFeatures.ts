export interface ReleaseEnvironment {
  DEV: boolean;
}

export const releaseFeatures: Record<'skillDock', 'development_only' | 'enabled'> = {
  skillDock: 'enabled',
};

export function shouldShowSkillDock(environment: ReleaseEnvironment): boolean {
  return releaseFeatures.skillDock === 'enabled' || environment.DEV;
}
