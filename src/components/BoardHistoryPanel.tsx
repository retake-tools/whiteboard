import { Check, ChevronDown, Clipboard, LocateFixed, X } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import type { BoardHistoryEvent, BoardSnapshot, ExecutionRecord } from '../core/types';
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
      subtitle: historySubtitle(event, execution, locale, t),
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
      subtitle: `${execution.capabilityId} · ${execution.adapter}`,
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
  if (event.type === 'execution_succeeded') return t('history.executionSucceeded');
  if (event.type === 'execution_failed') return t('history.executionFailed');
  if (event.type === 'result_block_updated') return t('history.resultUpdated');
  return event.summary;
}

function historySubtitle(
  event: BoardHistoryEvent,
  execution: ExecutionRecord | undefined,
  locale: Locale,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const parts = [
    event.type === 'prompt_copied' ? t('history.promptCopiedSubtitle') : event.summary,
    execution?.capabilityId,
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) return parts.join(' · ');
  return formatHistoryTime(event.createdAt, locale);
}

function titleForExecution(execution: ExecutionRecord, t: ReturnType<typeof useI18n>['t']): string {
  if (execution.capabilityId === 'image.annotation_edit') return t('operation.annotationEdit.title');
  if (execution.capabilityId === 'image.generate') return t('operation.generateImage.title');
  if (execution.capabilityId === 'image.edit') return t('operation.quickEdit.title');
  if (execution.capabilityId === 'image.generate.similar') return t('operation.createSimilar.title');
  return t('history.execution');
}

function executionBlockIds(execution?: ExecutionRecord): string[] {
  if (!execution) return [];
  return [...execution.inputBlockIds, ...execution.outputBlockIds];
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
