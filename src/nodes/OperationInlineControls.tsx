import { AlertCircle, Check, ChevronRight, Clipboard, FileText, Loader2, Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { isLocalCanvasCapability, operationReadinessMessageKey, schemaForCapability } from '../core/capabilities';
import {
  currentExecutionProviderSettings,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import type { ExecutionConnectionStatus, ExecutionConnectionSummary } from '../core/executionProviders';
import {
  generationParameterSupport,
  generationParameterVisible,
  generationProfileById,
  type GenerationParameterKey,
  type GenerationProfile,
} from '../core/generationProfiles';
import type { ImageGenerationParams, SwitchableOperationMode } from '../core/imageOperations';
import { operationDisplayState } from '../core/operationDisplay';
import type { BlockData } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

type AspectPreset = 'source' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
type ResolutionPreset = '1K' | '2K' | '4K';
type MotionPreset = 'auto' | 'balanced' | 'dynamic' | 'subtle';

const parameterKeys: GenerationParameterKey[] = [
  'aspectRatio',
  'count',
  'duration',
  'motion',
  'resolution',
  'strength',
];

export function OperationInlineControls({ blockId, data }: { blockId: string; data: BlockData }): ReactElement {
  if (isLocalCanvasCapability(data.capabilityId)) return <LocalCanvasOperationControls data={data} />;
  return <GenerationOperationInlineControls blockId={blockId} data={data} />;
}

function LocalCanvasOperationControls({ data }: { data: BlockData }): ReactElement {
  const { t } = useI18n();
  const params = localAdjustmentParams(data.localEditParams);
  return (
    <div className="operation-inline-controls is-local-canvas" aria-label={t('operationToolbar.title')}>
      <div className="operation-option-row is-read-only">
        <span>{t('operationToolbar.executor')}</span>
        <strong>{t('operationToolbar.localProcessing')}</strong>
      </div>
      <div className="operation-option-row is-read-only">
        <span>{t('operationToolbar.params')}</span>
        <strong>{localAdjustmentSummary(params, t)}</strong>
      </div>
    </div>
  );
}

function GenerationOperationInlineControls({ blockId, data }: { blockId: string; data: BlockData }): ReactElement {
  const { t } = useI18n();
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const operation = operationModeFromCapability(data);
  const capabilityId = capabilityIdForOperationMode(operation, data);
  const isTextGeneration = capabilityId === 'text.generate';
  const paramsSchema = schemaForCapability(capabilityId).paramsSchema;
  const profile = generationProfileById(data.generationProfileId);
  const providerSettings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );
  const compatibleConnections = operationExecutionConnections(providerSettings?.connections ?? [], capabilityId);
  const selectedConnection = typeof data.connectionId === 'string'
    ? compatibleConnections.find((connection) => connection.connectionId === data.connectionId)
    : compatibleConnections.find((connection) => connection.connectionId === 'codex-managed') ?? compatibleConnections[0];
  const usesPromptHandoff = selectedConnection
    ? selectedConnection.connectorId === 'codex-managed'
    : (data.connectionId ?? 'codex-managed') === 'codex-managed';
  const parameterProfile = generationProfileForConnection(profile, selectedConnection);
  const sourceAspectRatio = operation === 'image_to_image'
    ? finiteNumber(data.operationSourceAspectRatio)
    : undefined;
  const params = normalizeOperationParams(
    data.generationParams,
    sourceAspectRatio,
    operation === 'text_to_image' ? '9:16' : '1:1',
  );
  const availableAspectOptions = sourceAspectRatio
    ? [{ label: t('operationToolbar.sourceAspectRatio'), value: 'source' as const }, ...standardAspectOptions]
    : standardAspectOptions;
  const hasVisibleParams = parameterKeys.some(
    (key) => paramsSchema[key] && generationParameterVisible(parameterProfile, key),
  );
  const displayState = operationDisplayState(data);
  const { isQueued, isRunning, readinessIssue, showReadinessIssue } = displayState;
  const automatedPending = !usesPromptHandoff && isQueued;
  const runDisabled = displayState.runDisabled || automatedPending || Boolean(providerSettings && selectedConnection?.status !== 'ready');
  const isLocked = data.groupContentLocked === true;
  const isRepeat = Boolean(data.sourceExecutionId);
  const queuedConfigurationStale = data.operationQueuedConfigurationStale === true;
  const readinessId = `${blockId}-operation-readiness`;

  function updateParams(nextParams: ImageGenerationParams): void {
    dispatchUpdateOperationGenerationParams(blockId, generationParamsForSchema(nextParams, paramsSchema));
  }

  function updateAspectPreset(aspectRatioPreset: AspectPreset): void {
    updateParams({
      ...params,
      ...paramsForPreset(aspectRatioPreset, params.targetResolution as ResolutionPreset, sourceAspectRatio),
      aspectRatioPreset,
    });
  }

  function updateResolution(targetResolution: ResolutionPreset): void {
    updateParams({
      ...params,
      ...paramsForPreset(params.aspectRatioPreset as AspectPreset, targetResolution, sourceAspectRatio),
      targetResolution,
    });
  }

  useEffect(() => {
    if (!isLocked) return;
    setIsParamsOpen(false);
    setIsGeneratorOpen(false);
  }, [isLocked]);

  useDismissiblePopover({
    active: isParamsOpen || isGeneratorOpen,
    insideSelector: '.operation-option-popover-wrap',
    onDismiss: () => {
      setIsParamsOpen(false);
      setIsGeneratorOpen(false);
    },
    rootRef: controlsRef,
  });

  return (
    <div ref={controlsRef} className="operation-inline-controls" aria-label={t('operationToolbar.title')}>
      <div className="operation-option-popover-wrap">
        <button
          type="button"
          className="operation-option-row"
          aria-expanded={isGeneratorOpen}
          disabled={isLocked}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setIsGeneratorOpen((current) => !current);
            setIsParamsOpen(false);
          }}
        >
          <span>{t('operationToolbar.generator')}</span>
          <strong>{selectedConnection ? connectionLabel(selectedConnection) : providerSettings ? t('settings.noCompatibleConnection') : profile.name}</strong>
          <ChevronRight size={15} />
        </button>
        {isGeneratorOpen && !isLocked ? (
          <div className="operation-side-popover operation-generator-popover">
            {compatibleConnections.map((option) => (
              <button
                key={option.connectionId}
                type="button"
                className={selectedConnection?.connectionId === option.connectionId ? 'is-selected' : undefined}
                disabled={option.status !== 'ready'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchUpdateOperationConnection(blockId, option.connectionId);
                  setIsGeneratorOpen(false);
                }}
              >
                <span>{connectionLabel(option)}{option.status === 'ready' ? '' : ` · ${connectionStatusText(option.status, t)}`}</span>
                {selectedConnection?.connectionId === option.connectionId ? <Check size={14} /> : null}
              </button>
            ))}
            {compatibleConnections.length === 0 ? <button type="button" disabled>{t('settings.noCompatibleConnection')}</button> : null}
          </div>
        ) : null}
      </div>
      {hasVisibleParams ? (
        <div className="operation-option-popover-wrap">
          <button
            type="button"
            className="operation-option-row"
            aria-expanded={isParamsOpen}
            disabled={isLocked}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setIsParamsOpen((current) => !current);
              setIsGeneratorOpen(false);
            }}
          >
            <span>{t('operationToolbar.params')}</span>
            <strong>{operationParamsSummary(params, paramsSchema, parameterProfile, t('operationToolbar.sourceAspectRatio'))}</strong>
            <ChevronRight size={15} />
          </button>
          {isParamsOpen && !isLocked ? (
            <div className="operation-side-popover operation-param-popover">
              {paramsSchema.aspectRatio && generationParameterVisible(parameterProfile, 'aspectRatio') ? (
                <ParameterGroup title={t('context.aspectRatio')} parameter="aspectRatio" profile={parameterProfile}>
                  <div className="operation-param-options is-aspect-options">
                    {availableAspectOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={params.aspectRatioPreset === option.value ? 'is-selected' : undefined}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateAspectPreset(option.value);
                        }}
                      >
                        <span className={`aspect-option-icon ${aspectOptionClassName(option.value, sourceAspectRatio)}`} aria-hidden />
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </ParameterGroup>
              ) : null}
              {paramsSchema.resolution && generationParameterVisible(parameterProfile, 'resolution') ? (
                <ParameterGroup title={t('context.resolution')} parameter="resolution" profile={parameterProfile}>
                  <div className="operation-param-options">
                    {resolutionOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={params.targetResolution === option ? 'is-selected' : undefined}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateResolution(option);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </ParameterGroup>
              ) : null}
              {paramsSchema.count && generationParameterVisible(parameterProfile, 'count') ? (
                <ParameterGroup title={t('operationToolbar.count')} parameter="count" profile={parameterProfile}>
                  <div className="operation-param-options">
                    {[1, 2, 3, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        className={params.variationCount === count ? 'is-selected' : undefined}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateParams({ ...params, variationCount: count });
                        }}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </ParameterGroup>
              ) : null}
              {paramsSchema.duration && generationParameterVisible(parameterProfile, 'duration') ? (
                <ParameterGroup title={t('operationToolbar.duration')} parameter="duration" profile={parameterProfile}>
                  <div className="operation-param-options">
                    {durationOptions.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        className={params.durationSeconds === duration ? 'is-selected' : undefined}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateParams({ ...params, durationSeconds: duration });
                        }}
                      >
                        {duration}s
                      </button>
                    ))}
                  </div>
                </ParameterGroup>
              ) : null}
              {paramsSchema.motion && generationParameterVisible(parameterProfile, 'motion') ? (
                <ParameterGroup title={t('operationToolbar.motion')} parameter="motion" profile={parameterProfile}>
                  <div className="operation-param-options">
                    {motionOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={params.motion === option.value ? 'is-selected' : undefined}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateParams({ ...params, motion: option.value });
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </ParameterGroup>
              ) : null}
              {paramsSchema.strength && generationParameterVisible(parameterProfile, 'strength') ? (
                <ParameterGroup title={t('operationToolbar.strength')} parameter="strength" profile={parameterProfile}>
                  <label className="operation-param-strength">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(params.strength * 100)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) => updateParams({ ...params, strength: Number(event.target.value) / 100 })}
                    />
                    <output>{Math.round(params.strength * 100)}%</output>
                  </label>
                </ParameterGroup>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {showReadinessIssue && readinessIssue ? (
        <div id={readinessId} className="operation-readiness" role="status">
          <AlertCircle size={14} />
          <span>{t(operationReadinessMessageKey(readinessIssue))}</span>
        </div>
      ) : null}
      <button
        type="button"
        className={`operation-run-button ${isRunning ? 'is-running' : ''} ${isQueued ? 'is-queued' : ''}`}
        aria-describedby={showReadinessIssue ? readinessId : undefined}
        disabled={runDisabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          dispatchRunOperation(blockId, queuedConfigurationStale);
        }}
      >
        {isRunning || automatedPending ? (
          <Loader2 size={15} />
        ) : isTextGeneration && !isRepeat ? (
          <FileText size={15} />
        ) : !usesPromptHandoff && !isRepeat ? (
          <Play size={15} />
        ) : isQueued && queuedConfigurationStale ? (
          <RefreshCw size={15} />
        ) : isQueued ? (
          <Clipboard size={15} />
        ) : isRepeat ? (
          <RefreshCw size={15} />
        ) : (
          <Clipboard size={15} />
        )}
        <span>
          {isRunning || automatedPending
            ? t('operationToolbar.running')
            : isTextGeneration
              ? t(isRepeat ? 'operationToolbar.generateAgain' : 'operationToolbar.generateText')
            : usesPromptHandoff && isQueued
              ? t(queuedConfigurationStale ? 'operationToolbar.updatePrompt' : 'feedback.copyPrompt')
              : isRepeat
                ? t('operationToolbar.generateAgain')
                : t(usesPromptHandoff ? 'operationToolbar.generatePrompt' : 'operationToolbar.generateImage')}
        </span>
      </button>
    </div>
  );
}

