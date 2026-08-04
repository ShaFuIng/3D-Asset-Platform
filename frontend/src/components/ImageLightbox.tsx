import { useEffect } from 'react';
import { resolveApiUrl } from '../api/client';

// Accepts a plain image descriptor so both gallery assets (ImageAsset) and
// multiview view images (MultiviewImageRef) can be zoomed.
export type LightboxImage = {
  url: string;
  imageId?: string;
  filename?: string;
};

type ImageLightboxProps = {
  image: LightboxImage;
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
            {(image.imageId || image.filename) && (
              <div className="job-details">
                {image.imageId && (
                  <div>
                    <span>image_id</span>
                    <code>{image.imageId}</code>
                  </div>
                )}
                {image.filename && (
                  <div>
                    <span>filename</span>
                    <code>{image.filename}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
