import { Check, ChevronDown, Clipboard, LocateFixed, X } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import type { BoardHistoryEvent, BoardSnapshot, ExecutionConfigurationChangeKind, ExecutionRecord } from '../core/types';
import {
  configurationChangeKinds,
  configurationChanges,
  executionConfiguration,
  executionVersionFor,
  previousExecutionFor,
} from '../core/executionConfiguration';
import { executionSourceLineage } from '../core/executionLineage';
import { useI18n, type Locale } from '../i18n';
import {
  ExecutionDetailContent,
  getExecutionDetailContextForExecution,
  type ExecutionDetailCopySource,
} from './ExecutionDetailContent';
import { TooltipIconButton } from './Tooltip';

interface CopyPromptInput {
  blockIds?: string[];
  copyKey: string;
  executionId?: string;
  prompt: string;
  source: ExecutionDetailCopySource;
}

interface BoardHistoryPanelProps {
  copiedPromptKey?: string;
  snapshot: BoardSnapshot;
  onClose: () => void;
  onCopyPrompt: (input: CopyPromptInput) => void | Promise<void>;
  onLocateBlock: (blockId: string) => void;
  onOpenAnnotationEditor: (executionId: string) => void;
}

interface HistoryEntry {
  blockIds: string[];
  createdAt: string;
  execution?: ExecutionRecord;
  executionId?: string;
  id: string;
  prompt?: string;
  status?: ExecutionRecord['status'];
  subtitle: string;
  title: string;
  type: BoardHistoryEvent['type'] | 'execution';
}

