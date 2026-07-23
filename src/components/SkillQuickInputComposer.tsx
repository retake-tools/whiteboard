import { ArrowUp, AtSign, ChevronDown, Search, Sparkles, X } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type SetStateAction,
} from 'react';
import {
  listPackageComposerInlineInputOptions,
  listPackageComposerMentionOptions,
  packageComposerMentionId,
  packageComposerMentionBindingIdentity,
  resolvePackageComposerInvocation,
  type PackageComposerInvocation,
  type PackageComposerInlineValue,
  type PackageComposerMention,
  type PackageComposerMentionOption,
} from '../core/packageComposer';
import {
  listPackageEntryPoints,
  listRecommendedPackageEntryPoints,
  type RegisteredPackageEntryPoint,
} from '../core/packageRegistry';
import { skillUiDefinitionFor } from '../core/skillRegistry';
import type {
  StoryboardSheetGenerationParameters,
  StoryboardSheetPanelCount,
} from '../core/storyboardSheetContracts';
import type { BoardSnapshot } from '../core/types';
import { workflowUiDefinitionFor } from '../core/workflowRegistry';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import {
  defaultGenerationPreparationParameters,
  generationReferenceRoles,
  type GenerationPreparationParameters,
  type GenerationReferenceRole,
} from '../core/generationPreparationContracts';

interface SkillQuickInputComposerProps {
  onInvokeEntryPoint: (invocation: PackageComposerInvocation) => void;
  snapshot: BoardSnapshot;
}

type PickerState = { mode: 'entrypoint' | 'mention'; query: string } | undefined;
type ReferenceSetting = { purpose: string; required: boolean; role: GenerationReferenceRole };

