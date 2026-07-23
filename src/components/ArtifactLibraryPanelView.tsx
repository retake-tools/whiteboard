import {
  ChevronDown,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  ProjectArtifactLibraryItem,
  ProjectArtifactLibrarySnapshot,
} from '../core/artifactContracts';
import {
  artifactDisplayName,
  compatibleArtifactInputSlots,
  promotionOptionsForAssetKind,
} from '../core/artifactLibrary';
import type { BlockRecord, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

interface ArtifactLibraryPanelProps {
  error?: string;
  isLoading: boolean;
  isPromoting: boolean;
  library?: ProjectArtifactLibrarySnapshot;
  selectedBlock?: BlockRecord;
  snapshot: BoardSnapshot;
  onClose: () => void;
  onInsertReference: (item: ProjectArtifactLibraryItem, targetSlotId?: string) => void;
  onPromoteSelectedAsset: (input: { artifactType: string; name: string }) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

export function ArtifactLibraryPanel({
  error,
  isLoading,
  isPromoting,
  library,
  onClose,
  onInsertReference,
  onPromoteSelectedAsset,
  onRefresh,
  selectedBlock,
  snapshot,
}: ArtifactLibraryPanelProps): ReactElement {
  const { locale, t } = useI18n();
  const [expandedArtifactId, setExpandedArtifactId] = useState<string>();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const selectedAsset = typeof selectedBlock?.data.assetId === 'string'
    ? snapshot.assets.find((asset) => asset.assetId === selectedBlock.data.assetId)
    : undefined;
  const promotionOptions = selectedAsset
    ? promotionOptionsForAssetKind(selectedAsset.kind)
    : [];
  const [promotionType, setPromotionType] = useState('');
  const [promotionName, setPromotionName] = useState('');

  useEffect(() => {
    const nextType = promotionOptions[0]?.artifactType ?? '';
    setPromotionType(nextType);
    setPromotionName(selectedBlock?.data.title ?? '');
  }, [selectedAsset?.assetId, selectedBlock?.blockId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onClose]);

  const availableTypes = useMemo(
    () => [...new Set((library?.items ?? []).map((item) => item.artifact.artifactType))].sort(),
    [library?.items],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () => (library?.items ?? []).filter((item) => {
      if (typeFilter !== 'all' && item.artifact.artifactType !== typeFilter) return false;
      if (!normalizedQuery) return true;
      return [
        artifactDisplayName(item.artifact.semanticKey),
        item.artifact.semanticKey,
        item.artifact.artifactType,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    }),
    [library?.items, normalizedQuery, typeFilter],
  );
  const selectedOperation = selectedBlock?.type === 'operation' ? selectedBlock : undefined;

  return (
    <aside className="artifact-library-panel" aria-label={t('artifactLibrary.title')}>
      <header>
        <div>
          <span>{t('artifactLibrary.eyebrow')}</span>
          <strong>{t('artifactLibrary.title')}</strong>
        </div>
        <div className="artifact-library-header-actions">
          <TooltipIconButton
            disabled={isLoading}
            label={t('artifactLibrary.refresh')}
            onClick={() => void onRefresh()}
          >
            <RefreshCw className={isLoading ? 'is-spinning' : undefined} size={15} />
          </TooltipIconButton>
          <TooltipIconButton label={t('artifactLibrary.close')} onClick={onClose}>
            <X size={15} />
          </TooltipIconButton>
        </div>
      </header>

      {selectedAsset && promotionOptions.length > 0 ? (
        <form
          className="artifact-library-promotion"
          onSubmit={(event) => {
            event.preventDefault();
            if (!promotionType || !promotionName.trim()) return;
            void onPromoteSelectedAsset({
              artifactType: promotionType,
              name: promotionName.trim(),
            });
          }}
        >
          <div>
            <span>{t('artifactLibrary.promoteEyebrow')}</span>
            <strong>{selectedBlock?.data.title}</strong>
          </div>
          <label>
            <span>{t('artifactLibrary.type')}</span>
            <select value={promotionType} onChange={(event) => setPromotionType(event.target.value)}>
              {promotionOptions.map((option) => (
                <option key={option.artifactType} value={option.artifactType}>
                  {artifactTypeLabel(option.artifactType, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('artifactLibrary.name')}</span>
            <input
              value={promotionName}
              placeholder={t('artifactLibrary.namePlaceholder')}
              onChange={(event) => setPromotionName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={isPromoting || !promotionName.trim()}>
            {isPromoting ? <Loader2 className="is-spinning" size={14} /> : <Plus size={14} />}
            {t('artifactLibrary.promote')}
          </button>
        </form>
      ) : null}

      {selectedOperation ? (
        <div className="artifact-library-bind-target">
          <Link2 size={14} />
          <span>{t('artifactLibrary.bindTarget')}</span>
          <strong>{selectedOperation.data.title}</strong>
        </div>
      ) : null}

      <div className="artifact-library-filters">
        <label>
          <Search size={14} />
          <input
            value={query}
            placeholder={t('artifactLibrary.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label={t('artifactLibrary.filterType')}
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="all">{t('artifactLibrary.allTypes')}</option>
          {availableTypes.map((artifactType) => (
            <option key={artifactType} value={artifactType}>
              {artifactTypeLabel(artifactType, t)}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="artifact-library-error">{error}</p> : null}
      {isLoading && !library ? (
        <div className="artifact-library-loading">
          <Loader2 className="is-spinning" size={17} />
          <span>{t('artifactLibrary.loading')}</span>
        </div>
      ) : visibleItems.length > 0 ? (
        <ol className="artifact-library-list">
          {visibleItems.map((item) => {
            const isExpanded = expandedArtifactId === item.artifact.artifactId;
            const slots = compatibleArtifactInputSlots(snapshot, selectedOperation, item);
            const canInsert = item.primaryAsset.kind !== 'audio' && item.primaryAsset.kind !== 'other';
            return (
              <li key={item.artifact.artifactId} className="artifact-library-item">
                <ArtifactPreview item={item} />
                <div className="artifact-library-item-main">
                  <div className="artifact-library-item-title">
                    <strong>{artifactDisplayName(item.artifact.semanticKey)}</strong>
                    <span>v{item.currentRevision.revision}</span>
                  </div>
                  <p>{artifactTypeLabel(item.artifact.artifactType, t)}</p>
                  <time dateTime={item.artifact.updatedAt}>
                    {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.artifact.updatedAt))}
                  </time>
                  <div className="artifact-library-item-actions">
                    <button
                      type="button"
                      disabled={!canInsert}
                      onClick={() => onInsertReference(item)}
                    >
                      <Plus size={13} />
                      {t('artifactLibrary.addToBoard')}
                    </button>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedArtifactId((current) =>
                        current === item.artifact.artifactId ? undefined : item.artifact.artifactId)}
                    >
                      <ChevronDown className={isExpanded ? 'is-expanded' : undefined} size={13} />
                      {t('artifactLibrary.revisions')} {item.revisions.length}
                    </button>
                  </div>
                  {slots.length > 0 ? (
                    <div className="artifact-library-slot-actions">
                      <span>{t('artifactLibrary.bindToSlot')}</span>
                      {slots.map((slot) => (
                        <button
                          key={slot.slotId}
                          type="button"
                          onClick={() => onInsertReference(item, slot.slotId)}
                        >
                          <Link2 size={12} />
                          {slot.slotId}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {isExpanded ? (
                    <ol className="artifact-library-revisions">
                      {item.revisions.map((revision) => (
                        <li key={revision.artifactRevisionId}>
                          <span>v{revision.revision}</span>
                          <code>{revision.primaryAssetId}</code>
                          <time dateTime={revision.createdAt}>
                            {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(
                              new Date(revision.createdAt),
                            )}
                          </time>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="artifact-library-empty">
          {library?.items.length ? t('artifactLibrary.noResults') : t('artifactLibrary.empty')}
        </p>
      )}
    </aside>
  );
}

function ArtifactPreview({ item }: { item: ProjectArtifactLibraryItem }): ReactElement {
  if (item.primaryAsset.kind === 'image') {
    return <img alt="" className="artifact-library-preview" src={item.primaryAsset.previewUrl} />;
  }
  if (item.primaryAsset.kind === 'video') {
    return <video className="artifact-library-preview" muted preload="metadata" src={item.primaryAsset.previewUrl} />;
  }
  return (
    <div className="artifact-library-preview is-placeholder">
      {item.primaryAsset.kind === 'document'
        ? <FileText size={22} />
        : item.primaryAsset.kind === 'audio'
          ? <Film size={22} />
          : <ImageIcon size={22} />}
    </div>
  );
}

function artifactTypeLabel(
  artifactType: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const known = {
    character_reference: 'artifactLibrary.typeCharacterReference',
    scene_reference: 'artifactLibrary.typeSceneReference',
    prop_reference: 'artifactLibrary.typePropReference',
    style_reference: 'artifactLibrary.typeStyleReference',
    creative_brief: 'artifactLibrary.typeCreativeBrief',
    screenplay_master: 'artifactLibrary.typeScreenplay',
    character_bible: 'artifactLibrary.typeCharacterBible',
    scene_bible: 'artifactLibrary.typeSceneBible',
    storyboard_plan: 'artifactLibrary.typeStoryboard',
    video_clip: 'artifactLibrary.typeVideo',
    voice_reference: 'artifactLibrary.typeVoiceReference',
  } as const;
  return artifactType in known
    ? t(known[artifactType as keyof typeof known])
    : artifactType.replace(/_/g, ' ');
}
