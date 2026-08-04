import { useEffect } from 'react';
import { resolveApiUrl } from '../api/client';
import { TechnicalDetails } from './TechnicalDetails';

// Accepts a plain image descriptor so both gallery assets (ImageAsset) and
// multiview view images (MultiviewImageRef) can be zoomed.
export type LightboxImage = {
  url: string;
  imageId?: string;
  filename?: string;
  source?: string;
  parentImageId?: string;
  technicalItems?: Array<[label: string, value: string | null | undefined]>;
};

type ImageLightboxProps = {
  image: LightboxImage;
  editControls?: {
    prompt: string;
    isEditing: boolean;
    error?: string;
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
  };
  onClose: () => void;
};

export function ImageLightbox({
  image,
  editControls,
  onClose,
}: ImageLightboxProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
            <TechnicalDetails
              items={
                image.technicalItems ?? [
                  ['image_id', image.imageId],
                  ['filename', image.filename],
                  ['source', image.source],
                  ['parent_image_id', image.parentImageId],
                ]
              }
            />
            {editControls && (
              <form
                className="lightbox-edit-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  editControls.onSubmit();
                }}
              >
                <div>
                  <h3>調整此圖片</h3>
                  <p className="hint">將以目前圖片建立新版本，原圖會保留。</p>
                </div>
                <label className="sr-only" htmlFor="lightbox-edit-prompt">
                  圖片修改提示詞
                </label>
                <textarea
                  id="lightbox-edit-prompt"
                  value={editControls.prompt}
                  onChange={(event) => editControls.onPromptChange(event.target.value)}
                  placeholder="例如：將服裝改成黑色，保留人物姿勢與其他細節"
                  disabled={editControls.isEditing}
                  rows={3}
                />
                {editControls.error && <p className="hint error">{editControls.error}</p>}
                <button type="submit" disabled={editControls.isEditing || !editControls.prompt.trim()}>
                  {editControls.isEditing ? '正在產生修改版本…' : '產生修改版本'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
