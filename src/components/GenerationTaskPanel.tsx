import {
  ExternalLink,
  ImageIcon,
  RotateCcw,
  Square,
  WandSparkles,
  X,
} from 'lucide-react';
import { memo, useMemo, type ReactElement } from 'react';
import { latestExecutionForOperation } from '../core/executionConfiguration';
import { imageGenerateCapabilityId } from '../core/imageGenerateContracts';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from '../core/types';
import { useI18n, type Locale } from '../i18n';
import { ExecutionProgressSummary } from './ExecutionProgressSummary';
import { TooltipIconButton } from './Tooltip';

interface GenerationTaskPanelProps {
  block: BlockRecord;
  onCancelExecution: (executionId: string) => Promise<void> | void;
  onClose: () => void;
  onContinueFromResult: (block: BlockRecord) => Promise<void> | void;
  onOpenExecutionDetails: (blockId: string) => void;
  onRetryExecution: (executionId: string) => Promise<void> | void;
  selectedBlockId?: string;
  snapshot: BoardSnapshot;
}

export const GenerationTaskPanel = memo(function GenerationTaskPanel({
  block,
  onCancelExecution,
  onClose,
  onContinueFromResult,
  onOpenExecutionDetails,
  onRetryExecution,
  selectedBlockId,
  snapshot,
}: GenerationTaskPanelProps): ReactElement | null {
  const { locale } = useI18n();
  const execution = useMemo(
    () => generationExecutionForBlock(snapshot, block),
    [block.blockId, block.data.sourceExecutionId, snapshot.executions],
  );
  if (!execution) return null;

  const operationBlockId = readString(execution.params?.operationBlockId);
  const operationBlock = operationBlockId
    ? snapshot.blocks.find((candidate) => (
        candidate.blockId === operationBlockId && candidate.type === 'operation'
      ))
    : undefined;

  const inputImages = execution.inputBlockIds.flatMap((blockId) => {
    const inputBlock = snapshot.blocks.find((candidate) => (
      candidate.blockId === blockId && candidate.type === 'image'
    ));
    const asset = snapshot.assets.find((candidate) => candidate.assetId === inputBlock?.data.assetId);
    return inputBlock && asset ? [{ asset, block: inputBlock }] : [];
  });
  const outputBlocks = execution.outputBlockIds.flatMap((blockId) => {
    const output = snapshot.blocks.find((candidate) => (
      candidate.blockId === blockId && candidate.type === 'image'
    ));
    return output ? [output] : [];
  });
  const selectedOutput = outputBlocks.find((candidate) => (
    candidate.blockId === selectedBlockId && typeof candidate.data.assetId === 'string'
  )) ?? outputBlocks.find((candidate) => typeof candidate.data.assetId === 'string');
  const params = generationParameters(execution, operationBlock ?? block);
  const requested = execution.resultSummary?.requested
    ?? readNumber(params.variationCount)
    ?? execution.outputBlockIds.length;
  const canCancel = execution.status === 'queued' || execution.status === 'running';
  const canRetry = execution.status === 'failed' || execution.status === 'canceled';
  const isImageToImage = inputImages.length > 0;
  const taskTitle = isImageToImage
    ? label(locale, '图生图', 'Image to image')
    : label(locale, '文生图', 'Text to image');

  return (
    <section className="generation-task-panel" aria-label={taskTitle}>
      <header className="generation-task-header">
        <div>
          <span>{label(locale, '生成任务', 'Generation task')}</span>
          <h2>{taskTitle}</h2>
        </div>
        <TooltipIconButton
          label={label(locale, '关闭生成任务', 'Close generation task')}
          onClick={onClose}
        >
          <X size={17} />
        </TooltipIconButton>
      </header>

      <div className="generation-task-scroll">
        <section className="generation-task-status">
          <div className="generation-task-status-heading">
            <WandSparkles size={17} />
            <strong>{operationBlock?.data.title ?? block.data.title}</strong>
          </div>
          <ExecutionProgressSummary execution={execution} />
        </section>

        {inputImages.length ? (
          <TaskSection title={label(locale, '来源图片', 'Source images')}>
            <div className="generation-task-sources">
              {inputImages.map(({ asset, block: inputBlock }) => (
                <figure key={asset.assetId}>
                  <img src={asset.previewUrl} alt="" />
                  <figcaption>{inputBlock.data.title}</figcaption>
                </figure>
              ))}
            </div>
          </TaskSection>
        ) : null}

        <TaskSection title={label(locale, '提示词', 'Prompt')}>
          <p className="generation-task-prompt">
            {execution.prompt
              ?? readString(block.data.promptBody)
              ?? label(locale, '尚未记录提示词', 'No prompt was recorded')}
          </p>
        </TaskSection>

        <TaskSection title={label(locale, '生成设置', 'Generation settings')}>
          <dl className="generation-task-facts">
            <Fact
              label={label(locale, '生成数量', 'Outputs')}
              value={requested > 0 ? `${requested}` : undefined}
            />
            <Fact
              label={label(locale, '画面比例', 'Aspect ratio')}
              value={readString(params.aspectRatioPreset) ?? readString(params.aspectRatio)}
            />
            <Fact
              label={label(locale, '输出尺寸', 'Output size')}
              value={outputSize(params)}
            />
            <Fact
              label={label(locale, '模型', 'Model')}
              value={execution.model ?? readString(params.model) ?? execution.generationProfile?.name}
            />
          </dl>
        </TaskSection>

        <TaskSection title={label(locale, '执行与权限', 'Execution and rights')}>
          <div className="generation-task-disclosure">
            <p>
              <strong>{label(locale, '当前连接', 'Current connection')}</strong>
              <span>{execution.provider ?? execution.connectionId ?? execution.adapter}</span>
            </p>
            <small>
              {label(
                locale,
                '费用、隐私处理和商用权以当前连接的实际规则为准；Whiteboard 不伪造 Token 或授权结论。',
                'Cost, privacy, and commercial rights follow the active connection; Whiteboard does not invent token or license claims.',
              )}
            </small>
          </div>
        </TaskSection>

        {execution.errorMessage ? (
          <div className="generation-task-error" role="alert">
            <strong>{label(locale, '本次执行未完整完成', 'This execution did not fully complete')}</strong>
            <p>{execution.errorMessage}</p>
          </div>
        ) : null}

        <button
          type="button"
          className="generation-task-details"
          onClick={() => onOpenExecutionDetails(selectedOutput?.blockId ?? block.blockId)}
        >
          <ExternalLink size={15} />
          <span>{label(locale, '查看完整执行详情', 'View full execution details')}</span>
        </button>
      </div>

      <footer className="generation-task-footer">
        {canCancel ? (
          <button
            type="button"
            className="is-secondary"
            onClick={() => void onCancelExecution(execution.executionId)}
          >
            <Square size={14} />
            {label(locale, '取消生成', 'Cancel')}
          </button>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            className="is-secondary"
            onClick={() => void onRetryExecution(execution.executionId)}
          >
            <RotateCcw size={14} />
            {label(locale, '重试未完成项', 'Retry incomplete')}
          </button>
        ) : null}
        {selectedOutput ? (
          <button
            type="button"
            className="is-primary"
            onClick={() => void onContinueFromResult(selectedOutput)}
          >
            <ImageIcon size={15} />
            {label(locale, '基于此图继续编辑', 'Continue from this image')}
          </button>
        ) : null}
      </footer>
    </section>
  );
});

