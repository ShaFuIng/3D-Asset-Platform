import { useState } from 'react';
import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';
import { ImageLightbox } from './ImageLightbox';

type ImageGalleryProps = {
  images: ImageAsset[];
  selectedImageId?: string;
  onSelect: (image: ImageAsset) => void;
};

export function ImageGallery({
  images,
  selectedImageId,
  onSelect,
}: ImageGalleryProps) {
  // Lightbox open/close state lives here since this is where the trigger lives.
  const [lightboxImage, setLightboxImage] = useState<ImageAsset>();

  return (
    <section className="panel workspace-panel">
      <div className="section-header">
        <h2>圖片</h2>
        <span>{images.length ? `${images.length} 張圖片` : '尚無圖片'}</span>
      </div>

      {images.length === 0 ? (
        <div className="empty-state">從對話生成或上傳圖片後，圖片會出現在這裡。</div>
      ) : (
        <div className="gallery-grid">
          {images.map((image) => (
            <div key={image.image_id} className="image-card" data-selected={image.image_id === selectedImageId}>
              <button type="button" className="image-card-select" onClick={() => onSelect(image)}>
                <img src={resolveApiUrl(image.url)} alt={`${image.source} image preview`} />
                <span>{image.source === 'generated' ? '生成圖片' : '上傳圖片'}</span>
                <code>{image.image_id}</code>
              </button>
              <button
                type="button"
                className="image-zoom-button"
                aria-label="放大檢視圖片"
                onClick={() => setLightboxImage(image)}
              >
                ⤢
              </button>
            </div>
          ))}
        </div>
      )}

      {lightboxImage && (
        <ImageLightbox
          key={lightboxImage.image_id}
          image={lightboxImage}
          onClose={() => setLightboxImage(undefined)}
        />
      )}
    </section>
  );
}
