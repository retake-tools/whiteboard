import {
  ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { memo, useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  ProjectAssetCatalogItem,
  ProjectAssetCatalogSnapshot,
} from '../core/projectAssetCatalog';
import { useI18n } from '../i18n';

export const WorkspaceMaterials = memo(function WorkspaceMaterials({
  catalog,
  error,
  isLoading,
  onAdd,
  onRefresh,
  onRelink,
  onUpload,
  pendingAssetId,
  projectName,
}: {
  catalog?: ProjectAssetCatalogSnapshot;
  error?: string;
  isLoading: boolean;
  onAdd: (item: ProjectAssetCatalogItem) => void;
  onRefresh: () => void;
  onRelink: (item: ProjectAssetCatalogItem, file: File) => void;
  onUpload: (file: File) => void;
  pendingAssetId?: string;
  projectName: string;
}): ReactElement {
  const { locale, t } = useI18n();
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const relinkRef = useRef<HTMLInputElement | null>(null);
  const pendingRelinkItemRef = useRef<ProjectAssetCatalogItem | undefined>(undefined);
  const [query, setQuery] = useState('');
  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (catalog?.items ?? []).filter((item) => (
      item.asset.kind === 'image'
      && (!normalized || item.fileName.toLocaleLowerCase().includes(normalized))
    ));
  }, [catalog, query]);

  return (
    <section className="workspace-materials" aria-labelledby="workspace-materials-title">
      <input
        ref={uploadRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onUpload(file);
        }}
      />
      <input
        ref={relinkRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          const item = pendingRelinkItemRef.current;
          event.currentTarget.value = '';
          pendingRelinkItemRef.current = undefined;
          if (file && item) onRelink(item, file);
        }}
      />

      <header className="workspace-materials-header">
        <div>
          <h1 id="workspace-materials-title">{t('workspaceMaterials.title')}</h1>
          <p>{projectName} · {t('workspaceMaterials.subtitle')}</p>
        </div>
        <div className="workspace-materials-actions">
          <button type="button" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw size={17} />
            {t('workspaceMaterials.refresh')}
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={pendingAssetId === 'upload'}
            onClick={() => uploadRef.current?.click()}
          >
            {pendingAssetId === 'upload' ? <Loader2 className="is-spinning" size={17} /> : <Upload size={17} />}
            {t('workspaceMaterials.upload')}
          </button>
        </div>
      </header>

      <label className="workspace-materials-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label={t('workspaceMaterials.search')}
          value={query}
          placeholder={t('workspaceMaterials.search')}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

      {error ? <p className="workspace-materials-error" role="alert">{error}</p> : null}
      {isLoading && !catalog ? (
        <div className="workspace-materials-empty"><Loader2 className="is-spinning" size={24} />{t('workspaceMaterials.loading')}</div>
      ) : items.length ? (
        <div className="workspace-materials-grid">
          {items.map((item) => (
            <article className={`workspace-material-card${item.available ? '' : ' is-missing'}`} key={item.asset.assetId}>
              <div className="workspace-material-preview">
                {item.available ? (
                  <img alt="" decoding="async" loading="lazy" src={item.asset.previewUrl} />
                ) : (
                  <span><TriangleAlert size={24} />{t('workspaceMaterials.missing')}</span>
                )}
              </div>
              <div className="workspace-material-copy">
                <strong title={item.fileName}>{item.fileName}</strong>
                <small>
                  {item.asset.width && item.asset.height ? `${item.asset.width} × ${item.asset.height} · ` : ''}
                  {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' }).format(Date.parse(item.asset.createdAt))}
                </small>
              </div>
              <div className="workspace-material-card-actions">
                {item.available ? (
                  <button
                    type="button"
                    className="is-primary"
                    disabled={Boolean(pendingAssetId)}
                    onClick={() => onAdd(item)}
                  >
                    {pendingAssetId === item.asset.assetId ? <Loader2 className="is-spinning" size={15} /> : <Plus size={15} />}
                    {t('workspaceMaterials.addToBoard')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(pendingAssetId)}
                    onClick={() => {
                      pendingRelinkItemRef.current = item;
                      relinkRef.current?.click();
                    }}
                  >
                    {pendingAssetId === item.asset.assetId ? <Loader2 className="is-spinning" size={15} /> : <ImageIcon size={15} />}
                    {t('workspaceMaterials.relink')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="workspace-materials-empty">
          <ImageIcon size={28} />
          <strong>{query ? t('workspaceMaterials.noResults') : t('workspaceMaterials.emptyTitle')}</strong>
          <p>{query ? t('workspaceMaterials.noResultsDescription') : t('workspaceMaterials.emptyDescription')}</p>
          {!query ? (
            <button type="button" className="is-primary" onClick={() => uploadRef.current?.click()}>
              <Upload size={17} />
              {t('workspaceMaterials.upload')}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
});
