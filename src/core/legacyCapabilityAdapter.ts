import {
  schemaForCapability,
  type CapabilityInputContract,
  type CapabilityInputSource,
  type CapabilityInputType,
  type CapabilityOutputType,
  type CapabilitySchema,
} from './capabilities';
import type {
  CapabilityBindingKind,
  CapabilityCardinality,
  CapabilityDataType,
  CapabilityDefinition,
  CapabilityInputSlotDefinition,
  CapabilityOutputSlotDefinition,
} from './capabilityContracts';

const legacyCapabilityVersion = '0.1.0';

export function definitionForLegacyCapability(capabilityId: string): CapabilityDefinition {
  const schema = schemaForCapability(capabilityId);
  if (schema.capabilityId !== capabilityId) throw new Error(`Unknown legacy capability: ${capabilityId}`);
  return capabilityDefinitionFromLegacy(schema);
}

export function capabilityDefinitionFromLegacy(schema: CapabilitySchema): CapabilityDefinition {
  return {
    schemaVersion: 1,
    capabilityId: schema.capabilityId,
    version: legacyCapabilityVersion,
    definitionHash: `legacy:${schema.capabilityId}:schema-v1`,
    category: capabilityCategory(schema.capabilityId),
    displayName: schema.displayNameKey,
    inputSlots: legacyInputSlots(schema.inputContracts),
    outputSlots: legacyOutputSlots(schema),
    parametersSchemaRef: `legacy.params.${schema.capabilityId}/v1`,
    runtimeRequirements: legacyRuntimeRequirements(schema),
    supportedAdapterClasses: legacyAdapterClasses(schema),
  };
}

function legacyInputSlots(contracts: CapabilityInputContract[]): CapabilityInputSlotDefinition[] {
  const slots: CapabilityInputSlotDefinition[] = [];
  const usedSlotIds = new Set<string>();

  for (const contract of contracts) {
    if (contract.type === 'text') {
      slots.push(createInputSlot({
        slotId: uniqueSlotId('prompt', usedSlotIds),
        semanticRole: 'prompt',
        dataType: 'text',
        contract,
      }));
      continue;
    }

    if (contract.type === 'image' && contract.roles?.includes('source') && contract.requiredRoles?.includes('source')) {
      slots.push(createInputSlot({
        slotId: uniqueSlotId('source_image', usedSlotIds),
        semanticRole: 'source',
        dataType: 'image',
        contract: { ...contract, role: 'source', required: true, min: 1, max: 1 },
      }));
      const referenceRoles = contract.roles.filter((role) => role !== 'source');
      if (referenceRoles.length > 0) {
        slots.push(createInputSlot({
          slotId: uniqueSlotId('references', usedSlotIds),
          semanticRole: 'reference',
          dataType: 'image',
          contract: { ...contract, role: undefined, roles: referenceRoles, requiredRoles: [], required: false, min: 0 },
        }));
      }
      continue;
    }

    const semanticRole = contract.role ?? (contract.roles?.length ? 'reference' : semanticRoleForType(contract.type));
    const preferredSlotId = slotIdForContract(contract, semanticRole);
    slots.push(createInputSlot({
      slotId: uniqueSlotId(preferredSlotId, usedSlotIds),
      semanticRole,
      dataType: contract.type,
      contract,
    }));
  }

  return slots;
}

function createInputSlot(input: {
  slotId: string;
  semanticRole: string;
  dataType: CapabilityInputType;
  contract: CapabilityInputContract;
}): CapabilityInputSlotDefinition {
  return {
    slotId: input.slotId,
    semanticRole: input.semanticRole,
    dataTypes: [input.dataType],
    artifactTypes: artifactTypesFor(input.dataType, input.semanticRole),
    cardinality: cardinalityFor(input.contract),
    required: input.contract.required,
    bindingKinds: bindingKindsFor(input.contract.source),
  };
}

