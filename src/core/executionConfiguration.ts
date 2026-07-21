import { connectedInputBlocks, isLocalCanvasCapability, promptTextFromInputs } from './capabilities';
import { sourceImageAspectRatio } from './operationAspectRatio';
import { recordLegacyExecutionContractSnapshot } from './executionContractSnapshot';
import type {
  BlockRecord,
  BoardSnapshot,
  ExecutionConfigurationChange,
  ExecutionConfigurationChangeKind,
  ExecutionConfigurationInputSnapshot,
  ExecutionConfigurationParameterSnapshot,
  ExecutionConfigurationParameterValueType,
  ExecutionConfigurationSnapshot,
  ExecutionRecord,
} from './types';

export function currentOperationConfiguration(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
): ExecutionConfigurationSnapshot {
  const imageInputs = snapshot.edges
    .filter((edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input')
    .flatMap((edge): ExecutionConfigurationInputSnapshot[] => {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.sourceBlockId);
      if (block?.type !== 'image') return [];
      return [{
        assetId: typeof block.data.assetId === 'string' ? block.data.assetId : undefined,
        blockId: block.blockId,
        inputRole: edge.inputRole,
        title: block.data.title,
      }];
    })
    .sort((left, right) => left.blockId.localeCompare(right.blockId));
  const capabilityId =
    typeof operationBlock.data.capabilityId === 'string'
      ? operationBlock.data.capabilityId
      : 'image.text_to_image';
  const storedGenerationParams = isRecord(operationBlock.data.generationParams)
    ? operationBlock.data.generationParams
    : isRecord(operationBlock.data.localEditParams)
      ? operationBlock.data.localEditParams
      : {};
  const sourceAspectRatio = sourceImageAspectRatio(snapshot, operationBlock.blockId);
  const sourceAwareGenerationParams =
    (capabilityId === 'image.image_to_image' || capabilityId === 'image.edit' || capabilityId === 'image.generate.similar') &&
    sourceAspectRatio &&
    (
      storedGenerationParams.aspectRatioPreset === 'source' ||
      (
        !storedGenerationParams.aspectRatioPreset &&
        typeof storedGenerationParams.targetAspectRatio !== 'number' &&
        !(typeof storedGenerationParams.targetWidth === 'number' && typeof storedGenerationParams.targetHeight === 'number')
      )
    )
      ? {
          ...storedGenerationParams,
          aspectRatioPreset: 'source',
          targetAspectRatio: sourceAspectRatio,
        }
      : storedGenerationParams;
  const generationParams =
    capabilityId === 'image.text_to_image' &&
    !sourceAwareGenerationParams.aspectRatioPreset &&
    typeof sourceAwareGenerationParams.targetAspectRatio !== 'number' &&
    !(typeof sourceAwareGenerationParams.targetWidth === 'number' && typeof sourceAwareGenerationParams.targetHeight === 'number')
      ? {
          ...sourceAwareGenerationParams,
          aspectRatioPreset: '9:16',
          targetAspectRatio: 9 / 16,
        }
      : sourceAwareGenerationParams;

  return normalizeConfiguration({
    capabilityId,
    generationParams,
    generationProfileId:
      typeof operationBlock.data.generationProfileId === 'string'
        ? operationBlock.data.generationProfileId
        : undefined,
    imageInputs,
    prompt: isLocalCanvasCapability(capabilityId)
      ? ''
      : promptTextFromInputs(connectedInputBlocks(snapshot, operationBlock.blockId)) || operationBlock.data.body || '',
  });
}

export function queuedOperationConfigurationIsStale(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
): boolean {
  if (operationBlock.data.status !== 'queued') return false;
  const executionId = typeof operationBlock.data.sourceExecutionId === 'string'
    ? operationBlock.data.sourceExecutionId
    : undefined;
  const execution = executionId
    ? snapshot.executions.find((candidate) => candidate.executionId === executionId)
    : undefined;
  if (!execution || execution.status !== 'queued') return false;
  return configurationChanges(
    executionConfiguration(execution),
    currentOperationConfiguration(snapshot, operationBlock),
  ).length > 0;
}

export function recordExecutionConfiguration(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
): void {
  const inputBindings = readInputBindings(execution.params?.inputBindings);
  const imageInputs = execution.inputBlockIds.flatMap((blockId): ExecutionConfigurationInputSnapshot[] => {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'image');
    if (!block) return [];
    const binding = inputBindings.find((candidate) => candidate.blockId === block.blockId);
    return [{
      assetId:
        binding?.assetId ??
        (typeof block.data.assetId === 'string' ? block.data.assetId : undefined),
      blockId: block.blockId,
      inputRole: binding?.inputRole,
      title: block.data.title,
    }];
  });
  const generationParams = isRecord(execution.params?.generation)
    ? execution.params.generation
    : isRecord(execution.params?.localEdit)
      ? execution.params.localEdit
      : {};
  const configuration = normalizeConfiguration({
    capabilityId: execution.capabilityId,
    generationParams,
    generationProfileId:
      execution.generationProfile?.generationProfileId ??
      (typeof operationBlock.data.generationProfileId === 'string'
        ? operationBlock.data.generationProfileId
        : undefined),
    imageInputs,
    prompt: execution.prompt ?? '',
  });

  execution.configuration = configuration;
  execution.configurationFingerprint = configurationFingerprint(configuration);
  recordLegacyExecutionContractSnapshot(snapshot, execution, operationBlock);
}

