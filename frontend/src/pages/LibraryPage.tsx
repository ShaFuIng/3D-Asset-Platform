import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiClientError,
  deleteLibraryAsset,
  getLibraryAsset,
  getLibraryAssets,
  resolveApiUrl,
  restoreLibraryAsset,
  trashLibraryAsset,
} from '../api/client';
import { ImageLightbox, type LightboxImage } from '../components/ImageLightbox';
import { ModelViewer } from '../components/ModelViewer';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { useWorkspace } from '../context/WorkspaceContext';
import type {
  LibraryAsset,
  LibraryAssetQuery,
  LibraryAssetSort,
  LibraryAssetType,
} from '../types/api';
import { libraryAssetToImageAsset } from '../utils/libraryAsset';

type LibraryTab = 'images' | 'models' | 'trash';

const PAGE_SIZE = 24;
const SORT_OPTIONS: Array<{ value: LibraryAssetSort; label: string }> = [
  { value: 'created_at_desc', label: 'Newest' },
  { value: 'created_at_asc', label: 'Oldest' },
  { value: 'filename_asc', label: 'Filename A-Z' },
  { value: 'filename_desc', label: 'Filename Z-A' },
  { value: 'size_desc', label: 'Size large first' },
  { value: 'size_asc', label: 'Size small first' },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return 'Request failed.';
}

