export interface ReleaseEnvironment {
  DEV: boolean;
}

export function shouldShowSkillDock(environment: ReleaseEnvironment): boolean {
  return environment.DEV;
}
