import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClientError, getLibraryAssets, resolveApiUrl } from '../api/client';
import { ARPreview } from '../components/ARPreview';
import type { LibraryAsset } from '../types/api';

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '無法取得模型清單。';
}

// Standalone tool, same shape as VideoFramePickerPage: not part of the
// reference/mode/views pipeline. Pick any already-generated model out of the
// asset library and preview it composited into the AR demo photo, without
// touching WorkspaceContext or stageNav's five-stage state machine.
export function ARStudioPage() {
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void getLibraryAssets(
      { type: 'model', state: 'active', sort: 'created_at_desc', page_size: 50 },
      controller.signal,
    )
      .then((data) => setItems(data.items))
      .catch((requestError) => {
        const message = getErrorMessage(requestError);
        if (message) {
          setError(message);
        }
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, []);

  const selectedAsset = items.find((item) => item.asset_id === selectedAssetId);
  const selectedModelUrl =
    selectedAsset && selectedAsset.status === 'available'
      ? resolveApiUrl(selectedAsset.content_url)
      : undefined;

  return (
    <div className="ar-studio-page">
      <Link className="back-button" to="/">
        ← 回到首頁
      </Link>

      <header className="stage-header">
        <p className="eyebrow">AR STUDIO</p>
        <h2>AR 預覽工作室</h2>
      </header>

      <div className="ar-studio-layout">
        <section className="panel ar-studio-list-panel">
          <div className="section-header">
            <h2>選擇模型</h2>
            <span>{items.length} 個模型</span>
          </div>
          <p className="hint">從資產庫選一個已生成的 3D 模型，右側會顯示 AR 合成預覽。</p>

          {error && (
            <div className="empty-state compact">
              <p className="hint error">{error}</p>
            </div>
          )}
          {isLoading && <div className="empty-state compact">Loading models...</div>}
          {!isLoading && !error && items.length === 0 && (
            <div className="empty-state">尚未有已生成完成的 3D 模型，請先完成一次生成流程。</div>
          )}
          {!isLoading && !error && items.length > 0 && (
            <div className="asset-grid">
              {items.map((asset) => (
                <article
                  key={asset.asset_id}
                  className="asset-card"
                  data-selected={asset.asset_id === selectedAssetId}
                >
                  <button
                    type="button"
                    className="asset-preview-button"
                    disabled={asset.status !== 'available'}
                    onClick={() => setSelectedAssetId(asset.asset_id)}
                  >
                    <div className="model-asset-icon">GLB</div>
                  </button>
                  <div className="asset-card-body">
                    <strong>{asset.filename}</strong>
                    <p className="hint">
                      {asset.pipeline ?? 'unknown'} · {asset.model_variant ?? 'unknown'}
                    </p>
                    <span className="badge" data-kind={asset.status === 'available' ? 'succeeded' : 'failed'}>
                      {asset.status}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel ar-studio-preview-panel">
          <div className="section-header">
            <h2>AR 預覽</h2>
            <span>{selectedAsset ? selectedAsset.filename : '尚未選擇模型'}</span>
          </div>
          {selectedModelUrl ? (
            <div className="model-preview">
              <ARPreview modelUrl={selectedModelUrl} controls />
            </div>
          ) : (
            <div className="empty-state">請先在左側選擇一個模型，這裡才會顯示 AR 預覽。</div>
          )}
        </section>
      </div>
    </div>
  );
}