export function LibraryPage() {
  const navigate = useNavigate();
  const {
    images,
    importLibraryImageAsReference,
    archiveImage,
    restoreImage,
    forgetWorkspaceImage,
  } = useWorkspace();
  const [tab, setTab] = useState<LibraryTab>('images');
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<LibraryAssetSort>('created_at_desc');
  const [source, setSource] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationErrors, setMutationErrors] = useState<Record<string, string>>({});
  const [pendingMutations, setPendingMutations] = useState<Record<string, true>>({});
  const [lightboxAsset, setLightboxAsset] = useState<LibraryAsset | null>(null);
  const [modelAsset, setModelAsset] = useState<LibraryAsset | null>(null);
  const [referencePreviewAsset, setReferencePreviewAsset] = useState<LibraryAsset | null>(null);
  const mutationLockRef = useRef<Set<string>>(new Set());
  const requestSeqRef = useRef(0);

  const query = createQuery(tab, { page, sort, source, pipeline, search });
  const fetchKey = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setIsLoading(true);
    setError(null);

    void getLibraryAssets(query, controller.signal)
      .then((data) => {
        if (requestSeqRef.current !== requestId) {
          return;
        }
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((requestError) => {
        const message = getErrorMessage(requestError);
        if (message && requestSeqRef.current === requestId) {
          setError(message);
        }
      })
      .finally(() => {
        if (requestSeqRef.current === requestId) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  function resetFilters(nextTab: LibraryTab) {
    setTab(nextTab);
    setPage(1);
    setSource('');
    setPipeline('');
    setSearch('');
    setSearchDraft('');
    setModelAsset(null);
    setLightboxAsset(null);
    setReferencePreviewAsset(null);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  }

  function refreshCurrentPage() {
    requestSeqRef.current += 1;
    const controller = new AbortController();
    const requestId = requestSeqRef.current;
    setIsLoading(true);
    setError(null);
    void getLibraryAssets(query, controller.signal)
      .then((data) => {
        if (requestSeqRef.current !== requestId) {
          return;
        }
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((requestError) => {
        const message = getErrorMessage(requestError);
        if (message && requestSeqRef.current === requestId) {
          setError(message);
        }
      })
      .finally(() => {
        if (requestSeqRef.current === requestId) {
          setIsLoading(false);
        }
      });
  }

  async function runMutation(asset: LibraryAsset, action: 'trash' | 'restore' | 'delete') {
    const key = `${asset.asset_id}:${action}`;
    if (mutationLockRef.current.has(asset.asset_id)) {
      return;
    }
    if (action === 'trash' && !window.confirm('將此資產移至回收桶？')) {
      return;
    }
    if (action === 'restore' && !window.confirm('恢復此資產？')) {
      return;
    }
    if (action === 'delete' && !window.confirm('永久刪除後無法復原，確定刪除此資產？')) {
      return;
    }

    mutationLockRef.current.add(asset.asset_id);
    setPendingMutations((current) => ({ ...current, [key]: true }));
    setMutationErrors((current) => {
      const next = { ...current };
      delete next[asset.asset_id];
      return next;
    });

    try {
      if (action === 'trash') {
        await trashLibraryAsset(asset.asset_id);
        if (asset.asset_type === 'image') {
          archiveImage(asset.asset_id);
        }
      } else if (action === 'restore') {
        await restoreLibraryAsset(asset.asset_id);
        if (asset.asset_type === 'image' && images.some((image) => image.image_id === asset.asset_id)) {
          restoreImage(asset.asset_id);
        }
      } else {
        await deleteLibraryAsset(asset.asset_id);
        if (asset.asset_type === 'image') {
          forgetWorkspaceImage(asset.asset_id);
        }
        if (lightboxAsset?.asset_id === asset.asset_id) {
          setLightboxAsset(null);
        }
        if (modelAsset?.asset_id === asset.asset_id) {
          setModelAsset(null);
        }
      }
      setItems((current) => current.filter((item) => item.asset_id !== asset.asset_id));
      setTotal((current) => Math.max(0, current - 1));
      refreshCurrentPage();
    } catch (requestError) {
      setMutationErrors((current) => ({
        ...current,
        [asset.asset_id]: getErrorMessage(requestError),
      }));
    } finally {
      mutationLockRef.current.delete(asset.asset_id);
      setPendingMutations((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function importAsReference(asset: LibraryAsset) {
    importLibraryImageAsReference(libraryAssetToImageAsset(asset));
    navigate('/reference');
  }

  async function previewReference(asset: LibraryAsset) {
    if (!asset.reference_image_id) {
      return;
    }
    try {
      const reference = await getLibraryAsset(asset.reference_image_id);
      if (reference.asset_type !== 'image' || reference.status === 'missing') {
        setMutationErrors((current) => ({
          ...current,
          [asset.asset_id]: 'Reference image is unavailable.',
        }));
        return;
      }
      setReferencePreviewAsset(reference);
    } catch (requestError) {
      setMutationErrors((current) => ({
        ...current,
        [asset.asset_id]: getErrorMessage(requestError),
      }));
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="library-page">
      <Link className="back-button" to="/">
        ← 返回首頁
      </Link>

      <section className="panel library-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">ASSET LIBRARY</p>
            <h2>資產庫</h2>
          </div>
          <span>{total.toLocaleString()} assets</span>
        </div>

        <div className="library-tabs" role="tablist" aria-label="Library tabs">
          <button type="button" data-selected={tab === 'images'} onClick={() => resetFilters('images')}>
            Images
          </button>
          <button type="button" data-selected={tab === 'models'} onClick={() => resetFilters('models')}>
            Models
          </button>
          <button type="button" data-selected={tab === 'trash'} onClick={() => resetFilters('trash')}>
            Trash
          </button>
        </div>

        <form className="library-toolbar" onSubmit={submitSearch}>
          <label>
            Search
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Filename or original name"
            />
          </label>
          <label>
            Source
            <select
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="uploaded">uploaded</option>
              <option value="generated">generated</option>
              <option value="edited">edited</option>
              <option value="multiview">multiview</option>
              <option value="legacy">legacy</option>
            </select>
          </label>
          <label>
            Pipeline
            <select
              value={pipeline}
              onChange={(event) => {
                setPipeline(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="single">single</option>
              <option value="multiview">multiview</option>
              <option value="legacy">legacy</option>
            </select>
          </label>
          <label>
            Sort
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as LibraryAssetSort);
                setPage(1);
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Search</button>
        </form>

        {error && (
          <div className="empty-state compact">
            <p className="hint error">{error}</p>
            <button type="button" onClick={refreshCurrentPage}>
              Retry
            </button>
          </div>
        )}

        {isLoading && <div className="empty-state compact">Loading assets...</div>}

        {!isLoading && !error && items.length === 0 && (
          <div className="empty-state compact">No assets found.</div>
        )}

        {!isLoading && !error && items.length > 0 && (
          <div className="asset-grid">
            {items.map((asset) =>
              asset.asset_type === 'image' ? (
                <ImageAssetCard
                  key={asset.asset_id}
                  asset={asset}
                  isTrash={tab === 'trash'}
                  pending={pendingMutations}
                  error={mutationErrors[asset.asset_id]}
                  onPreview={() => setLightboxAsset(asset)}
                  onImport={() => importAsReference(asset)}
                  onTrash={() => void runMutation(asset, 'trash')}
                  onRestore={() => void runMutation(asset, 'restore')}
                  onDelete={() => void runMutation(asset, 'delete')}
                />
              ) : (
                <ModelAssetCard
                  key={asset.asset_id}
                  asset={asset}
                  isTrash={tab === 'trash'}
                  pending={pendingMutations}
                  error={mutationErrors[asset.asset_id]}
                  onPreview={() => setModelAsset(asset)}
                  onReference={() => void previewReference(asset)}
                  onTrash={() => void runMutation(asset, 'trash')}
                  onRestore={() => void runMutation(asset, 'restore')}
                  onDelete={() => void runMutation(asset, 'delete')}
                />
              ),
            )}
          </div>
        )}

        <div className="library-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Previous
          </button>
          <span>
            Page {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      </section>

      {lightboxAsset && (
        <ImageLightbox image={toLightboxImage(lightboxAsset)} onClose={() => setLightboxAsset(null)} />
      )}
      {referencePreviewAsset && (
        <ImageLightbox
          image={toLightboxImage(referencePreviewAsset)}
          onClose={() => setReferencePreviewAsset(null)}
        />
      )}
      {modelAsset && (
        <div className="library-modal" role="dialog" aria-modal="true" aria-label="Model preview">
          <div className="library-modal-content">
            <button type="button" className="lightbox-close" onClick={() => setModelAsset(null)}>
              ×
            </button>
            <h3>{modelAsset.filename}</h3>
            <ModelViewer
              src={modelAsset.status === 'available' ? resolveApiUrl(modelAsset.content_url) : undefined}
              usdzUrl={
                modelAsset.status === 'available'
                  ? resolveApiUrl(`/api/library/assets/${modelAsset.asset_id}/usdz`)
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ImageAssetCard({
  asset,
  isTrash,
  pending,
  error,
  onPreview,
  onImport,
  onTrash,
  onRestore,
  onDelete,
}: {
  asset: LibraryAsset;
  isTrash: boolean;
  pending: Record<string, true>;
  error?: string;
  onPreview: () => void;
  onImport: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const isAvailable = asset.status === 'available';
  const isBusy = hasPending(pending, asset.asset_id);
  return (
    <article className="asset-card">
      <button type="button" className="asset-preview-button" onClick={onPreview} disabled={!isAvailable}>
        <img src={resolveApiUrl(asset.content_url)} alt={asset.filename} />
      </button>
      <div className="asset-card-body">
        <div>
          <strong>{imageSourceLabel(asset)}</strong>
          <p className="hint">{formatDate(asset.created_at)} · {formatBytes(asset.size_bytes)}</p>
        </div>
        <span className="badge" data-kind={asset.status === 'available' ? 'succeeded' : 'failed'}>
          {asset.status}
        </span>
        <TechnicalDetails items={technicalItems(asset)} />
        {error && <p className="hint error">{error}</p>}
      </div>
      <div className="asset-actions">
        {!isTrash ? (
          <>
            <button type="button" onClick={onPreview} disabled={!isAvailable}>
              放大檢視
            </button>
            <button type="button" onClick={onImport} disabled={!isAvailable}>
              設為 Reference 並前往調整
            </button>
            <button type="button" onClick={onTrash} disabled={isBusy}>
              {pending[`${asset.asset_id}:trash`] ? '處理中...' : '移至回收桶'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onPreview} disabled={!isAvailable}>
              預覽
            </button>
            <button type="button" onClick={onRestore} disabled={isBusy}>
              {pending[`${asset.asset_id}:restore`] ? '處理中...' : '恢復'}
            </button>
            <button type="button" onClick={onDelete} disabled={isBusy}>
              {pending[`${asset.asset_id}:delete`] ? '處理中...' : '永久刪除'}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function ModelAssetCard({
  asset,
  isTrash,
  pending,
  error,
  onPreview,
  onReference,
  onTrash,
  onRestore,
  onDelete,
}: {
  asset: LibraryAsset;
  isTrash: boolean;
  pending: Record<string, true>;
  error?: string;
  onPreview: () => void;
  onReference: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const isAvailable = asset.status === 'available';
  const isBusy = hasPending(pending, asset.asset_id);
  return (
    <article className="asset-card model-asset-card">
      <div className="model-asset-icon">GLB</div>
      <div className="asset-card-body">
        <strong>{asset.filename}</strong>
        <p className="hint">
          {asset.pipeline ?? 'unknown'} · {asset.model_variant ?? 'unknown'} · {formatBytes(asset.size_bytes)}
        </p>
        <span className="badge" data-kind={asset.status === 'available' ? 'succeeded' : 'failed'}>
          {asset.status}
        </span>
        <TechnicalDetails items={technicalItems(asset)} />
        {error && <p className="hint error">{error}</p>}
      </div>
      <div className="asset-actions">
        <button type="button" onClick={onPreview} disabled={!isAvailable}>
          預覽模型
        </button>
        <a
          className="download-link"
          href={isAvailable ? resolveApiUrl(asset.content_url) : undefined}
          download={asset.filename}
          aria-disabled={!isAvailable}
        >
          下載 GLB
        </a>
        {asset.reference_image_id && (
          <button type="button" onClick={onReference}>
            查看 Reference Image
          </button>
        )}
        {!isTrash ? (
          <button type="button" onClick={onTrash} disabled={isBusy}>
            {pending[`${asset.asset_id}:trash`] ? '處理中...' : '移至回收桶'}
          </button>
        ) : (
          <>
            <button type="button" onClick={onRestore} disabled={isBusy}>
              {pending[`${asset.asset_id}:restore`] ? '處理中...' : '恢復'}
            </button>
            <button type="button" onClick={onDelete} disabled={isBusy}>
              {pending[`${asset.asset_id}:delete`] ? '處理中...' : '永久刪除'}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function createQuery(
  tab: LibraryTab,
  filters: {
    page: number;
    sort: LibraryAssetSort;
    source: string;
    pipeline: string;
    search: string;
  },
): LibraryAssetQuery {
  const type: LibraryAssetType | undefined =
    tab === 'images' ? 'image' : tab === 'models' ? 'model' : undefined;
  return {
    type,
    state: tab === 'trash' ? 'trash' : 'active',
    source: filters.source || undefined,
    pipeline: filters.pipeline || undefined,
    search: filters.search || undefined,
    sort: filters.sort,
    page: filters.page,
    page_size: PAGE_SIZE,
  };
}

function toLightboxImage(asset: LibraryAsset): LightboxImage {
  return {
    url: asset.content_url,
    imageId: asset.asset_id,
    filename: asset.filename,
    source: asset.source,
    parentImageId: asset.parent_image_id ?? undefined,
    technicalItems: technicalItems(asset),
  };
}

function technicalItems(asset: LibraryAsset): Array<[string, string | null | undefined]> {
  return [
    ['asset_id', asset.asset_id],
    ['filename', asset.filename],
    ['source', asset.source],
    ['parent_image_id', asset.parent_image_id],
    ['reference_image_id', asset.reference_image_id],
    ['related_job_id', asset.related_job_id],
    ['view_name', asset.view_name],
    ['pipeline', asset.pipeline],
    ['model_variant', asset.model_variant],
    ['status', asset.status],
  ];
}

function imageSourceLabel(asset: LibraryAsset): string {
  if (asset.source === 'edited') {
    return '修改版本';
  }
  if (asset.source === 'multiview' && asset.view_name) {
    return `Multiview ${asset.view_name}`;
  }
  if (asset.source === 'generated') {
    return '生成圖片';
  }
  if (asset.source === 'uploaded') {
    return '上傳圖片';
  }
  return asset.source;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function hasPending(pending: Record<string, true>, assetId: string): boolean {
  return Boolean(
    pending[`${assetId}:trash`] || pending[`${assetId}:restore`] || pending[`${assetId}:delete`],
  );
}
