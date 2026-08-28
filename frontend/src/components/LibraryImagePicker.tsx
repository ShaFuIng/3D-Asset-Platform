import { useEffect, useRef, useState } from 'react';
import { ApiClientError, getLibraryAssets, resolveApiUrl } from '../api/client';
import type { ImageAsset, LibraryAsset } from '../types/api';
import { libraryAssetToImageAsset } from '../utils/libraryAsset';

const PAGE_SIZE = 24;

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return 'Request failed.';
}

function assetSourceLabel(source: string): string {
  switch (source) {
    case 'generated':
      return '生成圖片';
    case 'uploaded':
      return '上傳圖片';
    case 'edited':
      return '修改版本';
    case 'multiview':
      return '多視圖產生';
    default:
      return source;
  }
}

type LibraryImagePickerProps = {
  onSelect: (image: ImageAsset) => void;
  onClose: () => void;
};

// Stage 01 entry point for picking an image that already exists in the asset
// library (past uploads/generations), instead of only the images added during
// this browser session (see WorkspaceContext.tsx's `images` state). Visually
// mirrors LibraryPage.tsx's own asset-card language (.asset-grid/.asset-card/
// .library-modal) since it's rendering the same LibraryAsset shape, but does
// NOT reuse LibraryPage's ImageAssetCard/runMutation -- those are wired into
// trash/restore/delete and workspace-archive side effects this picker has no
// business touching. It only ever lists image-type, non-trashed assets and
// hands the chosen one back to the caller.
export function LibraryImagePicker({ onSelect, onClose }: LibraryImagePickerProps) {
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setIsLoading(true);
    setError(null);

    void getLibraryAssets({ type: 'image', page, page_size: PAGE_SIZE }, controller.signal)
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
  }, [page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="library-modal" role="dialog" aria-modal="true" aria-label="從資產庫選擇圖片">
      <div className="library-modal-content">
        <button type="button" className="lightbox-close" onClick={onClose}>
          ×
        </button>
        <h3>從資產庫選擇圖片</h3>

        {isLoading && items.length === 0 && <div className="empty-state compact">Loading...</div>}
        {error && <p className="hint error">{error}</p>}
        {!isLoading && !error && items.length === 0 && (
          <div className="empty-state compact">資產庫裡沒有圖片。</div>
        )}

        {items.length > 0 && (
          <div className="asset-grid">
            {items.map((asset) => (
              <article key={asset.asset_id} className="asset-card">
                <button
                  type="button"
                  className="asset-preview-button"
                  disabled={asset.status !== 'available'}
                  aria-label={`選擇圖片：${asset.filename}`}
                  onClick={() => onSelect(libraryAssetToImageAsset(asset))}
                >
                  <img src={resolveApiUrl(asset.content_url)} alt={asset.filename} />
                </button>
                <div className="asset-card-body">
                  <strong>{assetSourceLabel(asset.source)}</strong>
                  {asset.status !== 'available' && <span className="hint error">檔案遺失</span>}
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="library-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Previous
          </button>
          <span>
            Page {page} / {pageCount}
          </span>
          <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
