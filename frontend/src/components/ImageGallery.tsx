import { useState } from 'react';
import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';
import {
  DEFAULT_VIEW_GENERATION_STATE,
  ImageLightbox,
  type ViewGenerationState,
  type ViewSlotId,
} from './ImageLightbox';

type ImageGalleryProps = {
  images: ImageAsset[];
  selectedImageId?: string;
  onSelect: (image: ImageAsset) => void;
};

// Fake delay so the "generating" state is visible in the UI. No real API call here.
const FAKE_VIEW_GENERATION_DELAY_MS = 1500;

export function ImageGallery({ images, selectedImageId, onSelect }: ImageGalleryProps) {
  // Lightbox open/close state lives here since this is where the trigger lives.
  const [lightboxImage, setLightboxImage] = useState<ImageAsset>();

  // Keyed by image_id and lifted above ImageLightbox (which unmounts on close)
  // so a previously generated side/back view survives closing and reopening
  // the lightbox for the same image.
  const [viewStatesByImageId, setViewStatesByImageId] = useState<Record<string, ViewGenerationState>>({});

  function handleGenerateSlot(imageId: string, slotId: ViewSlotId) {
    setViewStatesByImageId((current) => {
      const imageState = current[imageId] ?? DEFAULT_VIEW_GENERATION_STATE;
      if (imageState[slotId] === 'generating') {
        return current;
      }
      return { ...current, [imageId]: { ...imageState, [slotId]: 'generating' } };
    });

    window.setTimeout(() => {
      setViewStatesByImageId((current) => {
        const imageState = current[imageId] ?? DEFAULT_VIEW_GENERATION_STATE;
        return { ...current, [imageId]: { ...imageState, [slotId]: 'done' } };
      });
    }, FAKE_VIEW_GENERATION_DELAY_MS);
  }

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
          viewState={viewStatesByImageId[lightboxImage.image_id] ?? DEFAULT_VIEW_GENERATION_STATE}
          onGenerateSlot={(slotId) => handleGenerateSlot(lightboxImage.image_id, slotId)}
          onClose={() => setLightboxImage(undefined)}
        />
      )}
    </section>
  );
}
