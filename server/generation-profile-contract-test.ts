import {
  defaultGenerationProfileId,
  generationProfileById,
  listGenerationProfiles,
  type GenerationProfile,
} from '../src/core/generationProfiles';

const distributedProfiles = listGenerationProfiles();
if (distributedProfiles.length !== 1) {
  throw new Error(`Expected one distributed generation profile, found ${distributedProfiles.length}`);
}

const codexManaged = distributedProfiles[0];
if (
  codexManaged?.generationProfileId !== defaultGenerationProfileId ||
  codexManaged.source !== 'builtin' ||
  codexManaged.editable ||
  !codexManaged.isDefault ||
  codexManaged.adapter !== 'mcp_agent' ||
  codexManaged.agentHost !== 'codex'
) {
  throw new Error('Expected Codex Managed to be the immutable distributed default');
}

const userProfile: GenerationProfile = {
  generationProfileId: 'user-openai-image',
  name: 'My OpenAI Image API',
  source: 'user',
  adapter: 'direct_api',
  provider: 'openai',
  model: 'gpt-image',
  editable: true,
  isDefault: false,
  supportedCapabilities: ['image.text_to_image'],
  parameterSupport: { aspectRatio: 'supported', count: 'supported', resolution: 'supported' },
  version: 1,
};
const attemptedOverride: GenerationProfile = {
  ...userProfile,
  generationProfileId: defaultGenerationProfileId,
  name: 'Override attempt',
};
const configuredProfiles = listGenerationProfiles([userProfile, attemptedOverride, userProfile]);

if (configuredProfiles.length !== 2 || configuredProfiles[0]?.name !== 'Codex Managed') {
  throw new Error('Expected user profiles to extend, not replace, the distributed profile catalog');
}
if (configuredProfiles.filter((profile) => profile.generationProfileId === defaultGenerationProfileId).length !== 1) {
  throw new Error('Expected the built-in Codex Managed profile id to be protected');
}
if (generationProfileById('missing-profile', [userProfile]).generationProfileId !== defaultGenerationProfileId) {
  throw new Error('Expected missing profile ids to fall back explicitly to Codex Managed');
}

distributedProfiles[0].name = 'Mutated copy';
if (listGenerationProfiles()[0]?.name !== 'Codex Managed') {
  throw new Error('Expected callers to receive copies of the distributed profile catalog');
}

console.log(
  JSON.stringify(
    {
      distributedDefault: defaultGenerationProfileId,
      distributedProfiles: listGenerationProfiles().map((profile) => profile.generationProfileId),
      configuredProfiles: configuredProfiles.map((profile) => profile.generationProfileId),
      overrideProtected: true,
    },
    null,
    2,
  ),
);
