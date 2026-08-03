import { useEffect, useState } from 'react';
import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';

// The source image itself already counts as the "front" view of the three-view
// set, so only these 2 extra views need to be generated here.
export type ViewSlotId = 'side' | 'back';
export type ViewSlotStatus = 'idle' | 'generating' | 'done';
export type ViewGenerationState = Record<ViewSlotId, ViewSlotStatus>;

export const DEFAULT_VIEW_GENERATION_STATE: ViewGenerationState = {
  side: 'idle',
  back: 'idle',
};

// Placeholder view slots, mirrors the slot styling in ThreeViewPage.tsx.
// Real three-view generation is not wired up yet; this is UI-only.
const VIEW_SLOTS: Array<{ id: ViewSlotId; title: string; description: string }> = [
  { id: 'side', title: 'Side', description: '側面視圖' },
  { id: 'back', title: 'Back', description: '背面視圖' },
];

type ImageLightboxProps = {
  image: ImageAsset;
  // Lifted to the parent (ImageGallery) so it survives closing/reopening
  // the lightbox for the same image; see ImageGallery.tsx.
  viewState: ViewGenerationState;
  onGenerateSlot: (slotId: ViewSlotId) => void;
  onClose: () => void;
};

export function ImageLightbox({ image, viewState, onGenerateSlot, onClose }: ImageLightboxProps) {
  // Local-only: just a transient UI notice, doesn't need to survive close/reopen.
  const [showJobStubNotice, setShowJobStubNotice] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const allViewsGenerated = VIEW_SLOTS.every((slot) => viewState[slot.id] === 'done');

  function handleCreateJobFromViews() {
    setShowJobStubNotice(true);
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

        <div className="lightbox-body">
          <div className="lightbox-image-pane">
            <img src={resolveApiUrl(image.url)} alt="放大檢視的圖片" />
            <p className="hint">此圖為三視圖中的正面視圖（Front）。</p>
          </div>

          <div className="lightbox-views-pane">
            <div className="section-header">
              <h2>其他視圖</h2>
              <span>Side / Back</span>
            </div>

            <div className="lightbox-view-grid">
              {VIEW_SLOTS.map((slot) => {
                const slotStatus = viewState[slot.id];
                return (
                  <article className="view-slot" key={slot.id}>
                    <div className="view-slot-header">
                      <strong>{slot.title}</strong>
                      <span>{slot.description}</span>
                    </div>
                    <div className="view-placeholder">
                      {slotStatus === 'generating' && '生成中...'}
                      {slotStatus === 'done' && '視圖已生成（示意內容）'}
                      {slotStatus === 'idle' && '尚未生成'}
                    </div>
                    <button
                      type="button"
                      onClick={() => onGenerateSlot(slot.id)}
                      disabled={slotStatus === 'generating'}
                    >
                      {slotStatus === 'generating' && '生成中...'}
                      {slotStatus === 'done' && '重新生成'}
                      {slotStatus === 'idle' && '生成'}
                    </button>
                  </article>
                );
              })}
            </div>

            {/*
              Stub entry point only. The backend's POST /api/3d/jobs (see
              create3DJob in api/client.ts) currently only accepts a single
              image_id, so there is no multi-image job API to call yet.
              Once one exists, wire this the same way JobPanel wires
              onCreateJob to create3DJob instead of showing this notice.
            */}
            <button type="button" onClick={handleCreateJobFromViews} disabled={!allViewsGenerated}>
              使用三視圖建立 3D Job
            </button>
            {!allViewsGenerated && (
              <p className="hint">需要先生成 Side、Back 視圖，才能使用三視圖建立 Job。</p>
            )}
            {showJobStubNotice && (
              <p className="hint warning">
                多圖建立 3D Job 尚未串接後端，這裡先保留互動入口，實際生成邏輯留待後續開發。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}