export function BoardHistoryPanel({
  copiedPromptKey,
  onClose,
  onCopyPrompt,
  onLocateBlock,
  onOpenAnnotationEditor,
  snapshot,
}: BoardHistoryPanelProps): ReactElement {
  const { locale, t } = useI18n();
  const [expandedEntryId, setExpandedEntryId] = useState<string | undefined>();
  const entries = createHistoryEntries(snapshot, locale, t);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.execution-image-lightbox')) return;
      event.stopImmediatePropagation();
      onClose();
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onClose]);

  return (
    <aside className="board-history-panel" aria-label={t('history.title')}>
      <header>
        <div>
          <span>{t('history.title')}</span>
          <strong>{snapshot.board.name}</strong>
        </div>
        <TooltipIconButton label={t('history.close')} onClick={onClose}>
          <X size={15} />
        </TooltipIconButton>
      </header>

      {entries.length > 0 ? (
        <ol>
          {entries.map((entry) => {
            const locateBlockId = lastExistingBlockId(snapshot, entry.blockIds);
            const copyKey = `history:${entry.id}`;
            const isCopied = copiedPromptKey === copyKey;
            const isExpanded = expandedEntryId === entry.id;
            const detailContext = entry.execution
              ? getExecutionDetailContextForExecution(snapshot, entry.execution)
              : undefined;

            return (
              <li key={entry.id} className={`board-history-item${isExpanded ? ' is-expanded' : ''}`}>
                <div className="board-history-item-main">
                  <div className="board-history-item-title">
                    <strong>{entry.title}</strong>
                    {entry.status ? <span className={`history-status is-${entry.status}`}>{t(`status.${entry.status}`)}</span> : null}
                  </div>
                  <p>{entry.subtitle}</p>
                  <time dateTime={entry.createdAt}>{formatHistoryTime(entry.createdAt, locale)}</time>
                </div>
                <div className="board-history-actions">
                  <TooltipIconButton
                    disabled={!detailContext}
                    isPressed={isExpanded}
                    label={t(isExpanded ? 'history.collapse' : 'history.expand')}
                    onClick={() => setExpandedEntryId((current) => (current === entry.id ? undefined : entry.id))}
                  >
                    <ChevronDown size={14} />
                  </TooltipIconButton>
                  <TooltipIconButton
                    disabled={!entry.prompt}
                    label={t(isCopied ? 'feedback.copied' : 'feedback.copyPrompt')}
                    onClick={() => {
                      if (!entry.prompt) return;
                      void onCopyPrompt({
                        blockIds: entry.blockIds,
                        copyKey,
                        executionId: entry.executionId,
                        prompt: entry.prompt,
                        source: 'history_panel',
                      });
                    }}
                  >
                    {isCopied ? <Check size={14} /> : <Clipboard size={14} />}
                  </TooltipIconButton>
                  <TooltipIconButton
                    disabled={!locateBlockId}
                    label={t('history.locateBlock')}
                    onClick={() => {
                      if (locateBlockId) onLocateBlock(locateBlockId);
                    }}
                  >
                    <LocateFixed size={14} />
                  </TooltipIconButton>
                </div>
                {isExpanded && detailContext ? (
                  <div className="board-history-detail">
                    <ExecutionDetailContent
                      compact
                      context={detailContext}
                      copiedPromptKey={copiedPromptKey}
                      copyKey={copyKey}
                      copySource="history_panel"
                      onCopyPrompt={onCopyPrompt}
                      onOpenAnnotationEditor={
                        detailContext.annotationManifest
                          ? () => onOpenAnnotationEditor(detailContext.execution.executionId)
                          : undefined
                      }
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="board-history-empty">{t('history.empty')}</p>
      )}
    </aside>
  );
}

function createHistoryEntries(
  snapshot: BoardSnapshot,
  locale: Locale,
  t: ReturnType<typeof useI18n>['t'],
): HistoryEntry[] {
  const representedExecutionIds = new Set<string>();
  const entries = (snapshot.historyEvents ?? []).map((event): HistoryEntry => {
    if (event.executionId) representedExecutionIds.add(event.executionId);
    const execution = event.executionId
      ? snapshot.executions.find((candidate) => candidate.executionId === event.executionId)
      : undefined;
    const blockIds = event.blockIds ?? executionBlockIds(execution);
    const prompt = typeof event.detail?.prompt === 'string' ? event.detail.prompt : execution?.agentPrompt ?? execution?.prompt;

    return {
      blockIds,
      createdAt: event.createdAt,
      execution,
      executionId: event.executionId,
      id: event.eventId,
      prompt,
      status: execution?.status,
      subtitle: historySubtitle(event, execution, snapshot, locale, t),
      title: historyTitle(event, execution, t),
      type: event.type,
    };
  });

  for (const execution of snapshot.executions) {
    if (representedExecutionIds.has(execution.executionId)) continue;
    entries.push({
      blockIds: executionBlockIds(execution),
      createdAt: execution.completedAt ?? execution.startedAt,
      execution,
      executionId: execution.executionId,
      id: `execution:${execution.executionId}`,
      prompt: execution.agentPrompt ?? execution.prompt,
      status: execution.status,
      subtitle: `${executionVersionSummary(snapshot, execution, t)} · ${execution.capabilityId} · ${execution.adapter}`,
      title: titleForExecution(execution, t),
      type: 'execution',
    });
  }

  return entries.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function historyTitle(
  event: BoardHistoryEvent,
  execution: ExecutionRecord | undefined,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (event.type === 'prompt_copied') return t('history.promptCopied');
  if (event.type === 'operation_created' && execution) return titleForExecution(execution, t);
  if (event.type === 'asset_imported') return t('history.assetImported');
  if (event.type === 'asset_replaced') return t('history.assetReplaced');
  if (event.type === 'annotation_draft_restored') return t('history.annotationDraftRestored');
  if (event.type === 'configuration_restored') return t('history.configurationRestored');
  if (event.type === 'execution_started') return t('history.executionStarted');
  if (event.type === 'execution_succeeded') return t('history.executionSucceeded');
  if (event.type === 'execution_failed') return t('history.executionFailed');
  if (event.type === 'execution_canceled') return t('history.executionCanceled');
  if (event.type === 'result_block_updated') return t('history.resultUpdated');
  return event.summary;
}

function historySubtitle(
  event: BoardHistoryEvent,
  execution: ExecutionRecord | undefined,
  snapshot: BoardSnapshot,
  locale: Locale,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const parts = [
    event.type === 'prompt_copied' ? t('history.promptCopiedSubtitle') : event.summary,
    event.type === 'operation_created' && execution ? executionVersionSummary(snapshot, execution, t) : undefined,
    event.type === 'operation_created' && execution ? sourceLineageSummary(snapshot, execution) : undefined,
    execution?.capabilityId,
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) return parts.join(' · ');
  return formatHistoryTime(event.createdAt, locale);
}

function sourceLineageSummary(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): string | undefined {
  const { sourceBlock, sourceExecutionVersion } = executionSourceLineage(snapshot, execution);
  if (!sourceBlock) return undefined;
  return `${sourceBlock.data.title}${typeof sourceExecutionVersion === 'number' ? ` · V${sourceExecutionVersion}` : ''}`;
}

function executionVersionSummary(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const version = executionVersionFor(snapshot, execution);
  const previousExecution = previousExecutionFor(snapshot, execution);
  if (!previousExecution) {
    return typeof version === 'number'
      ? `V${version} · ${t('configuration.initial')}`
      : t('configuration.pendingExecution');
  }
  const kinds = configurationChangeKinds(
    configurationChanges(executionConfiguration(previousExecution), executionConfiguration(execution)),
  );
  const summary = kinds.length
    ? kinds.map((kind) => t(configurationChangeLabelKey(kind))).join(' + ')
    : t('configuration.noChanges');
  return typeof version === 'number'
    ? `V${version} · ${summary}`
    : `${t('configuration.pendingExecution')} · ${summary}`;
}

function configurationChangeLabelKey(kind: ExecutionConfigurationChangeKind) {
  return `configuration.${kind}` as const;
}

function titleForExecution(execution: ExecutionRecord, t: ReturnType<typeof useI18n>['t']): string {
  if (execution.capabilityId === 'image.annotation_edit') return t('operation.annotationEdit.title');
  if (execution.capabilityId === 'image.text_to_image' || execution.capabilityId === 'image.generate') {
    return t('operation.generateImage.title');
  }
  if (
    execution.capabilityId === 'image.image_to_image' ||
    execution.capabilityId === 'image.edit' ||
    execution.capabilityId === 'image.generate.similar'
  ) {
    return t('operation.createSimilar.title');
  }
  if (execution.capabilityId === 'image.local_adjust') return t('context.adjust');
  if (execution.capabilityId === 'image.local_crop') return t('context.crop');
  if (execution.capabilityId === 'image.local_expand') return t('context.expand');
  return t('history.execution');
}

function executionBlockIds(execution?: ExecutionRecord): string[] {
  if (!execution) return [];
  const operationBlockId =
    typeof execution.params?.operationBlockId === 'string' ? execution.params.operationBlockId : undefined;
  return [
    ...execution.inputBlockIds,
    operationBlockId,
    ...execution.outputBlockIds,
  ].filter((blockId): blockId is string => typeof blockId === 'string');
}

function lastExistingBlockId(snapshot: BoardSnapshot, blockIds: string[]): string | undefined {
  for (const blockId of [...blockIds].reverse()) {
    if (snapshot.blocks.some((block) => block.blockId === blockId)) return blockId;
  }
  return undefined;
}

function formatHistoryTime(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(date);
}
