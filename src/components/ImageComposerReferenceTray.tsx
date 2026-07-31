import { ImageIcon, Plus, SlidersHorizontal, X } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  packageComposerMentionId,
  type PackageComposerMention,
  type PackageComposerMentionOption,
} from '../core/packageComposer';
import type {
  ComposerImageReferenceSetting,
  ComposerImageReferenceMode,
} from '../core/referenceIntent';
import { referenceIntentSummary, createReferenceIntent } from '../core/referenceIntent';
import type { BoardSnapshot } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

interface ImageComposerReferenceTrayProps {
  mentionOptionsById: ReadonlyMap<string, PackageComposerMentionOption>;
  mentions: PackageComposerMention[];
  onAdd: () => void;
  onChangeSetting: (
    mentionId: string,
    setting: ComposerImageReferenceSetting,
  ) => void;
  onRemove: (mentionId: string) => void;
  settings: Readonly<Record<string, ComposerImageReferenceSetting>>;
  snapshot: BoardSnapshot;
}

export interface ImageComposerReferencePresentation {
  mentionId: string;
  previewUrl?: string;
  title: string;
}

const automaticReferenceSetting: ComposerImageReferenceSetting = {
  instruction: '',
  mode: 'auto',
};

export function ImageComposerReferenceTray({
  mentionOptionsById,
  mentions,
  onAdd,
  onChangeSetting,
  onRemove,
  settings,
  snapshot,
}: ImageComposerReferenceTrayProps): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hoveredMentionId, setHoveredMentionId] = useState<string>();
  const [pinnedMentionId, setPinnedMentionId] = useState<string>();
  const [editingMentionId, setEditingMentionId] = useState<string>();
  const presentations = useMemo(
    () => mentions.map((mention) => imageComposerReferencePresentation(
      snapshot,
      mention,
      mentionOptionsById.get(packageComposerMentionId(mention)),
    )),
    [mentionOptionsById, mentions, snapshot],
  );
  const activeMentionId = editingMentionId ?? pinnedMentionId ?? hoveredMentionId;
  const activePresentation = presentations.find(
    (presentation) => presentation.mentionId === activeMentionId,
  );
  const activeSetting = activePresentation
    ? settings[activePresentation.mentionId] ?? automaticReferenceSetting
    : undefined;

  function dismissFloatingContent(): void {
    setEditingMentionId(undefined);
    setPinnedMentionId(undefined);
    setHoveredMentionId(undefined);
  }

  useDismissiblePopover({
    active: Boolean(editingMentionId || pinnedMentionId),
    onDismiss: dismissFloatingContent,
    rootRef,
  });

  function dismissOnEscape(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || !activePresentation) return;
    dismissFloatingContent();
    event.stopPropagation();
  }

  function clearHoverAfterFocusLeaves(
    event: FocusEvent<HTMLDivElement>,
    mentionId: string,
  ): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setHoveredMentionId((current) => (current === mentionId ? undefined : current));
  }

  return (
    <div
      ref={rootRef}
      className="image-composer-reference-tray"
      aria-label={t('skillComposer.selectedMentions')}
      onKeyDownCapture={dismissOnEscape}
    >
      <div className="image-composer-reference-list">
        {presentations.map((presentation) => {
          const setting = settings[presentation.mentionId] ?? automaticReferenceSetting;
          const isPinned = pinnedMentionId === presentation.mentionId;
          const isEditing = editingMentionId === presentation.mentionId;
          return (
            <div
              key={presentation.mentionId}
              className="image-composer-reference-item"
              onPointerEnter={() => setHoveredMentionId(presentation.mentionId)}
              onPointerLeave={() => setHoveredMentionId((current) => (
                current === presentation.mentionId ? undefined : current
              ))}
              onFocusCapture={() => setHoveredMentionId(presentation.mentionId)}
              onBlurCapture={(event) => clearHoverAfterFocusLeaves(event, presentation.mentionId)}
            >
              <button
                type="button"
                className="image-composer-reference-thumbnail"
                aria-expanded={isPinned}
                aria-label={`${t('skillComposer.referencePreview')}: ${presentation.title}`}
                aria-pressed={isPinned}
                onClick={() => {
                  setEditingMentionId(undefined);
                  setPinnedMentionId((current) => (
                    current === presentation.mentionId ? undefined : presentation.mentionId
                  ));
                }}
              >
                {presentation.previewUrl
                  ? <img alt="" src={presentation.previewUrl} />
                  : <ImageIcon aria-hidden="true" size={18} strokeWidth={1.6} />}
              </button>
              <button
                type="button"
                className="image-composer-reference-intent"
                aria-expanded={isEditing}
                aria-label={`${t('skillComposer.referenceIntent')}: ${presentation.title}`}
                onClick={() => {
                  setPinnedMentionId(undefined);
                  setEditingMentionId((current) => (
                    current === presentation.mentionId ? undefined : presentation.mentionId
                  ));
                }}
              >
                <SlidersHorizontal aria-hidden="true" size={11} strokeWidth={1.8} />
                <span>{referenceSettingLabel(setting, t)}</span>
              </button>
              <button
                type="button"
                className="image-composer-reference-remove"
                aria-label={`${t('skillComposer.removeMention')}: ${presentation.title}`}
                onClick={() => onRemove(presentation.mentionId)}
              >
                <X aria-hidden="true" size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="image-composer-reference-add"
          aria-label={t('skillComposer.addImageReference')}
          onClick={onAdd}
        >
          <Plus aria-hidden="true" size={17} strokeWidth={1.75} />
        </button>
      </div>
      {editingMentionId && activePresentation && activeSetting ? (
        <ReferenceIntentEditor
          presentation={activePresentation}
          setting={activeSetting}
          onChange={(setting) => onChangeSetting(editingMentionId, setting)}
          onClose={() => setEditingMentionId(undefined)}
        />
      ) : activePresentation ? (
        <figure
          className="image-composer-reference-preview"
          aria-label={t('skillComposer.referencePreview')}
        >
          <div>
            {activePresentation.previewUrl
              ? <img alt={activePresentation.title} src={activePresentation.previewUrl} />
              : <ImageIcon aria-hidden="true" size={24} strokeWidth={1.5} />}
          </div>
          <figcaption>
            <strong>{activePresentation.title}</strong>
            <span>{activeSetting ? referenceSettingLabel(activeSetting, t) : null}</span>
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}

function ReferenceIntentEditor({
  onChange,
  onClose,
  presentation,
  setting,
}: {
  onChange: (setting: ComposerImageReferenceSetting) => void;
  onClose: () => void;
  presentation: ImageComposerReferencePresentation;
  setting: ComposerImageReferenceSetting;
}): ReactElement {
  const { t } = useI18n();
  function selectMode(mode: ComposerImageReferenceMode): void {
    onChange({
      instruction: mode === 'source' ? '' : setting.instruction,
      mode,
    });
  }
  return (
    <div className="image-composer-reference-editor" role="dialog" aria-label={t('skillComposer.referenceIntent')}>
      <header>
        <strong>{presentation.title}</strong>
        <button type="button" aria-label={t('context.close')} onClick={onClose}>
          <X aria-hidden="true" size={12} />
        </button>
      </header>
      <div className="image-composer-reference-mode-options">
        {([
          ['auto', 'skillComposer.referenceModeAuto'],
          ['source', 'skillComposer.referenceModeSource'],
          ['reference', 'skillComposer.referenceModeReference'],
        ] as const).map(([mode, labelKey]) => (
          <button
            key={mode}
            type="button"
            className={setting.mode === mode ? 'is-selected' : ''}
            aria-pressed={setting.mode === mode}
            onClick={() => selectMode(mode)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
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

export function imageComposerReferencePresentation(
  snapshot: BoardSnapshot,
  mention: PackageComposerMention,
  option?: PackageComposerMentionOption,
): ImageComposerReferencePresentation {
  const mentionId = packageComposerMentionId(mention);
  if (mention.kind === 'block') {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
    const asset = typeof block?.data.assetId === 'string'
      ? snapshot.assets.find((candidate) => candidate.assetId === block.data.assetId)
      : undefined;
    return {
      mentionId,
      previewUrl: typeof block?.data.previewUrl === 'string'
        ? block.data.previewUrl
        : asset?.previewUrl,
      title: option?.label ?? block?.data.title ?? mention.blockId,
    };
  }
  const asset = snapshot.assets.find((candidate) => candidate.assetId === mention.assetId);
  return {
    mentionId,
    previewUrl: asset?.previewUrl,
    title: option?.label ?? asset?.storageKey.split('/').at(-1) ?? mention.assetId,
  };
}

function referenceSettingLabel(
  setting: ComposerImageReferenceSetting,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (setting.mode === 'source') return t('skillComposer.referenceModeSource');
  const intent = createReferenceIntent(setting.instruction, 'user');
  const summary = referenceIntentSummary(intent);
  if (summary) return summary;
  return setting.mode === 'reference'
    ? t('skillComposer.referenceModeReference')
    : t('skillComposer.referenceModeAuto');
}
