import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getLibraryAssets, resolveApiUrl } from '../api/client';
import { useWorkspace } from '../context/WorkspaceContext';
import type { ServiceHealthState } from '../types/api';

type HomePageProps = {
  backend: ServiceHealthState;
  openai: ServiceHealthState;
  comfy: ServiceHealthState;
};

function statusLabel(state: ServiceHealthState): string {
  return state.message ? `${state.status} — ${state.message}` : state.status;
}

// Home Hub: entry point plus an overview of everything this session is
// tracking, with direct links back into the right pipeline stage.
export function HomePage({ backend, openai, comfy }: HomePageProps) {
  const { images, selectedImageId, singleJobsByImageId, multiviewByImageId, hasActiveJobs } =
    useWorkspace();
  const [libraryCounts, setLibraryCounts] = useState<{
    images: number;
    models: number;
    trash: number;
    isLoading: boolean;
    error?: string;
  }>({ images: 0, models: 0, trash: 0, isLoading: true });

  useEffect(() => {
    const controller = new AbortController();
    setLibraryCounts((current) => ({ ...current, isLoading: true, error: undefined }));
    void Promise.all([
      getLibraryAssets({ state: 'active', type: 'image', page_size: 1 }, controller.signal),
      getLibraryAssets({ state: 'active', type: 'model', page_size: 1 }, controller.signal),
      getLibraryAssets({ state: 'trash', page_size: 1 }, controller.signal),
    ])
      .then(([imageData, modelData, trashData]) => {
        setLibraryCounts({
          images: imageData.total,
          models: modelData.total,
          trash: trashData.total,
          isLoading: false,
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setLibraryCounts({
          images: 0,
          models: 0,
          trash: 0,
          isLoading: false,
          error: 'Asset Library unavailable.',
        });
      });
    return () => controller.abort();
  }, []);

  const selectedImage = images.find((image) => image.image_id === selectedImageId);

  const singleWork = Object.entries(singleJobsByImageId)
    .filter(([, entry]) => entry.job)
    .map(([imageId, entry]) => ({ imageId, entry, image: images.find((img) => img.image_id === imageId) }));

  const multiviewWork = Object.entries(multiviewByImageId)
    .filter(([, workspace]) => workspace.job)
    .map(([imageId, workspace]) => ({
      imageId,
      workspace,
      image: images.find((img) => img.image_id === imageId),
    }));

  const hasAnyWork = images.length > 0 || singleWork.length > 0 || multiviewWork.length > 0;

  return (
    <div className="home-page">
      <section className="home-hero">
        <p className="eyebrow">GPT IMAGE TO HUNYUAN3D</p>
        <h2>生成式 AI 3D 資產平台</h2>
        <p>從一張參考圖出發，選擇單圖直出或多視圖確認流程，生成可預覽、可下載的 3D 模型。</p>
        <div className="home-entry-row">
          <Link className="home-entry-card" to="/reference">
            <span className="home-entry-title">開始新資產</span>
            <span className="home-entry-sub">NEW ASSET · 生成或上傳 Reference Image</span>
          </Link>
          <Link className="home-entry-card" to="/video-upload">
            <span className="home-entry-title">上傳影片</span>
            <span className="home-entry-sub">VIDEO · 從影片擷取畫面</span>
          </Link>
        </div>
      </section>

      <section className="panel home-status-panel">
        <div className="section-header">
          <h2>服務狀態</h2>
          <span>SERVICES</span>
        </div>
        <div className="status-grid">
          <div className="status-row">
            <span>Backend</span>
            <strong data-status={backend.status}>{backend.status}</strong>
            <small>{statusLabel(backend)}</small>
          </div>
          <div className="status-row">
            <span>OpenAI</span>
            <strong data-status={openai.status}>{openai.status}</strong>
            <small>{statusLabel(openai)}</small>
          </div>
          <div className="status-row">
            <span>ComfyUI</span>
            <strong data-status={comfy.status}>{comfy.status}</strong>
            <small>{statusLabel(comfy)}</small>
          </div>
        </div>
      </section>

      <section className="panel home-library-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">ASSET LIBRARY</p>
            <h2>資產庫</h2>
          </div>
          <Link to="/library">開啟資產庫 →</Link>
        </div>
        {libraryCounts.isLoading ? (
          <p className="hint">Loading asset counts...</p>
        ) : libraryCounts.error ? (
          <p className="hint error">{libraryCounts.error}</p>
        ) : (
          <div className="library-count-grid">
            <div>
              <strong>{libraryCounts.images.toLocaleString()}</strong>
              <span>Images</span>
            </div>
            <div>
              <strong>{libraryCounts.models.toLocaleString()}</strong>
              <span>Models</span>
            </div>
            <div>
              <strong>{libraryCounts.trash.toLocaleString()}</strong>
              <span>Trash</span>
            </div>
          </div>
        )}
      </section>

      <section className="panel home-work-panel">
        <div className="section-header">
          <h2>目前工作階段</h2>
          <span>{hasActiveJobs ? '有工作進行中' : 'SESSION'}</span>
        </div>

        {!hasAnyWork && (
          <div className="empty-state compact">尚無工作階段。從「開始新資產」建立第一張 Reference Image。</div>
        )}

        {selectedImage && (
          <div className="home-work-card">
            <img src={resolveApiUrl(selectedImage.url)} alt="Current reference" />
            <div>
              <strong>目前 Reference（{selectedImage.source === 'generated' ? '生成' : '上傳'}）</strong>
              <p className="hint">已選擇一張參考圖，可直接選擇生成模式。</p>
            </div>
            <Link to="/mode">選擇模式 →</Link>
          </div>
        )}

        {singleWork.map(({ imageId, entry, image }) => (
          <div className="home-work-card" key={`single-${imageId}`}>
            {image && <img src={resolveApiUrl(image.url)} alt="Single-view reference" />}
            <div>
              <strong>
                Single-view 3D <span className="badge" data-kind={entry.job!.status}>{entry.job!.status}</span>
              </strong>
              <p className="hint">{entry.job!.message}</p>
            </div>
            {entry.job!.status === 'succeeded' && entry.modelUrl ? (
              <Link to={`/viewer/single/${entry.job!.job_id}`}>檢視模型 →</Link>
            ) : (
              <Link to={`/jobs/single/${entry.job!.job_id}`}>查看進度 →</Link>
            )}
          </div>
        ))}

        {multiviewWork.map(({ imageId, workspace, image }) => {
          const modelStatus = workspace.modelJob?.status;
          return (
            <div className="home-work-card" key={`multiview-${imageId}`}>
              {image && <img src={resolveApiUrl(image.url)} alt="Multiview reference" />}
              <div>
                <strong>
                  Multiview 3D{' '}
                  <span className="badge" data-kind={modelStatus ?? workspace.job!.status}>
                    {modelStatus ?? workspace.job!.status}
                  </span>
                </strong>
                <p className="hint">{workspace.modelJob?.message ?? workspace.job!.message}</p>
              </div>
              {modelStatus === 'succeeded' ? (
                <Link to={`/viewer/multiview/${workspace.job!.jobId}`}>檢視模型 →</Link>
              ) : modelStatus ? (
                <Link to={`/jobs/multiview/${workspace.job!.jobId}`}>查看進度 →</Link>
              ) : (
                <Link to={`/views/${imageId}`}>繼續視圖確認 →</Link>
              )}
            </div>
          );
        })}

        {hasAnyWork && (
          <p className="hint">工作階段狀態僅保存在記憶體；重新整理頁面將失去這些追蹤資訊（檔案仍保留在後端）。</p>
        )}
      </section>
    </div>
  );
}
