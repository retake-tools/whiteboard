import { Check, Clipboard } from 'lucide-react';
import type { ReactElement } from 'react';
import type { ExecutionRecord } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export type ExecutionDetailCopySource = 'execution_inspector' | 'group_inspector' | 'history_panel';

interface ExecutionPromptDetailsProps {
  agentPrompt?: string;
  blockIds?: string[];
  copiedPromptKey?: string;
  copyKey: string;
  copySource: ExecutionDetailCopySource;
  executionId: string;
  onCopyPrompt: (input: {
    blockIds?: string[];
    copyKey: string;
    executionId?: string;
    prompt: string;
    source: ExecutionDetailCopySource;
  }) => void | Promise<void>;
  prompt?: string;
  requestPrompts?: ExecutionRecord['requestPrompts'];
}

interface RequestPromptDisplayEntry {
  mergedCount: number;
  requestPrompt: NonNullable<ExecutionRecord['requestPrompts']>[number];
  totalCount: number;
}

const candidateSequencePattern = / This is candidate \d+ of \d+; produce an independent visual variation rather than duplicating another candidate\./g;

export function ExecutionPromptDetails({
  agentPrompt,
  blockIds,
  copiedPromptKey,
  copyKey,
  copySource,
  executionId,
  onCopyPrompt,
  prompt,
  requestPrompts,
}: ExecutionPromptDetailsProps): ReactElement {
  const { t } = useI18n();
  const displayedRequestPrompts = requestPromptDisplayEntries(requestPrompts);

  return (
    <>
      {prompt ? (
        <PromptSection
          blockIds={blockIds}
          copied={copiedPromptKey === copyKey}
          copyKey={copyKey}
          copySource={copySource}
          executionId={executionId}
          onCopyPrompt={onCopyPrompt}
          prompt={prompt}
          title={t('inspector.prompt')}
        />
      ) : null}

      {agentPrompt && agentPrompt !== prompt ? (
        <PromptSection
          blockIds={blockIds}
          copied={copiedPromptKey === `${copyKey}:agent`}
          copyKey={`${copyKey}:agent`}
          copySource={copySource}
          executionId={executionId}
          onCopyPrompt={onCopyPrompt}
          prompt={agentPrompt}
          title={t('inspector.agentPrompt')}
        />
      ) : null}

      {displayedRequestPrompts.map(({ mergedCount, requestPrompt, totalCount }) => {
        const requestCopyKey = `${copyKey}:request:${requestPrompt.index}`;
        const mergedLabel = mergedCount > 1
          ? ` · ${mergedCount} ${t('inspector.requestPromptBatch')}`
          : totalCount > 1
            ? ` · ${requestPrompt.index + 1}/${totalCount}`
            : '';
        return (
          <PromptSection
            blockIds={blockIds}
            copied={copiedPromptKey === requestCopyKey}
            copyKey={requestCopyKey}
            copySource={copySource}
            executionId={executionId}
            key={requestCopyKey}
            onCopyPrompt={onCopyPrompt}
            prompt={requestPrompt.prompt}
            title={`${t('inspector.requestPrompt')}${mergedLabel}`}
          />
        );
      })}
    </>
  );
}

function PromptSection(props: {
  blockIds?: string[];
  copied: boolean;
  copyKey: string;
  copySource: ExecutionDetailCopySource;
  executionId: string;
  onCopyPrompt: ExecutionPromptDetailsProps['onCopyPrompt'];
  prompt: string;
  title: string;
}): ReactElement {
  const { t } = useI18n();
  return (
    <section className="execution-inspector-prompt">
      <header>
        <h3>{props.title}</h3>
        <TooltipIconButton
          label={t(props.copied ? 'feedback.copied' : 'feedback.copyPrompt')}
          onClick={() =>
            props.onCopyPrompt({
              blockIds: props.blockIds,
              copyKey: props.copyKey,
              executionId: props.executionId,
              prompt: props.prompt,
              source: props.copySource,
            })
          }
        >
          {props.copied ? <Check size={15} /> : <Clipboard size={15} />}
        </TooltipIconButton>
      </header>
      <pre>{props.prompt}</pre>
    </section>
  );
}

function requestPromptDisplayEntries(
  requestPrompts: ExecutionRecord['requestPrompts'],
): RequestPromptDisplayEntry[] {
  if (!requestPrompts?.length) return [];
  const totalCount = requestPrompts.length;
  const normalizedPrompts = requestPrompts.map((requestPrompt) =>
    requestPrompt.prompt.replace(candidateSequencePattern, ''));
  const canMerge = normalizedPrompts.every((prompt) => prompt === normalizedPrompts[0]);
  if (canMerge) return [{ mergedCount: totalCount, requestPrompt: requestPrompts[0], totalCount }];
  return requestPrompts.map((requestPrompt) => ({ mergedCount: 1, requestPrompt, totalCount }));
}