export function generationExecutionForBlock(
  snapshot: BoardSnapshot,
  block: BlockRecord,
): ExecutionRecord | undefined {
  if (block.type === 'operation') {
    const sourceExecutionId = readString(block.data.sourceExecutionId);
    const direct = sourceExecutionId
      ? snapshot.executions.find((candidate) => candidate.executionId === sourceExecutionId)
      : undefined;
    const execution = direct ?? latestExecutionForOperation(snapshot, block.blockId);
    return execution?.capabilityId === imageGenerateCapabilityId ? execution : undefined;
  }
  const sourceExecutionId = readString(block.data.sourceExecutionId);
  const execution = sourceExecutionId
    ? snapshot.executions.find((candidate) => candidate.executionId === sourceExecutionId)
    : snapshot.executions.find((candidate) => candidate.outputBlockIds.includes(block.blockId));
  return execution?.capabilityId === imageGenerateCapabilityId ? execution : undefined;
}

function TaskSection({
  children,
  title,
}: {
  children: ReactElement | ReactElement[] | string;
  title: string;
}): ReactElement {
  return (
    <section className="generation-task-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label: factLabel, value }: { label: string; value?: string }): ReactElement | null {
  if (!value) return null;
  return (
    <div>
      <dt>{factLabel}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function generationParameters(
  execution: ExecutionRecord,
  block: BlockRecord,
): Record<string, unknown> {
  const executionParams = execution.configuration?.generationParams;
  const blockParams = block.data.generationParams;
  return {
    ...(isRecord(blockParams) ? blockParams : {}),
    ...(isRecord(executionParams) ? executionParams : {}),
    ...(isRecord(execution.params) ? execution.params : {}),
  };
}

function outputSize(params: Record<string, unknown>): string | undefined {
  const width = readNumber(params.targetWidth);
  const height = readNumber(params.targetHeight);
  if (width && height) return `${width} × ${height}`;
  return readString(params.targetResolution) ?? readString(params.resolution);
}

function label(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