export function SkillQuickInputComposer({
  onInvokeEntryPoint,
  snapshot,
}: SkillQuickInputComposerProps): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [entrypointId, setEntrypointId] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [inlineValuesBySlot, setInlineValuesBySlot] = useState<Record<string, string>>({});
  const [storyboardOutputCount, setStoryboardOutputCount] = useState<1 | 2 | 3 | 4>(1);
  const [storyboardPanelCount, setStoryboardPanelCount] = useState<StoryboardSheetPanelCount>(6);
  const [generationParameters, setGenerationParameters] = useState<GenerationPreparationParameters>(
    defaultGenerationPreparationParameters,
  );
  const [referenceSettings, setReferenceSettings] = useState<Record<string, ReferenceSetting>>({});
  const [mentions, setMentions] = useState<PackageComposerMention[]>([]);
  const [picker, setPicker] = useState<PickerState>();
  const [submitError, setSubmitError] = useState<string>();
  const entrypoints = useMemo(() => listPackageEntryPoints().filter(isRunnableRegistration), []);
  const recommended = useMemo(() => listRecommendedPackageEntryPoints().filter(isRunnableRegistration), []);
  const selectedEntryPoint = entrypoints.find((registration) => registration.entrypoint.entrypointId === entrypointId);
  const inlineInputOptions = useMemo(
    () => entrypointId ? listPackageComposerInlineInputOptions(entrypointId) : [],
    [entrypointId],
  );
  const usesStoryboardSheet = inlineInputOptions.some(
    (option) => option.schemaRef === 'retake.storyboard-unit-id/v1',
  );
  const usesGenerationPreparation = inlineInputOptions.some(
    (option) => option.schemaRef === 'retake.generation-reference-manifest/v1',
  );
  const mentionOptions = useMemo(
    () => entrypointId ? listPackageComposerMentionOptions(snapshot, entrypointId) : [],
    [entrypointId, snapshot],
  );
  const mentionOptionsById = useMemo(
    () => new Map(mentionOptions.map((option) => [option.mentionId, option])),
    [mentionOptions],
  );
  const generationReferenceMentions = useMemo(() => mentions.filter(
    (mention) => mention.slotId === 'references',
  ), [mentions]);
  const filteredEntryPoints = useMemo(() => filterEntryPoints(entrypoints, picker?.mode === 'entrypoint' ? picker.query : '', t), [entrypoints, picker, t]);
  const filteredMentions = useMemo(() => filterMentionOptions(
    mentionOptions,
    picker?.mode === 'mention' ? picker.query : '',
  ), [mentionOptions, picker]);
  const invocation = useMemo((): PackageComposerInvocation | undefined => entrypointId ? ({
    entrypointId,
    inlineValues: inlineInputOptions.flatMap((option): PackageComposerInlineValue[] => {
      if (option.schemaRef === 'retake.generation-reference-manifest/v1') {
        return [{
          kind: 'inline' as const,
          slotId: option.slotId,
          value: {
            schemaRef: 'retake.generation-reference-manifest/v1' as const,
            items: generationReferenceMentions.map((mention, index) => {
              const mentionId = packageComposerMentionId(mention);
              const optionDefinition = mentionOptionsById.get(mentionId);
              const setting = referenceSettings[mentionId] ?? defaultReferenceSetting(optionDefinition?.label);
              const bindingIdentity = packageComposerMentionBindingIdentity(snapshot, mention);
              return {
                requirementId: `ref_${index + 1}`,
                role: setting.role,
                required: setting.required,
                ...(bindingIdentity ? { bindingIdentity } : {}),
                purpose: setting.purpose,
              };
            }),
          },
        }];
      }
      const value = inlineValuesBySlot[option.slotId] ?? '';
      return value.trim() ? [{ kind: 'inline' as const, slotId: option.slotId, value }] : [];
    }),
    instruction,
    mentions,
    ...(usesStoryboardSheet ? {
      parameters: { ...storyboardSheetParameters(storyboardPanelCount, storyboardOutputCount) },
    } : usesGenerationPreparation ? {
      parameters: { ...generationParameters },
    } : {}),
  }) : undefined, [
    entrypointId,
    inlineInputOptions,
    inlineValuesBySlot,
    instruction,
    mentions,
    storyboardOutputCount,
    storyboardPanelCount,
    generationParameters,
    generationReferenceMentions,
    mentionOptionsById,
    referenceSettings,
    snapshot,
    usesGenerationPreparation,
    usesStoryboardSheet,
  ]);
  const canSubmit = useMemo(() => {
    if (!invocation) return false;
    try {
      resolvePackageComposerInvocation(snapshot, invocation);
      return true;
    } catch {
      return false;
    }
  }, [invocation, snapshot]);

  useDismissiblePopover({
    active: Boolean(picker),
    onDismiss: () => setPicker(undefined),
    rootRef,
  });

  function selectEntryPoint(registration: RegisteredPackageEntryPoint): void {
    setEntrypointId(registration.entrypoint.entrypointId);
    setInstruction((current) => stripTrailingTrigger(current, '/'));
    setInlineValuesBySlot({});
    setStoryboardOutputCount(1);
    setStoryboardPanelCount(6);
    setGenerationParameters(defaultGenerationPreparationParameters);
    setReferenceSettings({});
    setMentions([]);
    setPicker(undefined);
    setSubmitError(undefined);
    inputRef.current?.focus();
  }

  function selectMention(option: PackageComposerMentionOption): void {
    setMentions((current) => {
      const withoutDuplicateSource = current.filter((mention) => {
        if (option.kind === 'block') return mention.kind !== 'block' || mention.blockId !== option.blockId;
        return mention.kind !== 'asset' || mention.assetId !== option.assetId;
      });
      const available = option.slotCardinality === 'many'
        ? withoutDuplicateSource
        : withoutDuplicateSource.filter((mention) => mention.slotId !== option.slotId);
      return [...available, mentionForOption(option)];
    });
    setInstruction((current) => stripTrailingTrigger(current, '@'));
    setPicker(undefined);
    setSubmitError(undefined);
    inputRef.current?.focus();
  }

  function updateInstruction(value: string): void {
    setInstruction(value);
    setSubmitError(undefined);
    const mentionQuery = trailingTriggerQuery(value, '@');
    if (entrypointId && mentionQuery !== undefined) {
      setPicker({ mode: 'mention', query: mentionQuery });
      return;
    }
    const entrypointQuery = trailingTriggerQuery(value, '/');
    if (entrypointQuery !== undefined) {
      setPicker({ mode: 'entrypoint', query: entrypointQuery });
      return;
    }
    if (picker) setPicker(undefined);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!invocation) {
      setPicker({ mode: 'entrypoint', query: '' });
      return;
    }
    try {
      resolvePackageComposerInvocation(snapshot, invocation);
      onInvokeEntryPoint(invocation);
      setEntrypointId(undefined);
      setInstruction('');
      setInlineValuesBySlot({});
      setStoryboardOutputCount(1);
      setStoryboardPanelCount(6);
      setGenerationParameters(defaultGenerationPreparationParameters);
      setReferenceSettings({});
      setMentions([]);
      setPicker(undefined);
      setSubmitError(undefined);
    } catch {
      setSubmitError(t('skillComposer.invalidInput'));
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && canSubmit) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section ref={rootRef} className="skill-composer" aria-label={t('skillComposer.title')}>
      <form className="skill-composer-form" onSubmit={submit}>
        <button
          type="button"
          className={`skill-composer-entrypoint${selectedEntryPoint ? ' is-selected' : ''}`}
          aria-expanded={picker?.mode === 'entrypoint'}
          onClick={() => setPicker({ mode: 'entrypoint', query: '' })}
        >
          <Sparkles size={15} />
          <span>{selectedEntryPoint ? entryPointDisplayName(selectedEntryPoint, t) : t('skillComposer.chooseEntryPoint')}</span>
          <ChevronDown size={13} />
        </button>
        <div className="skill-composer-input-shell">
          {mentions.length > 0 ? (
            <div className="skill-composer-mentions" aria-label={t('skillComposer.selectedMentions')}>
              {mentions.map((mention) => {
                const mentionId = packageComposerMentionId(mention);
                const option = mentionOptionsById.get(mentionId);
                return (
                  <span key={mentionId} className="skill-composer-mention-chip">
                    <AtSign size={11} />
                    {option?.label ?? mentionId}
                    <small>{mention.slotId}</small>
                    <button
                      type="button"
                      aria-label={t('skillComposer.removeMention')}
                      onClick={() => setMentions((current) => current.filter((candidate) => packageComposerMentionId(candidate) !== mentionId))}
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
          {inlineInputOptions.filter(
            (option) => option.schemaRef !== 'retake.generation-reference-manifest/v1',
          ).map((option) => (
            <label key={option.slotId} className="skill-composer-inline-input">
              <span>{option.schemaRef === 'retake.storyboard-unit-id/v1' ? t('skill.storyboardSheet.unitInput') : option.slotId}</span>
              <input
                value={inlineValuesBySlot[option.slotId] ?? ''}
                placeholder={option.schemaRef === 'retake.storyboard-unit-id/v1'
                  ? t('skill.storyboardSheet.unitPlaceholder')
                  : option.slotId}
                onChange={(event) => {
                  const value = event.target.value;
                  setInlineValuesBySlot((current) => ({ ...current, [option.slotId]: value }));
                  setSubmitError(undefined);
                }}
              />
            </label>
          ))}
          {usesStoryboardSheet ? (
            <div className="skill-composer-storyboard-parameters" aria-label={t('skillComposer.storyboardParameters')}>
              <label>
                <span>{t('skillComposer.panelCount')}</span>
                <select
                  value={storyboardPanelCount}
                  onChange={(event) => {
                    setStoryboardPanelCount(Number(event.target.value) as StoryboardSheetPanelCount);
                    setSubmitError(undefined);
                  }}
                >
                  {[6, 8, 10, 12].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
              <label>
                <span>{t('skillComposer.candidateCount')}</span>
                <select
                  value={storyboardOutputCount}
                  onChange={(event) => {
                    setStoryboardOutputCount(Number(event.target.value) as 1 | 2 | 3 | 4);
                    setSubmitError(undefined);
                  }}
                >
                  {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </div>
          ) : null}
          {usesGenerationPreparation ? (
            <div className="skill-composer-storyboard-parameters" aria-label={t('skillComposer.generationParameters')}>
              <label>
                <span>{t('skillComposer.aspectRatio')}</span>
                <select
                  value={generationParameters.aspectRatio}
                  onChange={(event) => setGenerationParameters((current) => ({
                    ...current,
                    aspectRatio: event.target.value as GenerationPreparationParameters['aspectRatio'],
                  }))}
                >
                  {['9:16', '16:9', '1:1'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                <span>{t('skillComposer.durationSeconds')}</span>
                <input
                  type="number"
                  min={4}
                  max={15}
                  value={generationParameters.durationSeconds}
                  onChange={(event) => setGenerationParameters((current) => ({
                    ...current,
                    durationSeconds: Number(event.target.value),
                  }))}
                />
              </label>
              <label>
                <span>{t('skillComposer.promptLanguage')}</span>
                <select
                  value={generationParameters.promptLanguage}
                  onChange={(event) => setGenerationParameters((current) => ({
                    ...current,
                    promptLanguage: event.target.value as GenerationPreparationParameters['promptLanguage'],
                  }))}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                <span>{t('skillComposer.maxPromptChars')}</span>
                <input
                  type="number"
                  min={500}
                  max={4000}
                  step={100}
                  value={generationParameters.maxPromptChars}
                  onChange={(event) => setGenerationParameters((current) => ({
                    ...current,
                    maxPromptChars: Number(event.target.value),
                  }))}
                />
              </label>
              {generationReferenceMentions.map((mention) => {
                const mentionId = packageComposerMentionId(mention);
                const option = mentionOptionsById.get(mentionId);
                const setting = referenceSettings[mentionId] ?? defaultReferenceSetting(option?.label);
                return (
                  <fieldset key={`reference-setting:${mentionId}`}>
                    <legend>@{option?.label ?? mentionId}</legend>
                    <label>
                      <span>{t('skillComposer.referenceRole')}</span>
                      <select
                        value={setting.role}
                        onChange={(event) => updateReferenceSetting(
                          mentionId,
                          { role: event.target.value as GenerationReferenceRole },
                          setReferenceSettings,
                        )}
                      >
                        {generationReferenceRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>{t('skillComposer.referencePurpose')}</span>
                      <input
                        value={setting.purpose}
                        onChange={(event) => updateReferenceSetting(
                          mentionId,
                          { purpose: event.target.value },
                          setReferenceSettings,
                        )}
                      />
                    </label>
                    <label>
                      <span>{t('skillComposer.referenceRequired')}</span>
                      <input
                        type="checkbox"
                        checked={setting.required}
                        onChange={(event) => updateReferenceSetting(
                          mentionId,
                          { required: event.target.checked },
                          setReferenceSettings,
                        )}
                      />
                    </label>
                  </fieldset>
                );
              })}
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            rows={1}
            value={instruction}
            placeholder={entrypointId ? t('skillComposer.inputPlaceholder') : t('skillComposer.slashPlaceholder')}
            onChange={(event) => updateInstruction(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
        <button
          type="button"
          className="skill-composer-mention-trigger"
          aria-label={t('skillComposer.addMention')}
          disabled={!entrypointId}
          onClick={() => setPicker({ mode: 'mention', query: '' })}
        >
          <AtSign size={16} />
        </button>
        <button type="submit" className="skill-composer-submit" disabled={!canSubmit} aria-label={t('skillComposer.create')}>
          <ArrowUp size={17} />
        </button>
      </form>
      {submitError ? <p className="skill-composer-error" role="status">{submitError}</p> : null}
      <div className="skill-composer-recommended">
        <span><Sparkles size={12} />{t('skillDock.recommended')}</span>
        {recommended.map((registration) => (
          <button
            key={registration.entrypoint.entrypointId}
            type="button"
            data-entrypoint-id={registration.entrypoint.entrypointId}
            data-package-id={registration.packageLock.packageId}
            onClick={() => selectEntryPoint(registration)}
          >
            {entryPointDisplayName(registration, t)}
          </button>
        ))}
        <button type="button" className="skill-composer-more" onClick={() => setPicker({ mode: 'entrypoint', query: '' })}>
          {t('skillDock.more')}
        </button>
      </div>
      {picker ? (
        <div className="skill-composer-picker" role="dialog" aria-label={picker.mode === 'entrypoint' ? t('skillDock.library') : t('skillComposer.mentionLibrary')}>
          <label className="skill-composer-picker-search">
            <Search size={15} />
            <input
              autoFocus
              value={picker.query}
              placeholder={picker.mode === 'entrypoint' ? t('skillDock.search') : t('skillComposer.searchMentions')}
              onChange={(event) => setPicker({ ...picker, query: event.target.value })}
            />
          </label>
          <div className="skill-composer-picker-list">
            {picker.mode === 'entrypoint' ? filteredEntryPoints.map((registration) => (
              <button
                key={registration.entrypoint.entrypointId}
                type="button"
                data-entrypoint-id={registration.entrypoint.entrypointId}
                data-package-id={registration.packageLock.packageId}
                onClick={() => selectEntryPoint(registration)}
              >
                <strong>{entryPointDisplayName(registration, t)}</strong>
                <span>{registration.entrypoint.kind === 'workflow' ? `${t('skillDock.workflowBadge')} · ` : ''}{entryPointDisplayDescription(registration, t)}</span>
              </button>
            )) : filteredMentions.map((option) => (
              <button key={option.mentionId} type="button" data-mention-id={option.mentionId} onClick={() => selectMention(option)}>
                <strong>@{option.label}</strong>
                <span>{option.kind === 'block' ? t('skillComposer.blockMention') : t('skillComposer.assetMention')} · {option.slotId}</span>
              </button>
            ))}
            {picker.mode === 'entrypoint' && filteredEntryPoints.length === 0 ? <p>{t('skillComposer.noEntryPoints')}</p> : null}
            {picker.mode === 'mention' && filteredMentions.length === 0 ? <p>{t('skillComposer.noMentions')}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function storyboardSheetParameters(
  panelCount: StoryboardSheetPanelCount,
  outputCount: 1 | 2 | 3 | 4,
): StoryboardSheetGenerationParameters {
  const gridLayout = panelCount === 6
    ? '3x2'
    : panelCount === 8
      ? '4x2'
      : panelCount === 10
        ? '5x2'
        : '4x3';
  return {
    gridLayout,
    outputCount,
    panelAspectRatio: '16:9',
    panelCount,
    renderMode: 'panel_grid',
  };
}

function defaultReferenceSetting(label?: string): ReferenceSetting {
  return {
    purpose: label ? `Preserve ${label}` : 'Preserve the declared visual authority.',
    required: true,
    role: 'general',
  };
}

function updateReferenceSetting(
  mentionId: string,
  patch: Partial<ReferenceSetting>,
  setSettings: Dispatch<SetStateAction<Record<string, ReferenceSetting>>>,
): void {
  setSettings((current) => ({
    ...current,
    [mentionId]: {
      ...defaultReferenceSetting(),
      ...current[mentionId],
      ...patch,
    },
  }));
}

function isRunnableRegistration(registration: RegisteredPackageEntryPoint): boolean {
  return registration.entrypoint.kind === 'skill' || registration.entrypoint.kind === 'workflow';
}

function filterEntryPoints(
  registrations: RegisteredPackageEntryPoint[],
  query: string,
  t: ReturnType<typeof useI18n>['t'],
): RegisteredPackageEntryPoint[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return registrations;
  return registrations.filter((registration) => `${registration.entrypoint.name} ${registration.entrypoint.description} ${entryPointDisplayName(registration, t)} ${entryPointDisplayDescription(registration, t)}`
    .toLocaleLowerCase()
    .includes(normalized));
}

function filterMentionOptions(options: PackageComposerMentionOption[], query: string): PackageComposerMentionOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter((option) => `${option.label} ${option.description} ${option.slotId} ${option.artifactType ?? ''}`
    .toLocaleLowerCase()
    .includes(normalized));
}

function mentionForOption(option: PackageComposerMentionOption): PackageComposerMention {
  return option.kind === 'block'
    ? { kind: 'block', blockId: option.blockId, slotId: option.slotId }
    : { kind: 'asset', assetId: option.assetId, slotId: option.slotId };
}

function trailingTriggerQuery(value: string, trigger: '/' | '@'): string | undefined {
  const escaped = trigger === '/' ? '\\/' : '@';
  const match = value.match(new RegExp(`(?:^|\\s)${escaped}([^\\s]*)$`));
  return match?.[1];
}

function stripTrailingTrigger(value: string, trigger: '/' | '@'): string {
  const escaped = trigger === '/' ? '\\/' : '@';
  return value.replace(new RegExp(`(?:^|\\s)${escaped}[^\\s]*$`), '').trimEnd();
}

function entryPointDisplayName(
  registration: RegisteredPackageEntryPoint,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const { entrypoint } = registration;
  if (entrypoint.kind === 'skill') return t(skillUiDefinitionFor(entrypoint.ref.skillId).nameKey);
  if (entrypoint.kind === 'workflow') return t(workflowUiDefinitionFor(entrypoint.ref.workflowDefinitionId).nameKey);
  return entrypoint.name;
}

function entryPointDisplayDescription(
  registration: RegisteredPackageEntryPoint,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const { entrypoint } = registration;
  if (entrypoint.kind === 'skill') return t(skillUiDefinitionFor(entrypoint.ref.skillId).descriptionKey);
  if (entrypoint.kind === 'workflow') return t(workflowUiDefinitionFor(entrypoint.ref.workflowDefinitionId).descriptionKey);
  return entrypoint.description;
}
