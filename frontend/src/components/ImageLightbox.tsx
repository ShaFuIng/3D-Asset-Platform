import { useEffect } from 'react';
import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';

type ImageLightboxProps = {
  image: ImageAsset;
  onClose: () => void;
};

export function ImageLightbox({
  image,
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
            <div className="job-details">
              <div>
                <span>image_id</span>
                <code>{image.image_id}</code>
              </div>
              <div>
                <span>filename</span>
                <code>{image.filename}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
