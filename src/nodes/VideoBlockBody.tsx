import { Info, Play, Video } from 'lucide-react';
import { useSyncExternalStore, type ReactElement } from 'react';
import { TooltipIconButton } from '../components/Tooltip';
import {
  currentExecutionProviderSettings,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import type { ExecutionConnectionSummary } from '../core/executionProviders';
import type { BlockData } from '../core/types';
import { useI18n } from '../i18n';

export function VideoBlockBody({ blockId, data }: { blockId: string; data: BlockData }): ReactElement {
  const { t } = useI18n();
  const draft = data.executionDraft;
  const prompt = draft?.prompt ?? '';
  const durationSeconds = numericDraftParameter(draft?.parameters.durationSeconds, 8);
  const outputCount = numericDraftParameter(draft?.parameters.outputCount, 1);
  const aspectRatio = stringDraftParameter(draft?.parameters.aspectRatio, '9:16');
  const executionProfileId = draft?.executionProfileId ?? 'video-mock';
  const providerSettings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );
  const executionChoices = videoExecutionChoices(providerSettings?.connections ?? []);
  const selectedExecutionChoice = executionChoices.find((choice) =>
    choice.executionProfileId === executionProfileId
      && (!draft?.connectionId || choice.connectionId === draft.connectionId))
    ?? executionChoices.find((choice) => choice.executionProfileId === executionProfileId)
    ?? executionChoices[0];
  const usesSeedance = executionProfileId === 'video-seedance-modelark';
  const usesDreaminaCli = executionProfileId === 'video-dreamina-cli';
  const status = visibleVideoStatus(data);
  const isRunning = status === 'queued' || status === 'running';
  const isLocked = data.groupContentLocked === true;

  if (data.assetId) {
    const isPlayable = typeof data.previewUrl === 'string' && !data.previewUrl.startsWith('local-mock://');
    return (
      <div className="video-result-body">
        {isPlayable ? (
          <video src={data.previewUrl} controls preload="metadata" />
        ) : (
          <div className="video-mock-result">
            <Video size={26} />
            <span>{t('videoGeneration.mockResult')}</span>
          </div>
        )}
        <VideoResultBatchBadge data={data} />
        {status ? <span className={`status-pill status-${status}`}>{t(`status.${status}`)}</span> : null}
        {typeof data.sourceExecutionId === 'string' ? (
          <TooltipIconButton
            className="video-info-button nodrag nopan"
            label={t('inspector.openDetails')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              window.dispatchEvent(new CustomEvent('retake:open-execution-inspector', { detail: { blockId } }));
            }}
          >
            <Info size={15} />
          </TooltipIconButton>
        ) : null}
      </div>
    );
  }

  return (
    <div className="video-generation-form nodrag nopan">
      <textarea
        aria-label={t('videoGeneration.prompt')}
        disabled={isLocked || isRunning}
        placeholder={t('videoGeneration.promptPlaceholder')}
        value={prompt}
        onChange={(event) => dispatchUpdateVideoDraft(blockId, { prompt: event.currentTarget.value })}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <label className="video-generation-profile">
        <span>{t('videoGeneration.profile')}</span>
        <select
          aria-label={t('videoGeneration.profile')}
          disabled={isLocked || isRunning}
          value={selectedExecutionChoice ? encodeExecutionChoice(selectedExecutionChoice) : executionProfileId}
          onChange={(event) => {
            const choice = decodeExecutionChoice(event.currentTarget.value);
            dispatchUpdateVideoDraft(blockId, choice);
          }}
        >
          {executionChoices.map((choice) => (
            <option
              key={encodeExecutionChoice(choice)}
              disabled={choice.disabled}
              value={encodeExecutionChoice(choice)}
            >
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <div className="video-generation-fields">
        <label>
          <span>{t('videoGeneration.aspectRatio')}</span>
          <select
            aria-label={t('videoGeneration.aspectRatio')}
            disabled={isLocked || isRunning}
            value={aspectRatio}
            onChange={(event) => dispatchUpdateVideoDraft(blockId, { aspectRatio: event.currentTarget.value })}
          >
            {['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>{t('videoGeneration.duration')}</span>
          <select
            aria-label={t('videoGeneration.duration')}
            disabled={isLocked || isRunning}
            value={durationSeconds}
            onChange={(event) => dispatchUpdateVideoDraft(blockId, { durationSeconds: Number(event.currentTarget.value) })}
          >
            {[4, 6, 8, 10, 12, 15].map((value) => <option key={value} value={value}>{value}s</option>)}
          </select>
        </label>
        <label>
          <span>{t('videoGeneration.count')}</span>
          <select
            aria-label={t('videoGeneration.count')}
            disabled={isLocked || isRunning}
            value={outputCount}
            onChange={(event) => dispatchUpdateVideoDraft(blockId, { outputCount: Number(event.currentTarget.value) })}
          >
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <button
        type="button"
        className="video-generate-button"
        disabled={isLocked || isRunning || !prompt.trim()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent('retake:generate-video', { detail: { blockId } }));
        }}
      >
        <Play size={13} />
        <span>{isRunning
          ? t('videoGeneration.running')
          : t(usesDreaminaCli
            ? 'videoGeneration.generateDreamina'
            : usesSeedance
              ? 'videoGeneration.generateSeedance'
              : 'videoGeneration.generateMock')}</span>
      </button>
      <small>{t(usesDreaminaCli
        ? 'videoGeneration.profileDreamina'
        : usesSeedance
          ? 'videoGeneration.profileSeedance'
          : 'videoGeneration.profileMock')}</small>
    </div>
  );
}

function VideoResultBatchBadge({ data }: { data: BlockData }): ReactElement | null {
  const index = typeof data.resultIndex === 'number' ? data.resultIndex : undefined;
  const count = typeof data.resultCount === 'number' ? data.resultCount : undefined;
  if (index === undefined || count === undefined || count <= 1) return null;
  return <span className="image-result-batch-badge">{index + 1} / {count}</span>;
}

function numericDraftParameter(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringDraftParameter(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function visibleVideoStatus(data: BlockData): BlockData['status'] | undefined {
  if (!data.status || data.statusVisualDismissed) return undefined;
  return data.status;
}

function dispatchUpdateVideoDraft(
  blockId: string,
  update: {
    aspectRatio?: string;
    connectionId?: string | null;
    durationSeconds?: number;
    executionProfileId?: string;
    outputCount?: number;
    prompt?: string;
  },
): void {
  window.dispatchEvent(new CustomEvent('retake:update-video-draft', { detail: { blockId, ...update } }));
}

interface VideoExecutionChoice {
  connectionId: string;
  disabled?: boolean;
  executionProfileId: string;
  label: string;
}

function videoExecutionChoices(connections: ExecutionConnectionSummary[]): VideoExecutionChoice[] {
  const choices = connections.filter((connection) => connection.capabilityClasses.includes('video')).flatMap((connection) => {
    const executionProfileId = videoProfileForConnector(connection.connectorId);
    if (!executionProfileId) return [];
    return [{
      connectionId: connection.connectionId,
      disabled: connection.status !== 'ready',
      executionProfileId,
      label: `${connection.displayName}${connection.modelId ? ` · ${connection.modelId}` : ''}`,
    }];
  });
  if (choices.length) return choices;
  return [
    { connectionId: 'retake-mock', executionProfileId: 'video-mock', label: 'Retake Mock' },
    { connectionId: 'dreamina', executionProfileId: 'video-dreamina-cli', label: 'Dreamina CLI' },
    { connectionId: 'byteplus-modelark', executionProfileId: 'video-seedance-modelark', label: 'BytePlus ModelArk' },
  ];
}

function videoProfileForConnector(connectorId: string): string | undefined {
  if (connectorId === 'retake-mock') return 'video-mock';
  if (connectorId === 'dreamina') return 'video-dreamina-cli';
  if (connectorId === 'byteplus-modelark') return 'video-seedance-modelark';
  return undefined;
}

function encodeExecutionChoice(choice: VideoExecutionChoice): string {
  return [choice.executionProfileId, choice.connectionId].join('\u001f');
}

function decodeExecutionChoice(value: string): {
  connectionId: string | null;
  executionProfileId: string;
} {
  const [executionProfileId = 'video-mock', connectionId = ''] = value.split('\u001f');
  return { executionProfileId, connectionId: connectionId || null };
}
