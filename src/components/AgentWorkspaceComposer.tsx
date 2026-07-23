import { ArrowUp, AtSign, ChevronDown, Search, Sparkles, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import {
  listPackageComposerInlineInputOptions,
  listPackageComposerMentionOptions,
  packageComposerMentionId,
  type PackageComposerMention,
  type PackageComposerInlineValue,
  type PackageComposerMentionOption,
} from '../core/packageComposer';
import { listPackageEntryPoints, type RegisteredPackageEntryPoint } from '../core/packageRegistry';
import { skillUiDefinitionFor } from '../core/skillRegistry';
import type { BoardSnapshot } from '../core/types';
import { workflowUiDefinitionFor } from '../core/workflowRegistry';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

type PickerState = { mode: 'entrypoint' | 'mention'; query: string } | undefined;

export function AgentWorkspaceComposer({
  disabled,
  onSubmit,
  snapshot,
}: {
  disabled?: boolean;
  onSubmit: (input: {
    content: string;
    entrypointId?: string;
    inlineValues: PackageComposerInlineValue[];
    mentions: PackageComposerMention[];
  }) => void;
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('');
  const [entrypointId, setEntrypointId] = useState<string>();
  const [mentions, setMentions] = useState<PackageComposerMention[]>([]);
  const [inlineValuesBySlot, setInlineValuesBySlot] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<PickerState>();
  const entrypoints = useMemo(() => listPackageEntryPoints().filter(isRunnableRegistration), []);
  const selectedEntryPoint = entrypoints.find((item) => item.entrypoint.entrypointId === entrypointId);
  const inlineInputOptions = useMemo(
    () => entrypointId ? listPackageComposerInlineInputOptions(entrypointId) : [],
    [entrypointId],
  );
  const inlineValues = inlineInputOptions.flatMap((option): PackageComposerInlineValue[] => {
    const value = inlineValuesBySlot[option.slotId]?.trim();
    return value ? [{ kind: 'inline', slotId: option.slotId, value }] : [];
  });
  const mentionOptions = useMemo(
    () => entrypointId ? listPackageComposerMentionOptions(snapshot, entrypointId) : [],
    [entrypointId, snapshot],
  );
  const mentionById = useMemo(
    () => new Map(mentionOptions.map((option) => [option.mentionId, option])),
    [mentionOptions],
  );
  const entrypointQuery = picker?.mode === 'entrypoint' ? picker.query.trim().toLocaleLowerCase() : '';
  const mentionQuery = picker?.mode === 'mention' ? picker.query.trim().toLocaleLowerCase() : '';
  const filteredEntryPoints = entrypoints.filter((item) => {
    if (!entrypointQuery) return true;
    return `${entrypointName(item, t)} ${item.entrypoint.entrypointId}`.toLocaleLowerCase().includes(entrypointQuery);
  });
  const filteredMentions = mentionOptions.filter((option) => {
    if (!mentionQuery) return true;
    return `${option.label} ${option.description} ${option.slotId}`.toLocaleLowerCase().includes(mentionQuery);
  });

  useDismissiblePopover({ active: Boolean(picker), onDismiss: () => setPicker(undefined), rootRef });

  function updateContent(value: string): void {
    setContent(value);
    const trigger = trailingTriggerQuery(value, entrypointId ? '@' : '/');
    if (trigger !== undefined) {
      setPicker({ mode: entrypointId ? 'mention' : 'entrypoint', query: trigger });
    } else if (picker) setPicker(undefined);
  }

  function selectEntryPoint(item: RegisteredPackageEntryPoint): void {
    setEntrypointId(item.entrypoint.entrypointId);
    setContent((current) => stripTrailingTrigger(current, '/'));
    setMentions([]);
    setInlineValuesBySlot({});
    setPicker(undefined);
    inputRef.current?.focus();
  }

  function selectMention(option: PackageComposerMentionOption): void {
    setMentions((current) => {
      const withoutSource = current.filter((mention) => mention.kind === 'block'
        ? option.kind !== 'block' || mention.blockId !== option.blockId
        : option.kind !== 'asset' || mention.assetId !== option.assetId);
      const available = option.slotCardinality === 'many'
        ? withoutSource
        : withoutSource.filter((mention) => mention.slotId !== option.slotId);
      return [...available, mentionForOption(option)];
    });
    setContent((current) => stripTrailingTrigger(current, '@'));
    setPicker(undefined);
    inputRef.current?.focus();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (disabled || (!content.trim() && mentions.length === 0 && inlineValues.length === 0)) return;
    onSubmit({ content: content.trim(), entrypointId, inlineValues, mentions });
    setContent('');
    setEntrypointId(undefined);
    setMentions([]);
    setInlineValuesBySlot({});
    setPicker(undefined);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key === 'Enter'
      && !event.shiftKey
      && (content.trim() || mentions.length > 0 || inlineValues.length > 0)
      && !disabled
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section ref={rootRef} className="agent-workspace-composer">
      <form onSubmit={submit}>
        <div className="agent-workspace-context-chips">
          <button type="button" onClick={() => setPicker({ mode: 'entrypoint', query: '' })}>
            <Sparkles size={13} />
            {selectedEntryPoint ? entrypointName(selectedEntryPoint, t) : t('agentWorkspace.addEntrypoint')}
            <ChevronDown size={12} />
          </button>
          {mentions.map((mention) => {
            const id = packageComposerMentionId(mention);
            return (
              <span key={id}>
                <AtSign size={11} />{mentionById.get(id)?.label ?? id}
                <button type="button" aria-label={t('skillComposer.removeMention')} onClick={() => setMentions((current) => current.filter((item) => packageComposerMentionId(item) !== id))}>
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {entrypointId ? (
            <button type="button" onClick={() => setPicker({ mode: 'mention', query: '' })}>
              <AtSign size={13} />{t('agentWorkspace.addMention')}
            </button>
          ) : null}
          {inlineInputOptions.map((option) => (
            <label key={option.slotId} className="agent-workspace-inline-input">
              <span>{option.schemaRef === 'retake.storyboard-unit-id/v1' ? t('skill.storyboardSheet.unitInput') : option.slotId}</span>
              <input
                value={inlineValuesBySlot[option.slotId] ?? ''}
                placeholder={option.schemaRef === 'retake.storyboard-unit-id/v1'
                  ? t('skill.storyboardSheet.unitPlaceholder')
                  : option.slotId}
                onChange={(event) => {
                  const value = event.target.value;
                  setInlineValuesBySlot((current) => ({ ...current, [option.slotId]: value }));
                }}
              />
            </label>
          ))}
        </div>
        <div className="agent-workspace-input-row">
          <textarea
            ref={inputRef}
            rows={2}
            value={content}
            disabled={disabled}
            placeholder={t('agentWorkspace.inputPlaceholder')}
            onChange={(event) => updateContent(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="submit"
            disabled={disabled || (!content.trim() && mentions.length === 0 && inlineValues.length === 0)}
            aria-label={t('agentWorkspace.send')}
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </form>
      {picker ? (
        <div className="agent-workspace-picker" role="dialog">
          <label><Search size={14} /><input autoFocus value={picker.query} onChange={(event) => setPicker({ ...picker, query: event.target.value })} /></label>
          <div>
            {picker.mode === 'entrypoint'
              ? filteredEntryPoints.map((item) => (
                  <button key={item.entrypoint.entrypointId} type="button" onClick={() => selectEntryPoint(item)}>
                    <strong>{entrypointName(item, t)}</strong><span>{item.entrypoint.kind} · {item.entrypoint.entrypointId}</span>
                  </button>
                ))
              : filteredMentions.map((option) => (
                  <button key={option.mentionId} type="button" onClick={() => selectMention(option)}>
                    <strong>@{option.label}</strong><span>{option.slotId}</span>
                  </button>
                ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function isRunnableRegistration(item: RegisteredPackageEntryPoint): boolean {
  return item.entrypoint.kind === 'skill' || item.entrypoint.kind === 'workflow';
}

function entrypointName(item: RegisteredPackageEntryPoint, t: ReturnType<typeof useI18n>['t']): string {
  return item.entrypoint.kind === 'skill'
    ? t(skillUiDefinitionFor(item.entrypoint.ref.skillId).nameKey)
    : item.entrypoint.kind === 'workflow'
      ? t(workflowUiDefinitionFor(item.entrypoint.ref.workflowDefinitionId).nameKey)
      : item.entrypoint.name;
}

function mentionForOption(option: PackageComposerMentionOption): PackageComposerMention {
  return option.kind === 'block'
    ? { kind: 'block', blockId: option.blockId, slotId: option.slotId }
    : { kind: 'asset', assetId: option.assetId, slotId: option.slotId };
}

function trailingTriggerQuery(value: string, trigger: '/' | '@'): string | undefined {
  const match = value.match(new RegExp(`(?:^|\\s)\\${trigger}([^\\s${trigger === '/' ? '@' : '/'}]*)$`));
  return match?.[1];
}

function stripTrailingTrigger(value: string, trigger: '/' | '@'): string {
  return value.replace(new RegExp(`(?:^|\\s)\\${trigger}[^\\s${trigger === '/' ? '@' : '/'}]*$`), '').trimEnd();
}
