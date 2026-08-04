import { Link } from 'react-router-dom';
import { useEffect, useState, type CSSProperties } from 'react';
import { getLibraryAssets } from '../api/client';
import { OrbitalDevice } from '../components/OrbitalDevice';
import { useCursorParallax } from '../hooks/useCursorParallax';
import { useWorkspace } from '../context/WorkspaceContext';
import { getStageNavItems, type StageNavState } from '../navigation/stageNav';
import type { ServiceHealthState } from '../types/api';

type HomePageProps = {
  backend: ServiceHealthState;
  openai: ServiceHealthState;
  comfy: ServiceHealthState;
};

const NAV_STATE_TEXT: Record<StageNavState, string> = {
  done: '已完成',
  current: '目前階段',
  available: '可前往',
  locked: '尚未解鎖',
  na: '不適用',
};

function staggerStyle(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

// Home Hub: industrial terminal main menu. Left rail = asset library +
// services, center = the orbital device as the primary entry, right rail =
// five-stage session navigation (rules shared with StageShell).
export function HomePage({ backend, openai, comfy }: HomePageProps) {
  const { images, selectedImageId, pipelineByImageId, singleJobsByImageId, multiviewByImageId, hasActiveJobs } =
    useWorkspace();
  const parallaxRef = useCursorParallax<HTMLDivElement>();
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
  const navItems = getStageNavItems({
    imageId: selectedImageId,
    pipelineByImageId,
    singleJobsByImageId,
    multiviewByImageId,
  });
  const hasAnyWork =
    images.length > 0 ||
    Object.values(singleJobsByImageId).some((entry) => entry.job) ||
    Object.values(multiviewByImageId).some((workspace) => workspace.job);

  const services: Array<{ label: string; state: ServiceHealthState }> = [
    { label: 'Backend', state: backend },
    { label: 'OpenAI', state: openai },
    { label: 'ComfyUI', state: comfy },
  ];

  return (
    <div className="console-home" ref={parallaxRef}>
      <span className="home-bg-word" aria-hidden="true">
        ASSET CONSOLE
      </span>

      <header className="home-head stagger" style={staggerStyle(0)}>
        <p className="eyebrow">GPT IMAGE TO HUNYUAN3D // GENERATION TERMINAL</p>
        <h2>生成式 AI 3D 資產平台</h2>
      </header>

      <div className="home-grid">
        <div className="home-col home-col-left">
          <section className="panel home-library-panel stagger" style={staggerStyle(1)}>
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

          <section className="panel home-video-picker-panel stagger" style={staggerStyle(2)}>
            <div className="section-header">
              <div>
                <p className="eyebrow">VIDEO FRAME PICKER</p>
                <h2>從影片擷取 Reference Image</h2>
              </div>
            </div>
            <p className="hint">
              選擇本機 MP4、MOV、WebM 等影片，利用時間軸挑選需要的畫面，將單張影格加入資產庫並設為 3D
              生成的 Reference。
            </p>
            <Link className="home-video-picker-link" to="/video-upload">
              開啟影片擷取 →
            </Link>
          </section>

          <section className="panel home-status-panel stagger" style={staggerStyle(3)}>
            <div className="section-header">
              <h2>服務狀態</h2>
              <span>SERVICES</span>
            </div>
            <div className="service-list">
              {services.map(({ label, state }) => (
                <div className="service-row" data-status={state.status} key={label}>
                  <span className="status-dot-light" aria-hidden="true" />
                  <span className="service-name">{label}</span>
                  <strong>{state.status}</strong>
                  {state.message && <small>{state.message}</small>}
                </div>
              ))}
            </div>
          </section>
        </div>

        <Link
          className="home-center home-center-entry stagger par-tilt"
          style={staggerStyle(3)}
          to="/reference"
          aria-label="進入資產工作區：前往 Reference 階段，保留目前工作階段狀態"
        >
          <OrbitalDevice />
          <span className="home-center-cta">
            <span className="home-center-cta-text">
              <span className="home-center-cta-sub">ASSET WORKSPACE // ENTER</span>
              <span className="home-center-cta-title">進入資產工作區</span>
            </span>
            <span className="home-center-cta-arrow" aria-hidden="true">
              →
            </span>
          </span>
        </Link>

        <div className="home-col home-col-right">
          <section className="panel session-nav-panel stagger" style={staggerStyle(4)}>
            <div className="section-header">
              <div>
                <p className="eyebrow">SESSION NAVIGATION</p>
                <h2>目前工作階段</h2>
              </div>
              <span>{hasActiveJobs ? 'ACTIVE' : 'STANDBY'}</span>
            </div>

            <div className="session-nav">
              {navItems.map((item) => {
                const inner = (
                  <>
                    <span className="session-nav-index">{String(item.index + 1).padStart(2, '0')}</span>
                    <span className="session-nav-text">
                      <strong>{item.label}</strong>
                      <small>{item.en}</small>
                    </span>
                    <span className="session-nav-state">{NAV_STATE_TEXT[item.state]}</span>
                    {item.note && <span className="session-nav-note">{item.note}</span>}
                  </>
                );
                return item.destination ? (
                  <Link className="session-nav-item" data-state={item.state} to={item.destination} key={item.id}>
                    {inner}
                  </Link>
                ) : (
                  <span className="session-nav-item" data-state={item.state} aria-disabled="true" key={item.id}>
                    {inner}
                  </span>
                );
              })}
            </div>

            {selectedImage && (
              <p className="hint">目前 Reference：{selectedImage.filename}</p>
            )}
            {hasAnyWork && (
              <p className="hint">工作階段狀態僅保存在記憶體；重新整理頁面將失去追蹤資訊（檔案仍保留在後端）。</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
