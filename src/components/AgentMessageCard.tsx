import { Check, Clipboard } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type {
  AgentMessageContextRef,
  AgentMessageRecord,
} from '../core/agentSessionContracts';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export function AgentMessageCard({
  message,
}: {
  message: AgentMessageRecord;
}): ReactElement {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = useState(false);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const visibleContextRefs = message.contextRefs.filter(
    (ref) => ref.kind === 'image_reference_setting',
  );

  useEffect(() => () => {
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
  }, []);

  async function copyMessage(): Promise<void> {
    await copyTextToClipboard(message.content);
    setIsCopied(true);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setIsCopied(false);
      copiedTimerRef.current = undefined;
    }, 1600);
  }

  return (
    <article className={`agent-workspace-message is-${message.role}`}>
      <span>
        {message.role === 'user'
          ? t('agentWorkspace.you')
          : t('agentWorkspace.agent')}
      </span>
      <TooltipIconButton
        className="agent-workspace-message-copy"
        label={t(isCopied
          ? 'agentWorkspace.messageCopied'
          : 'agentWorkspace.copyMessage')}
        onClick={() => {
          void copyMessage().catch(() => setIsCopied(false));
        }}
      >
        {isCopied ? <Check size={13} /> : <Clipboard size={13} />}
      </TooltipIconButton>
      <p>{message.content}</p>
      {visibleContextRefs.length > 0 ? (
        <small>{visibleContextRefs.map((ref) => contextRefLabel(ref, t)).join(' · ')}</small>
      ) : null}
    </article>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Message copy failed.');
  }
}

function contextRefLabel(
  ref: AgentMessageContextRef,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (ref.kind === 'entrypoint') return `/${ref.entrypointId}`;
  if (ref.kind === 'image_reference_setting') {
    if (ref.mode === 'source') return t('skillComposer.referenceModeSource');
    return ref.instruction.trim()
      ? `${t('skillComposer.referenceIntent')} · ${ref.instruction.trim()}`
      : t('skillComposer.referenceModeReference');
  }
  if (ref.kind === 'agent_preferences') return 'Preferences';
  if (ref.kind === 'agent_suggestion_action') return 'Suggestion action';
  if (ref.kind === 'workflow_execution_mode') {
    return ref.mode === 'run_now'
      ? t('skillComposer.runNow')
      : t('skillComposer.planFirst');
  }
  if (ref.kind === 'workflow_interaction_mode') {
    return ref.mode === 'automatic'
      ? t('skillComposer.workflowAutomatic')
      : t('skillComposer.workflowManual');
  }
  if (ref.kind === 'agent_run') return `Run ${ref.agentRunId.slice(-8)}`;
  if (ref.kind === 'operation') return `Operation ${ref.operationBlockId.slice(-8)}`;
  if (ref.kind === 'canvas_image_selection') {
    return `${ref.imageBlockIds.length} selected image${ref.imageBlockIds.length === 1 ? '' : 's'}`;
  }
  if (ref.kind === 'operation_receipt') {
    return `${ref.action === 'created' ? 'Created' : 'Continued'} Operation ${ref.operationBlockId.slice(-8)}`;
  }
  if (ref.kind === 'inline') return `${ref.slotId}: ${inlineValueSummary(ref.value)}`;
  if (ref.kind === 'parameters') return invocationParameterSummary(ref.value);
  if (ref.kind === 'block') return `@Block ${ref.blockId.slice(-8)}`;
  return `@Asset ${ref.assetId.slice(-8)}`;
}

function invocationParameterSummary(parameters: Record<string, unknown>): string {
  const entries = Object.entries(parameters);
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' · ');
}

function inlineValueSummary(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