export function assignExecutionVersion(snapshot: BoardSnapshot, execution: ExecutionRecord): void {
  if (typeof execution.operationVersion === 'number') return;
  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  if (!operationBlockId) return;
  const previousExecution = latestStartedExecutionForOperation(snapshot, operationBlockId, execution.executionId);
  const existingVersions = startedExecutionsForOperation(snapshot, operationBlockId, execution.executionId)
    .map((candidate) => executionVersionFor(snapshot, candidate))
    .filter((version): version is number => typeof version === 'number');
  execution.operationVersion = Math.max(0, ...existingVersions) + 1;
  execution.previousExecutionId = previousExecution?.executionId;
}

export function executionConfiguration(execution: ExecutionRecord): ExecutionConfigurationSnapshot {
  if (execution.configuration) return normalizeConfiguration(execution.configuration);
  const inputBindings = readInputBindings(execution.params?.inputBindings);
  const generationParams = isRecord(execution.params?.generation)
    ? execution.params.generation
    : isRecord(execution.params?.localEdit)
      ? execution.params.localEdit
      : {};
  return normalizeConfiguration({
    capabilityId: execution.capabilityId,
    generationParams,
    generationProfileId: execution.generationProfile?.generationProfileId,
    imageInputs: inputBindings.map((binding) => ({
      assetId: binding.assetId,
      blockId: binding.blockId,
      inputRole: binding.inputRole,
      title: binding.blockId,
    })),
    prompt: execution.prompt ?? '',
  });
}