function localAdjustmentParams(value: unknown): { brightness: number; contrast: number; saturation: number } {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    brightness: finiteNumber(record.brightness) ?? 0,
    contrast: finiteNumber(record.contrast) ?? 0,
    saturation: finiteNumber(record.saturation) ?? 0,
  };
}

function localAdjustmentSummary(
  params: { brightness: number; contrast: number; saturation: number },
  t: ReturnType<typeof useI18n>['t'],
): string {
  return [
    `${t('context.brightness')} ${signedValue(params.brightness)}`,
    `${t('context.contrast')} ${signedValue(params.contrast)}`,
    `${t('context.saturation')} ${signedValue(params.saturation)}`,
  ].join(' · ');
}

function signedValue(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function ParameterGroup({
  children,
  parameter,
  profile,
  title,
}: {
  children: ReactElement;
  parameter: GenerationParameterKey;
  profile: GenerationProfile;
  title: string;
}): ReactElement {
  const { t } = useI18n();
  const support = generationParameterSupport(profile, parameter);
  const supportLabel =
    support === 'best_effort'
      ? t('operationToolbar.parameterBestEffort')
      : t('operationToolbar.parameterSupported');

  return (
    <div className="operation-param-group">
      <div className="operation-param-heading">
        <span className="operation-param-title">{title}</span>
        <span className={`operation-param-support is-${support}`}>{supportLabel}</span>
      </div>
      {children}
    </div>
  );
}

function dispatchRunOperation(blockId: string, queuedConfigurationStale: boolean): void {
  window.dispatchEvent(new CustomEvent('retake:run-operation', {
    detail: { blockId, queuedConfigurationStale },
  }));
}

function dispatchUpdateOperationGenerationParams(
  blockId: string,
  generationParams: ImageGenerationParams,
): void {
  window.dispatchEvent(
    new CustomEvent('retake:update-operation-generation-params', {
      detail: { blockId, generationParams },
    }),
  );
}

function dispatchUpdateOperationConnection(blockId: string, connectionId: string): void {
  window.dispatchEvent(
    new CustomEvent('retake:update-operation-connection', {
      detail: { blockId, connectionId },
    }),
  );
}

function operationExecutionConnections(
  connections: ExecutionConnectionSummary[],
  capabilityId: string,
): ExecutionConnectionSummary[] {
  return connections.filter((connection) => connection.supportedCapabilityIds.includes(capabilityId));
}

function generationProfileForConnection(
  profile: GenerationProfile,
  connection: ExecutionConnectionSummary | undefined,
): GenerationProfile {
  if (connection?.connectorId !== 'volcengine-ark') return profile;
  return {
    ...profile,
    parameterSupport: {
      ...profile.parameterSupport,
      aspectRatio: 'supported',
      count: 'supported',
      resolution: 'supported',
    },
  };
}

function connectionLabel(connection: ExecutionConnectionSummary): string {
  return `${connection.displayName}${connection.modelId ? ` · ${connection.modelId}` : ''}`;
}

function connectionStatusText(
  status: ExecutionConnectionStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (status === 'not_installed') return t('settings.statusNotInstalled');
  if (status === 'needs_credentials') return t('settings.statusNeedsCredentials');
  if (status === 'needs_login') return t('settings.statusNeedsLogin');
  if (status === 'untested') return t('settings.statusUntested');
  if (status === 'checking') return t('settings.statusChecking');
  if (status === 'ready') return t('settings.statusReady');
  return t('settings.statusUnavailable');
}

function operationModeFromCapability(data: BlockData): SwitchableOperationMode {
  if (data.operationMode === 'text_to_image' || data.operationMode === 'generate_image') return 'text_to_image';
  if (data.operationMode === 'image_to_image' || data.operationMode === 'quick_edit' || data.operationMode === 'create_similar') {
    return 'image_to_image';
  }
  if (data.capabilityId === 'image.image_to_image' || data.capabilityId === 'image.edit') return 'image_to_image';
  if (data.capabilityId === 'image.generate.similar') return 'image_to_image';
  return 'text_to_image';
}

function capabilityIdForOperationMode(operation: SwitchableOperationMode, data: BlockData): string {
  const existingCapabilityId = typeof data.capabilityId === 'string' ? data.capabilityId : undefined;
  if (
    existingCapabilityId &&
    operation === operationModeFromCapability(data) &&
    existingCapabilityId !== 'image.generate.similar' &&
    !existingCapabilityId.startsWith('image.local_')
  ) {
    return existingCapabilityId;
  }
  if (operation === 'text_to_image') return 'image.text_to_image';
  return 'image.image_to_image';
}

const standardAspectOptions: Array<{ label: string; value: Exclude<AspectPreset, 'source'> }> = [
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
];

function aspectOptionClassName(value: AspectPreset, sourceAspectRatio?: number): string {
  if (value === 'source') {
    if (!sourceAspectRatio || Math.abs(sourceAspectRatio - 1) < 0.08) return 'aspect-1-1';
    return sourceAspectRatio > 1 ? 'aspect-16-9' : 'aspect-9-16';
  }
  return `aspect-${value.replace(':', '-')}`;
}

const resolutionOptions: ResolutionPreset[] = ['1K', '2K', '4K'];
const durationOptions = [4, 6, 8, 10];
const motionOptions: Array<{ label: string; value: MotionPreset }> = [
  { label: 'Auto', value: 'auto' },
  { label: 'Subtle', value: 'subtle' },
  { label: 'Balanced', value: 'balanced' },
  { label: 'Dynamic', value: 'dynamic' },
];

type NormalizedImageGenerationParams = Omit<Required<ImageGenerationParams>, 'model'> & { model?: string };

function normalizeOperationParams(
  params: unknown,
  sourceAspectRatio?: number,
  defaultAspectPreset: Exclude<AspectPreset, 'source'> = '9:16',
): NormalizedImageGenerationParams {
  const record = isRecord(params) ? params : {};
  const storedTargetRatio = finiteNumber(record.targetAspectRatio) ?? safeRatio(
    finiteNumber(record.targetWidth),
    finiteNumber(record.targetHeight),
  );
  const aspectRatioPreset = isAspectPreset(record.aspectRatioPreset)
    ? record.aspectRatioPreset
    : presetForRatio(storedTargetRatio) ?? (sourceAspectRatio ? 'source' : defaultAspectPreset);
  const targetResolution = isResolutionPreset(record.targetResolution) ? record.targetResolution : '2K';
  const presetParams = paramsForPreset(aspectRatioPreset, targetResolution, sourceAspectRatio);
  return {
    aspectRatioPreset,
    durationSeconds: isDuration(record.durationSeconds) ? record.durationSeconds : 6,
    model: typeof record.model === 'string' && record.model !== 'codex-mcp' ? record.model : undefined,
    motion: isMotionPreset(record.motion) ? record.motion : 'auto',
    strength: clampUnit(record.strength, 0.65),
    targetAspectRatio:
      aspectRatioPreset === 'source'
        ? presetParams.targetAspectRatio ?? 1
        : finiteNumber(record.targetAspectRatio) ?? presetParams.targetAspectRatio ?? 1,
    targetHeight:
      aspectRatioPreset === 'source'
        ? presetParams.targetHeight ?? 2048
        : finiteNumber(record.targetHeight) ?? presetParams.targetHeight ?? 2048,
    targetResolution,
    targetWidth:
      aspectRatioPreset === 'source'
        ? presetParams.targetWidth ?? 2048
        : finiteNumber(record.targetWidth) ?? presetParams.targetWidth ?? 2048,
    variationCount: clampVariationCount(record.variationCount),
  };
}

export function generationParamsForSchema(
  params: ImageGenerationParams,
  schema: ReturnType<typeof schemaForCapability>['paramsSchema'],
): ImageGenerationParams {
  const supported: ImageGenerationParams = {
    ...(schema.aspectRatio ? {
      aspectRatioPreset: params.aspectRatioPreset,
      targetAspectRatio: params.targetAspectRatio,
      targetHeight: params.targetHeight,
      targetWidth: params.targetWidth,
    } : {}),
    ...(schema.count ? { variationCount: params.variationCount } : {}),
    ...(schema.duration ? { durationSeconds: params.durationSeconds } : {}),
    ...(schema.model ? { model: params.model } : {}),
    ...(schema.motion ? { motion: params.motion } : {}),
    ...(schema.resolution ? { targetResolution: params.targetResolution } : {}),
    ...(schema.strength ? { strength: params.strength } : {}),
  };
  return Object.fromEntries(
    Object.entries(supported).filter(([, value]) => value !== undefined),
  ) as ImageGenerationParams;
}

function paramsForPreset(
  aspectRatioPreset: AspectPreset,
  targetResolution: ResolutionPreset,
  sourceAspectRatio?: number,
): ImageGenerationParams {
  const targetAspectRatio = aspectRatioForPreset(aspectRatioPreset, sourceAspectRatio) ?? 1;
  const maxSide = resolutionMaxSide(targetResolution);
  const targetWidth = targetAspectRatio >= 1 ? maxSide : Math.round(maxSide * targetAspectRatio);
  const targetHeight = targetAspectRatio >= 1 ? Math.round(maxSide / targetAspectRatio) : maxSide;
  return {
    aspectRatioPreset,
    targetAspectRatio,
    targetHeight: Math.max(1, targetHeight),
    targetResolution,
    targetWidth: Math.max(1, targetWidth),
  };
}

function operationParamsSummary(
  params: NormalizedImageGenerationParams,
  paramsSchema: ReturnType<typeof schemaForCapability>['paramsSchema'],
  profile: GenerationProfile,
  sourceAspectLabel: string,
): string {
  const parts: string[] = [];
  if (paramsSchema.aspectRatio && generationParameterVisible(profile, 'aspectRatio')) {
    parts.push(params.aspectRatioPreset === 'source' ? sourceAspectLabel : params.aspectRatioPreset);
  }
  if (paramsSchema.count && generationParameterVisible(profile, 'count')) parts.push(`${params.variationCount}x`);
  if (paramsSchema.resolution && generationParameterVisible(profile, 'resolution')) {
    parts.push(params.targetResolution);
  }
  if (paramsSchema.duration && generationParameterVisible(profile, 'duration')) {
    parts.push(`${params.durationSeconds}s`);
  }
  if (paramsSchema.motion && generationParameterVisible(profile, 'motion')) parts.push(params.motion);
  if (paramsSchema.strength && generationParameterVisible(profile, 'strength')) {
    parts.push(`${Math.round(params.strength * 100)}%`);
  }
  return parts.join(' / ');
}

function aspectRatioForPreset(preset: AspectPreset, sourceAspectRatio?: number): number | undefined {
  if (preset === 'source') return sourceAspectRatio;
  const [width, height] = preset.split(':').map(Number);
  return safeRatio(width, height);
}

function presetForRatio(ratio?: number): AspectPreset | undefined {
  if (!ratio) return undefined;
  return standardAspectOptions.find((option) => {
    const presetRatio = aspectRatioForPreset(option.value);
    return presetRatio !== undefined && Math.abs(presetRatio - ratio) < 0.01;
  })?.value;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeRatio(width?: number, height?: number): number | undefined {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return undefined;
  return width / height;
}

function resolutionMaxSide(resolution: ResolutionPreset): number {
  if (resolution === '1K') return 1024;
  if (resolution === '4K') return 4096;
  return 2048;
}

function clampVariationCount(count: unknown): number {
  return Math.min(4, Math.max(1, Math.round(typeof count === 'number' && Number.isFinite(count) ? count : 1)));
}

function clampUnit(value: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && durationOptions.includes(value);
}

function isMotionPreset(value: unknown): value is MotionPreset {
  return typeof value === 'string' && motionOptions.some((option) => option.value === value);
}

function isAspectPreset(value: unknown): value is AspectPreset {
  return value === 'source' || (typeof value === 'string' && standardAspectOptions.some((option) => option.value === value));
}

function isResolutionPreset(value: unknown): value is ResolutionPreset {
  return value === '1K' || value === '2K' || value === '4K';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