function legacyOutputSlots(schema: CapabilitySchema): CapabilityOutputSlotDefinition[] {
  const usedSlotIds = new Set<string>();
  return schema.outputContracts.map((contract) => ({
    slotId: uniqueSlotId(outputSlotId(contract.type), usedSlotIds),
    semanticRole: `generated_${contract.type}`,
    dataType: contract.type,
    artifactType: contract.type === 'image' ? 'image' : contract.type === 'video' ? 'video_clip' : 'markdown_document',
    schemaRef: contract.type === 'image'
      ? 'retake.image-set/v1'
      : contract.type === 'video'
        ? 'retake.video-set/v1'
        : 'retake.markdown-document/v1',
    cardinality: schema.paramsSchema.count ? 'many' : 'one',
    projectionBlockTypes: [contract.type],
  }));
}

function cardinalityFor(contract: CapabilityInputContract): CapabilityCardinality {
  if (contract.max === 1) return contract.required ? 'one' : 'optional';
  if (contract.max === 'many' || typeof contract.max === 'number' && contract.max > 1) return 'many';
  return contract.required ? 'one' : 'optional';
}

function bindingKindsFor(source: CapabilityInputSource | undefined): CapabilityBindingKind[] {
  if (source === 'inline') return ['inline'];
  if (source === 'generated_asset') return ['asset'];
  return ['block', 'asset', 'artifact_revision'];
}

function artifactTypesFor(dataType: CapabilityDataType, semanticRole: string): string[] {
  if (semanticRole === 'reference') return [];
  if (semanticRole.endsWith('_reference')) return [semanticRole];
  if (semanticRole === 'source' || semanticRole === 'annotated_composite') return [dataType];
  return [];
}

function slotIdForContract(contract: CapabilityInputContract, semanticRole: string): string {
  if (contract.role) return contract.role;
  if (contract.roles?.length) return 'references';
  if (contract.type === 'image') return 'images';
  if (contract.type === 'video') return 'source_video';
  return semanticRole;
}

function semanticRoleForType(type: CapabilityInputType): string {
  if (type === 'image') return 'image';
  if (type === 'video') return 'source_video';
  return 'prompt';
}

function outputSlotId(type: CapabilityOutputType): string {
  if (type === 'image') return 'images';
  if (type === 'video') return 'videos';
  return 'documents';
}

function capabilityCategory(capabilityId: string): string {
  if (capabilityId.startsWith('image.')) return 'image';
  if (capabilityId.startsWith('video.')) return 'video';
  return capabilityId.split('.')[0] ?? 'general';
}

function legacyRuntimeRequirements(schema: CapabilitySchema): string[] {
  const requirements = new Set<string>();
  for (const output of schema.outputContracts) requirements.add(`${output.type}_generation`);
  if (schema.capabilityId.includes('annotation_edit') || schema.capabilityId.includes('image_to_image')) {
    requirements.add('image_edit');
  }
  if (schema.defaultAdapter === 'local_canvas') requirements.add('local_transform');
  requirements.add('durable_asset_output');
  return [...requirements];
}

function legacyAdapterClasses(schema: CapabilitySchema): string[] {
  const classes = new Set<string>();
  for (const output of schema.outputContracts) {
    if (output.type === 'image') {
      classes.add(schema.capabilityId.includes('edit') || schema.capabilityId.includes('image_to_image')
        ? 'image.edit'
        : 'image.generate');
    } else if (output.type === 'video') {
      classes.add('video.generate');
    } else if (output.type === 'text' || output.type === 'document') {
      classes.add('text.generate');
    }
  }
  if (schema.supportedAdapters.some((adapter) => adapter === 'mcp_agent' || adapter === 'cli_agent')) {
    classes.add(schema.outputContracts.some((output) => output.type === 'text' || output.type === 'document')
      ? 'agent_runtime.text'
      : 'agent_runtime.media');
  }
  if (schema.supportedAdapters.includes('local_canvas')) classes.add('local.transform');
  if (schema.supportedAdapters.includes('manual_import')) classes.add('manual.import');
  return [...classes];
}

function uniqueSlotId(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let suffix = 2;
  while (used.has(`${preferred}_${suffix}`)) suffix += 1;
  const slotId = `${preferred}_${suffix}`;
  used.add(slotId);
  return slotId;
}