export function configurationFingerprint(configuration: ExecutionConfigurationSnapshot): string {
  const normalized = normalizeConfiguration(configuration);
  const value = stableStringify({
    capabilityId: normalized.capabilityId,
    generationProfileId: normalized.generationProfileId,
    imageInputs: normalized.imageInputs.map(({ assetId, blockId, inputRole }) => ({ assetId, blockId, inputRole })),
    parameters: normalized.parameters,
    prompt: normalized.prompt,
    schemaVersion: normalized.schemaVersion,
  });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `cfg_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function configurationChanges(
  previous: ExecutionConfigurationSnapshot,
  current: ExecutionConfigurationSnapshot,
): ExecutionConfigurationChange[] {
  previous = normalizeConfiguration(previous);
  current = normalizeConfiguration(current);
  const changes: ExecutionConfigurationChange[] = [];
  if (previous.capabilityId !== current.capabilityId) {
    changes.push({ kind: 'capability', key: 'capabilityId', previous: previous.capabilityId, current: current.capabilityId });
  }
  if (previous.prompt !== current.prompt) {
    changes.push({ kind: 'prompt', key: 'prompt', previous: previous.prompt, current: current.prompt });
  }
  if (previous.generationProfileId !== current.generationProfileId) {
    changes.push({ kind: 'profile', key: 'generationProfileId', previous: previous.generationProfileId, current: current.generationProfileId });
  }

  const previousParameters = new Map((previous.parameters ?? []).map((parameter) => [parameter.key, parameter]));
  const currentParameters = new Map((current.parameters ?? []).map((parameter) => [parameter.key, parameter]));
  const parameterKeys = new Set([...previousParameters.keys(), ...currentParameters.keys()]);
  for (const key of [...parameterKeys].sort()) {
    const previousParameter = previousParameters.get(key);
    const currentParameter = currentParameters.get(key);
    if (
      stableStringify(previousParameter?.value) !== stableStringify(currentParameter?.value) ||
      previousParameter?.schemaId !== currentParameter?.schemaId ||
      previousParameter?.schemaVersion !== currentParameter?.schemaVersion ||
      previousParameter?.valueType !== currentParameter?.valueType
    ) {
      changes.push({
        kind: 'parameter',
        key,
        previous: previousParameter?.value,
        current: currentParameter?.value,
        previousParameter,
        currentParameter,
      });
    }
  }

  const previousInputs = new Map(previous.imageInputs.map((input) => [input.blockId, input]));
  const currentInputs = new Map(current.imageInputs.map((input) => [input.blockId, input]));
  const inputBlockIds = new Set([...previousInputs.keys(), ...currentInputs.keys()]);
  for (const blockId of [...inputBlockIds].sort()) {
    const previousInput = previousInputs.get(blockId);
    const currentInput = currentInputs.get(blockId);
    if (!previousInput || !currentInput || previousInput.assetId !== currentInput.assetId) {
      changes.push({ kind: 'input', key: blockId, blockId, previous: previousInput, current: currentInput });
    }
    if (previousInput && currentInput && previousInput.inputRole !== currentInput.inputRole) {
      changes.push({
        kind: 'role',
        key: blockId,
        blockId,
        previous: previousInput.inputRole,
        current: currentInput.inputRole,
      });
    }
  }
  return changes;
}

export function configurationChangeKinds(
  changes: readonly ExecutionConfigurationChange[],
): ExecutionConfigurationChangeKind[] {
  return [...new Set(changes.map((change) => change.kind))];
}

export function latestExecutionForOperation(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): ExecutionRecord | undefined {
  return executionsForOperation(snapshot, operationBlockId)[0];
}

export function executionsForOperation(snapshot: BoardSnapshot, operationBlockId: string): ExecutionRecord[] {
  return snapshot.executions
    .filter((execution) => execution.params?.operationBlockId === operationBlockId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function previousExecutionFor(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): ExecutionRecord | undefined {
  if (execution.previousExecutionId) {
    return snapshot.executions.find((candidate) => candidate.executionId === execution.previousExecutionId);
  }
  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  if (!operationBlockId) return undefined;
  const ordered = startedExecutionsForOperation(snapshot, operationBlockId);
  const index = ordered.findIndex((candidate) => candidate.executionId === execution.executionId);
  if (index >= 0) return ordered[index + 1];
  return latestStartedExecutionForOperation(snapshot, operationBlockId, execution.executionId);
}

export function executionVersionFor(snapshot: BoardSnapshot, execution: ExecutionRecord): number | undefined {
  if (!executionHasStarted(snapshot, execution)) return undefined;
  if (typeof execution.operationVersion === 'number') return execution.operationVersion;
  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  if (!operationBlockId) return 1;
  const oldestFirst = startedExecutionsForOperation(snapshot, operationBlockId).reverse();
  const index = oldestFirst.findIndex((candidate) => candidate.executionId === execution.executionId);
  return index >= 0 ? index + 1 : 1;
}

export function latestStartedExecutionForOperation(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  excludedExecutionId?: string,
): ExecutionRecord | undefined {
  return startedExecutionsForOperation(snapshot, operationBlockId, excludedExecutionId)[0];
}

export function executionHasStarted(snapshot: BoardSnapshot, execution: ExecutionRecord): boolean {
  if (execution.status === 'running' || execution.status === 'succeeded') return true;
  if (execution.status === 'queued') return false;
  return Boolean(
    execution.outputAssetIds.length ||
    snapshot.historyEvents?.some(
      (event) => event.type === 'execution_started' && event.executionId === execution.executionId,
    )
  );
}

function startedExecutionsForOperation(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  excludedExecutionId?: string,
): ExecutionRecord[] {
  return executionsForOperation(snapshot, operationBlockId).filter(
    (execution) => execution.executionId !== excludedExecutionId && executionHasStarted(snapshot, execution),
  );
}

function normalizeConfiguration(configuration: ExecutionConfigurationSnapshot): ExecutionConfigurationSnapshot {
  const generationParams = sortRecord(configuration.generationParams);
  return {
    capabilityId: configuration.capabilityId,
    generationParams,
    generationProfileId: configuration.generationProfileId,
    imageInputs: [...configuration.imageInputs].sort((left, right) => left.blockId.localeCompare(right.blockId)),
    parameters: normalizeParameters(
      configuration.capabilityId,
      generationParams,
      configuration.parameters,
    ),
    prompt: configuration.prompt.trim(),
    schemaVersion: configuration.schemaVersion ?? 1,
  };
}

function normalizeParameters(
  capabilityId: string,
  generationParams: Record<string, unknown>,
  parameters?: ExecutionConfigurationParameterSnapshot[],
): ExecutionConfigurationParameterSnapshot[] {
  const existingByKey = new Map((parameters ?? []).map((parameter) => [parameter.key, parameter]));
  return Object.entries(generationParams)
    .map(([key, value]) => {
      const existing = existingByKey.get(key);
      const definition = parameterDefinition(capabilityId, key, value);
      return {
        key,
        schemaId: existing?.schemaId ?? definition.schemaId,
        schemaVersion: existing?.schemaVersion ?? definition.schemaVersion,
        semantic: existing?.semantic ?? definition.semantic,
        value,
        valueType: existing?.valueType ?? definition.valueType,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function parameterDefinition(
  capabilityId: string,
  key: string,
  value: unknown,
): Omit<ExecutionConfigurationParameterSnapshot, 'key' | 'value'> {
  const known = knownParameterDefinitions[key];
  return {
    schemaId: `${capabilityId}:${key}`,
    schemaVersion: known?.schemaVersion ?? 1,
    semantic: known?.semantic,
    valueType: known?.valueType ?? inferParameterValueType(value),
  };
}

const knownParameterDefinitions: Record<
  string,
  Pick<ExecutionConfigurationParameterSnapshot, 'schemaVersion' | 'semantic' | 'valueType'>
> = {
  aspectRatioPreset: { schemaVersion: 1, semantic: 'aspect_ratio_preset', valueType: 'string' },
  durationSeconds: { schemaVersion: 1, semantic: 'duration_seconds', valueType: 'number' },
  model: { schemaVersion: 1, semantic: 'model_id', valueType: 'string' },
  motion: { schemaVersion: 1, semantic: 'motion_preset', valueType: 'string' },
  strength: { schemaVersion: 1, semantic: 'normalized_strength', valueType: 'number' },
  targetAspectRatio: { schemaVersion: 1, semantic: 'width_height_ratio', valueType: 'number' },
  targetHeight: { schemaVersion: 1, semantic: 'pixel_height', valueType: 'integer' },
  targetResolution: { schemaVersion: 1, semantic: 'resolution_preset', valueType: 'string' },
  targetWidth: { schemaVersion: 1, semantic: 'pixel_width', valueType: 'integer' },
  variationCount: { schemaVersion: 1, semantic: 'result_count', valueType: 'integer' },
};

function inferParameterValueType(value: unknown): ExecutionConfigurationParameterValueType {
  if (Array.isArray(value)) return 'array';
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function readInputBindings(value: unknown): ExecutionConfigurationInputSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((binding): ExecutionConfigurationInputSnapshot[] => {
    if (!isRecord(binding) || typeof binding.blockId !== 'string') return [];
    return [{
      assetId: typeof binding.assetId === 'string' ? binding.assetId : undefined,
      blockId: binding.blockId,
      inputRole: typeof binding.inputRole === 'string' ? binding.inputRole as ExecutionConfigurationInputSnapshot['inputRole'] : undefined,
      title: binding.blockId,
    }];
  });
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
