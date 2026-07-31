import { ImageIcon, Plus, X } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  imageComposerReferenceRoles,
  type ImageComposerReferenceRole,
} from '../core/imageComposer';
import {
  packageComposerMentionId,
  type PackageComposerMention,
  type PackageComposerMentionOption,
} from '../core/packageComposer';
import type { BoardSnapshot } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

interface ImageComposerReferenceTrayProps {
  mentionOptionsById: ReadonlyMap<string, PackageComposerMentionOption>;
  mentions: PackageComposerMention[];
  onAdd: () => void;
  onChangeRole: (mentionId: string, role: ImageComposerReferenceRole) => void;
  onRemove: (mentionId: string) => void;
  roles: Record<string, ImageComposerReferenceRole>;
  snapshot: BoardSnapshot;
}

export interface ImageComposerReferencePresentation {
  mentionId: string;
  previewUrl?: string;
  title: string;
}

export function ImageComposerReferenceTray({
  mentionOptionsById,
  mentions,
  onAdd,
  onChangeRole,
  onRemove,
  roles,
  snapshot,
}: ImageComposerReferenceTrayProps): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hoveredMentionId, setHoveredMentionId] = useState<string>();
  const [pinnedMentionId, setPinnedMentionId] = useState<string>();
  const presentations = useMemo(
    () => mentions.map((mention) => imageComposerReferencePresentation(
      snapshot,
      mention,
      mentionOptionsById.get(packageComposerMentionId(mention)),
    )),
    [mentionOptionsById, mentions, snapshot],
  );
  const activeMentionId = pinnedMentionId ?? hoveredMentionId;
  const activePresentation = presentations.find(
    (presentation) => presentation.mentionId === activeMentionId,
  );
  const activeRole = activePresentation
    ? roles[activePresentation.mentionId] ?? 'general_reference'
    : undefined;

  function dismissPreview(): void {
    setPinnedMentionId(undefined);
    setHoveredMentionId(undefined);
  }

  useDismissiblePopover({
    active: Boolean(pinnedMentionId),
    onDismiss: dismissPreview,
    rootRef,
  });

  function dismissPreviewOnEscape(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || !activePresentation) return;
    dismissPreview();
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
      onKeyDownCapture={dismissPreviewOnEscape}
    >
      <div className="image-composer-reference-list">
        {presentations.map((presentation) => {
          const role = roles[presentation.mentionId] ?? 'general_reference';
          const isPinned = pinnedMentionId === presentation.mentionId;
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
                onClick={() => setPinnedMentionId((current) => (
                  current === presentation.mentionId ? undefined : presentation.mentionId
                ))}
              >
                {presentation.previewUrl
                  ? <img alt="" src={presentation.previewUrl} />
                  : <ImageIcon aria-hidden="true" size={18} strokeWidth={1.6} />}
              </button>
              <select
                className="image-composer-reference-role"
                aria-label={`${t('skillComposer.referenceRole')}: ${presentation.title}`}
                value={role}
                onChange={(event) => onChangeRole(
                  presentation.mentionId,
                  event.target.value as ImageComposerReferenceRole,
                )}
              >
                {imageComposerReferenceRoles.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {imageReferenceRoleLabel(candidate, t)}
                  </option>
                ))}
              </select>
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
      {activePresentation ? (
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
            <span>{activeRole ? imageReferenceRoleLabel(activeRole, t) : null}</span>
          </figcaption>
        </figure>
      ) : null}
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

function imageReferenceRoleLabel(
  role: ImageComposerReferenceRole,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const keys: Record<ImageComposerReferenceRole, Parameters<typeof t>[0]> = {
    character_reference: 'skillComposer.referenceRoleCharacter',
    composition_reference: 'skillComposer.referenceRoleComposition',
    environment_reference: 'skillComposer.referenceRoleEnvironment',
    general_reference: 'skillComposer.referenceRoleGeneral',
    object_reference: 'skillComposer.referenceRoleObject',
    pose_reference: 'skillComposer.referenceRolePose',
    source: 'skillComposer.referenceRoleSource',
    style_reference: 'skillComposer.referenceRoleStyle',
  };
  return t(keys[role]);
}
