import { X } from 'lucide-react';
import type { ReactElement } from 'react';
import type {
  ComposerImageReferenceMode,
  ComposerImageReferenceSetting,
} from '../core/referenceIntent';
import { useI18n } from '../i18n';

const referenceIntentSuggestions = [
  {
    instructionKey: 'skillComposer.referenceSuggestionSceneInstruction',
    labelKey: 'skillComposer.referenceSuggestionScene',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionSubjectInstruction',
    labelKey: 'skillComposer.referenceSuggestionSubject',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionStyleInstruction',
    labelKey: 'skillComposer.referenceSuggestionStyle',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionCompositionInstruction',
    labelKey: 'skillComposer.referenceSuggestionComposition',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionLightInstruction',
    labelKey: 'skillComposer.referenceSuggestionLight',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionDetailInstruction',
    labelKey: 'skillComposer.referenceSuggestionDetail',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionCharacterInstruction',
    labelKey: 'skillComposer.referenceSuggestionCharacter',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionPoseInstruction',
    labelKey: 'skillComposer.referenceSuggestionPose',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionMaterialInstruction',
    labelKey: 'skillComposer.referenceSuggestionMaterial',
  },
  {
    instructionKey: 'skillComposer.referenceSuggestionTypographyInstruction',
    labelKey: 'skillComposer.referenceSuggestionTypography',
  },
] as const;

export function ReferenceIntentEditor({
  allowedModes = ['auto', 'source', 'reference'],
  onChange,
  onClose,
  setting,
  showModeOptions = true,
  title,
}: {
  allowedModes?: readonly ComposerImageReferenceMode[];
  onChange: (setting: ComposerImageReferenceSetting) => void;
  onClose?: () => void;
  setting: ComposerImageReferenceSetting;
  showModeOptions?: boolean;
  title: string;
}): ReactElement {
  const { t } = useI18n();

  function selectMode(mode: ComposerImageReferenceMode): void {
    onChange({
      instruction: mode === 'source' ? '' : setting.instruction,
      mode,
    });
  }

  return (
    <div
      className="image-composer-reference-editor"
      role="group"
      aria-label={t('skillComposer.referenceIntent')}
    >
      <header>
        <strong>{title}</strong>
        {onClose ? (
          <button type="button" aria-label={t('context.close')} onClick={onClose}>
            <X aria-hidden="true" size={12} />
          </button>
        ) : null}
      </header>
      {showModeOptions ? (
        <div className="image-composer-reference-mode-options">
          {allowedModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={setting.mode === mode ? 'is-selected' : ''}
              aria-pressed={setting.mode === mode}
              onClick={() => selectMode(mode)}
            >
              {t(referenceModeLabelKey(mode))}
            </button>
          ))}
        </div>
      ) : null}
      {setting.mode !== 'source' ? (
        <div
          className="image-composer-reference-suggestions"
          aria-label={t('skillComposer.referenceSuggestions')}
        >
          {referenceIntentSuggestions.map((suggestion) => {
            const instruction = t(suggestion.instructionKey);
            return (
              <button
                key={suggestion.labelKey}
                type="button"
                className={referenceSuggestionSelected(setting.instruction, instruction) ? 'is-selected' : ''}
                aria-pressed={referenceSuggestionSelected(setting.instruction, instruction)}
                onClick={() => onChange(toggleReferenceSuggestion(setting, instruction))}
              >
                {t(suggestion.labelKey)}
              </button>
            );
          })}
        </div>
      ) : null}
      <label>
        <span>{t('skillComposer.referenceIntent')}</span>
        <textarea
          rows={2}
          disabled={setting.mode === 'source'}
          placeholder={t('skillComposer.referenceIntentPlaceholder')}
          value={setting.instruction}
          onChange={(event) => onChange({
            instruction: event.target.value,
            mode: 'reference',
          })}
        />
      </label>
      <small>{t(setting.mode === 'source'
        ? 'skillComposer.referenceSourceHint'
        : 'skillComposer.referenceIntentHint')}</small>
    </div>
  );
}

function referenceModeLabelKey(
  mode: ComposerImageReferenceMode,
) {
  if (mode === 'source') return 'skillComposer.referenceModeSource' as const;
  if (mode === 'reference') return 'skillComposer.referenceModeReference' as const;
  return 'skillComposer.referenceModeAuto' as const;
}

export function toggleReferenceSuggestion(
  setting: ComposerImageReferenceSetting,
  suggestion: string,
): ComposerImageReferenceSetting {
  const segments = referenceInstructionSegments(setting.instruction);
  const selected = segments.includes(suggestion);
  const nextSegments = selected
    ? segments.filter((segment) => segment !== suggestion)
    : [...segments, suggestion];
  return {
    instruction: nextSegments.join('；'),
    mode: nextSegments.length === 0 ? 'auto' : 'reference',
  };
}

export function referenceSuggestionSelected(
  instruction: string,
  suggestion: string,
): boolean {
  return referenceInstructionSegments(instruction).includes(suggestion);
}

function referenceInstructionSegments(instruction: string): string[] {
  return instruction
    .split(/\s*[；;]\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}
