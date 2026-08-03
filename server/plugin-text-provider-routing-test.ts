import assert from 'node:assert/strict';
import type { CapabilityDefinition } from '../src/core/capabilityContracts';
import { executionConnectorDefinition } from '../src/core/executionProviders';
import { replaceInstalledPluginCapabilityDefinitions } from '../src/core/pluginCapabilityDefinitions';

const pluginTextCapability: CapabilityDefinition = {
  schemaVersion: 1,
  capabilityId: 'design.test_character.define',
  version: '0.1.0',
  definitionHash: 'sha256:test-design-character-define-v1',
  category: 'production_design',
  displayName: 'Define test character',
  inputSlots: [{
    slotId: 'creative_brief',
    semanticRole: 'creative_brief',
    dataTypes: ['text', 'document'],
    artifactTypes: ['creative_brief'],
    cardinality: 'one',
    required: true,
    bindingKinds: ['inline', 'block', 'asset', 'artifact_revision'],
  }],
  outputSlots: [{
    slotId: 'character_bible',
    semanticRole: 'character_bible',
    dataType: 'document',
    artifactType: 'character_bible',
    schemaRef: 'retake.test-character-bible/v1',
    cardinality: 'one',
    projectionBlockTypes: ['document'],
  }],
  parametersSchemaRef: 'test.params.design.test_character.define/v1',
  runtimeRequirements: ['text_generation', 'durable_asset_output'],
  supportedAdapterClasses: ['text.document', 'agent_runtime.text'],
};

const agentOnlyTextCapability: CapabilityDefinition = {
  ...structuredClone(pluginTextCapability),
  capabilityId: 'design.test_agent_only.define',
  definitionHash: 'sha256:test-design-agent-only-define-v1',
  supportedAdapterClasses: ['agent_runtime.text'],
};

const mediaCapability: CapabilityDefinition = {
  ...structuredClone(pluginTextCapability),
  capabilityId: 'image.test.generate',
  definitionHash: 'sha256:test-image-generate-v1',
  outputSlots: [{
    slotId: 'images',
    semanticRole: 'generated_images',
    dataType: 'image',
    artifactType: 'image',
    schemaRef: 'retake.image-set/v1',
    cardinality: 'many',
    projectionBlockTypes: ['image'],
  }],
  runtimeRequirements: ['image_generation', 'durable_asset_output'],
  supportedAdapterClasses: ['agent_runtime.media'],
};

try {
  replaceInstalledPluginCapabilityDefinitions([
    pluginTextCapability,
    agentOnlyTextCapability,
    mediaCapability,
  ]);

  const codex = executionConnectorDefinition('codex-app-server');
  const openAI = executionConnectorDefinition('openai-compatible');
  const anthropic = executionConnectorDefinition('anthropic-native');
  const google = executionConnectorDefinition('google-native');
  const seedream = executionConnectorDefinition('volcengine-ark');

  assert.ok(codex && openAI && anthropic && google && seedream);
  assert.equal(codex.supportedCapabilityIds.includes(pluginTextCapability.capabilityId), true);
  assert.equal(codex.supportedCapabilityIds.includes(agentOnlyTextCapability.capabilityId), true);
  assert.equal(openAI.supportedCapabilityIds.includes(pluginTextCapability.capabilityId), true);
  assert.equal(anthropic.supportedCapabilityIds.includes(pluginTextCapability.capabilityId), true);
  assert.equal(google.supportedCapabilityIds.includes(pluginTextCapability.capabilityId), true);
  assert.equal(openAI.supportedCapabilityIds.includes(agentOnlyTextCapability.capabilityId), false);
  assert.equal(codex.supportedCapabilityIds.includes(mediaCapability.capabilityId), false);
  assert.equal(seedream.supportedCapabilityIds.includes(pluginTextCapability.capabilityId), false);
} finally {
  replaceInstalledPluginCapabilityDefinitions([]);
}

console.log(JSON.stringify({
  pluginCapabilityId: pluginTextCapability.capabilityId,
  directProviderRouting: true,
  agentProviderRouting: true,
  mediaCapabilityExcluded: true,
}));
