import { useState, type ReactElement } from 'react';
import {
  normalizeBoardBackground,
} from '../core/boardBackground';
import type {
  BoardBackgroundV1,
  BoardSnapshot,
} from '../core/types';
import { useI18n } from '../i18n';
import './board-background-settings.css';

export function BoardBackgroundSettings({
  onApply,
  onClose,
  snapshot,
}: {
  onApply: (background: BoardBackgroundV1) => void;
  onClose: () => void;
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const current = normalizeBoardBackground(snapshot.board.background);
  const [kind, setKind] = useState(current.kind);
  const [color, setColor] = useState(
    current.kind === 'solid' ? current.color : '#f7f8fa',
  );
  const imageAssets = snapshot.assets.filter((asset) => (
    asset.kind === 'image'
    && asset.projectId === snapshot.project.projectId
  ));
  const [assetId, setAssetId] = useState(
    current.kind === 'image' ? current.assetId : imageAssets[0]?.assetId ?? '',
  );
  const [fit, setFit] = useState<'contain' | 'cover'>(
    current.kind === 'image' ? current.fit : 'cover',
  );

  function apply(): void {
    if (kind === 'solid') onApply({ color, kind });
    else if (kind === 'image') onApply({ assetId, fit, kind });
    else onApply({ kind: 'default' });
    onClose();
  }

  return (
    <div className="board-background-backdrop" onMouseDown={onClose}>
      <section
        aria-label={t('settings.boardBackground')}
        aria-modal="true"
        className="board-background-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <h2>{t('settings.boardBackground')}</h2>
            <p>{t('settings.boardBackgroundDescription')}</p>
          </div>
          <button onClick={onClose} type="button">
            {t('settings.boardBackgroundCancel')}
          </button>
        </header>
        <label>
          <span>{t('settings.boardBackgroundMode')}</span>
          <select
            onChange={(event) => setKind(
              event.target.value as BoardBackgroundV1['kind'],
            )}
            value={kind}
          >
            <option value="default">{t('settings.boardBackgroundDefault')}</option>
            <option value="solid">{t('settings.boardBackgroundSolid')}</option>
            <option value="image">{t('settings.boardBackgroundImage')}</option>
          </select>
        </label>
        {kind === 'solid' ? (
          <label>
            <span>{t('settings.boardBackgroundColor')}</span>
            <input
              onChange={(event) => setColor(event.target.value)}
              type="color"
              value={color}
            />
          </label>
        ) : null}
        {kind === 'image' ? (
          <>
            <label>
              <span>{t('settings.boardBackgroundAsset')}</span>
              <select
                onChange={(event) => setAssetId(event.target.value)}
                value={assetId}
              >
                {imageAssets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.assetId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('settings.boardBackgroundFit')}</span>
              <select
                onChange={(event) => setFit(
                  event.target.value as 'contain' | 'cover',
                )}
                value={fit}
              >
                <option value="cover">{t('settings.boardBackgroundCover')}</option>
                <option value="contain">{t('settings.boardBackgroundContain')}</option>
              </select>
            </label>
            {imageAssets.length === 0 ? (
              <p>{t('settings.boardBackgroundNoImages')}</p>
            ) : null}
          </>
        ) : null}
        <footer>
          <button
            disabled={kind === 'image' && !assetId}
            onClick={apply}
            type="button"
          >
            {t('settings.boardBackgroundApply')}
          </button>
        </footer>
      </section>
    </div>
  );
}
