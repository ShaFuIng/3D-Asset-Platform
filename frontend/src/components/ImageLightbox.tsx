import { useEffect, useState } from 'react';
import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';
import type { JobEntry } from './JobPanel';

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

// A selectable view for 3D job creation: the real front image, or one of the
// (still UI-only placeholder) generated views.
type SelectableViewSlot = 'front' | ViewSlotId;

const SLOT_LABELS: Record<SelectableViewSlot, string> = {
  front: '正面',
  side: 'Side',
  back: 'Back',
};

type ImageLightboxProps = {
  image: ImageAsset;
  // Lifted to SingleImageWorkspace so it survives closing/reopening the
  // lightbox for the same image; see SingleImageWorkspace.tsx.
  viewState: ViewGenerationState;
  onGenerateSlot: (slotId: ViewSlotId) => void;
  // Also owned by SingleImageWorkspace: JobPanel reads the same entry for
  // whichever image is selected in the gallery, so both stay in sync.
  jobEntry?: JobEntry;
  isComfyDisconnected: boolean;
  onCreateJob: (imageId: string) => void;
  onClose: () => void;
};

export function ImageLightbox({
  image,
  viewState,
  onGenerateSlot,
  jobEntry,
  isComfyDisconnected,
  onCreateJob,
  onClose,
}: ImageLightboxProps) {
  const [selectedViewSlot, setSelectedViewSlot] = useState<SelectableViewSlot>();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // A selected side/back view stops being valid once it's no longer 'done'
  // (e.g. the user regenerates it), so drop the stale selection.
  useEffect(() => {
    if (selectedViewSlot && selectedViewSlot !== 'front' && viewState[selectedViewSlot] !== 'done') {
      setSelectedViewSlot(undefined);
    }
  }, [selectedViewSlot, viewState]);

  function handleCreateJobClick() {
    if (!selectedViewSlot) {
      return;
    }
    // Side/Back views are still UI-only placeholders (see ViewGenerationState)
    // with no distinct generated image asset, so every slot currently
    // resolves to the same real image_id as the front view. Once per-view
    // image generation exists, resolve each slot to its own image_id here.
    onCreateJob(image.image_id);
  }

  const isCreatingJob = jobEntry?.isCreatingJob ?? false;
  const createJobButtonLabel = isCreatingJob
    ? '正在建立 3D Job...'
    : selectedViewSlot
      ? `使用${SLOT_LABELS[selectedViewSlot]}視圖建立 3D Job`
      : '請先選取一張視圖';

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
            <button
              type="button"
              className="lightbox-view-option"
              data-selected={selectedViewSlot === 'front'}
              onClick={() => setSelectedViewSlot('front')}
            >
              <img src={resolveApiUrl(image.url)} alt="放大檢視的圖片" />
              <span className="lightbox-view-select-badge">
                {selectedViewSlot === 'front' ? '✓ 已選取' : '選取此視圖'}
              </span>
            </button>
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
                const isDone = slotStatus === 'done';
                return (
                  <article className="view-slot" key={slot.id}>
                    <div className="view-slot-header">
                      <strong>{slot.title}</strong>
                      <span>{slot.description}</span>
                    </div>
                    <button
                      type="button"
                      className="lightbox-view-option"
                      data-selected={selectedViewSlot === slot.id}
                      disabled={!isDone}
                      onClick={() => setSelectedViewSlot(slot.id)}
                    >
                      <div className="view-placeholder">
                        {slotStatus === 'generating' && '生成中...'}
                        {slotStatus === 'done' && '視圖已生成（示意內容）'}
                        {slotStatus === 'idle' && '尚未生成'}
                      </div>
                      <span className="lightbox-view-select-badge">
                        {selectedViewSlot === slot.id ? '✓ 已選取' : isDone ? '選取此視圖' : '尚未生成，無法選取'}
                      </span>
                    </button>
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
          </div>
        </div>

        <div className="lightbox-create-job-row">
          <button
            type="button"
            className="lightbox-create-job-button"
            onClick={handleCreateJobClick}
            disabled={!selectedViewSlot || isComfyDisconnected || isCreatingJob}
          >
            {createJobButtonLabel}
          </button>
          {isComfyDisconnected && <p className="hint warning">ComfyUI 未連線，因此無法建立 3D Job。</p>}
          {jobEntry?.error && <p className="hint error">{jobEntry.error}</p>}
        </div>
      </div>
    </div>
  );
}