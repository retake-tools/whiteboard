import type { AdapterKind, GenerationProfileSnapshot } from './types';

export type GenerationParameterKey =
  | 'aspectRatio'
  | 'count'
  | 'duration'
  | 'motion'
  | 'resolution'
  | 'strength';

export type GenerationParameterSupport = 'supported' | 'best_effort' | 'unsupported';

export interface GenerationProfile {
  generationProfileId: string;
  name: string;
  source: 'builtin' | 'plugin' | 'user';
  adapter: AdapterKind;
  agentHost?: 'codex' | 'claude' | 'cursor' | 'other';
  provider?: string;
  model?: string;
  editable: boolean;
  isDefault: boolean;
  supportedCapabilities: string[];
  parameterSupport: Partial<Record<GenerationParameterKey, GenerationParameterSupport>>;
  version: number;
}

export const defaultGenerationProfileId = 'codex-managed';

const builtInGenerationProfiles: GenerationProfile[] = [
  {
    generationProfileId: defaultGenerationProfileId,
    name: 'Codex Managed',
    source: 'builtin',
    adapter: 'mcp_agent',
    agentHost: 'codex',
    editable: false,
    isDefault: true,
    supportedCapabilities: [
      'image.annotation_edit',
      'image.image_to_image',
      'image.text_to_image',
    ],
    parameterSupport: {
      aspectRatio: 'best_effort',
      count: 'supported',
      resolution: 'unsupported',
      strength: 'unsupported',
    },
    version: 1,
  },
];

export function listGenerationProfiles(userProfiles: readonly GenerationProfile[] = []): GenerationProfile[] {
  const builtInIds = new Set(builtInGenerationProfiles.map((profile) => profile.generationProfileId));
  const acceptedUserIds = new Set<string>();
  const acceptedUserProfiles = userProfiles.filter((profile) => {
    if (profile.source !== 'user' || !profile.editable || builtInIds.has(profile.generationProfileId)) return false;
    if (acceptedUserIds.has(profile.generationProfileId)) return false;
    acceptedUserIds.add(profile.generationProfileId);
    return true;
  });

  return [...builtInGenerationProfiles, ...acceptedUserProfiles].map(cloneGenerationProfile);
}

export function generationProfileById(
  generationProfileId: unknown,
  userProfiles: readonly GenerationProfile[] = [],
): GenerationProfile {
  const generationProfiles = listGenerationProfiles(userProfiles);
  if (typeof generationProfileId === 'string') {
    const profile = generationProfiles.find((candidate) => candidate.generationProfileId === generationProfileId);
    if (profile) return profile;
  }
  const distributedDefault = generationProfiles.find(
    (profile) => profile.generationProfileId === defaultGenerationProfileId,
  );
  if (!distributedDefault) throw new Error('Built-in Codex Managed generation profile is missing.');
  return distributedDefault;
}

export function generationProfilesForCapability(
  capabilityId: string,
  userProfiles: readonly GenerationProfile[] = [],
): GenerationProfile[] {
  const generationProfiles = listGenerationProfiles(userProfiles);
  const matches = generationProfiles.filter((profile) => profile.supportedCapabilities.includes(capabilityId));
  return matches.length ? matches : [generationProfileById(defaultGenerationProfileId, userProfiles)];
}

export function generationParameterSupport(
  profile: GenerationProfile,
  key: GenerationParameterKey,
): GenerationParameterSupport {
  return profile.parameterSupport[key] ?? 'unsupported';
}

export function generationParameterVisible(profile: GenerationProfile, key: GenerationParameterKey): boolean {
  return generationParameterSupport(profile, key) !== 'unsupported';
}

export function snapshotGenerationProfile(
  generationProfileId: unknown,
  userProfiles: readonly GenerationProfile[] = [],
): GenerationProfileSnapshot {
  const profile = generationProfileById(generationProfileId, userProfiles);
  return {
    generationProfileId: profile.generationProfileId,
    name: profile.name,
    version: profile.version,
    source: profile.source,
    adapter: profile.adapter,
    agentHost: profile.agentHost,
    provider: profile.provider,
    model: profile.model,
  };
}

function cloneGenerationProfile(profile: GenerationProfile): GenerationProfile {
  return {
    ...profile,
    supportedCapabilities: [...profile.supportedCapabilities],
    parameterSupport: { ...profile.parameterSupport },
  };
}
