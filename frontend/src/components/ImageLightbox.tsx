import { useEffect, useState } from 'react';
import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';

type ImageLightboxProps = {
  image: ImageAsset;
  onClose: () => void;
};

type ThreeViewGenerationStatus = 'idle' | 'generating' | 'done';

// Placeholder view slots, mirrors the front/side/back layout in ThreeViewPage.tsx.
// Real three-view generation is not wired up yet; this is UI-only.
const THREE_VIEW_SLOTS = [
  { id: 'front', title: 'Front', description: '正面視圖' },
  { id: 'side', title: 'Side', description: '側面視圖' },
  { id: 'back', title: 'Back', description: '背面視圖' },
];

// Fake delay so the "generating" state is visible in the UI. No real API call here.
const FAKE_GENERATION_DELAY_MS = 1500;

export function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  const [status, setStatus] = useState<ThreeViewGenerationStatus>('idle');

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleGenerateThreeView() {
    if (status !== 'idle') {
      return;
    }
    setStatus('generating');
    window.setTimeout(() => setStatus('done'), FAKE_GENERATION_DELAY_MS);
  }

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div
        className="lightbox-content"
        role="dialog"
        aria-modal="true"
        aria-label="圖片放大檢視"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="關閉放大檢視">
          ✕
        </button>

        <div className={`lightbox-body${status === 'done' ? ' with-three-view' : ''}`}>
          <div className="lightbox-image-pane">
            <img src={resolveApiUrl(image.url)} alt="放大檢視的圖片" />
            <button
              type="button"
              className="lightbox-generate-button"
              onClick={handleGenerateThreeView}
              disabled={status !== 'idle'}
            >
              {status === 'generating' && '生成中...'}
              {status === 'done' && '三視圖已生成'}
              {status === 'idle' && '生成三視圖'}
            </button>
            {status === 'generating' && <p className="hint">正在模擬生成三視圖，請稍候...</p>}
          </div>

          {status === 'done' && (
            <div className="lightbox-three-view-pane">
              <div className="section-header">
                <h2>三視圖預覽</h2>
                <span>Front / Side / Back</span>
              </div>
              <div className="three-view-grid">
                {THREE_VIEW_SLOTS.map((slot) => (
                  <article className="view-slot" key={slot.id}>
                    <div className="view-slot-header">
                      <strong>{slot.title}</strong>
                      <span>{slot.description}</span>
                    </div>
                    <div className="view-placeholder">尚未接入生成流程</div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}