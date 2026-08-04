import { useState } from 'react';
import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';
import { ImageLightbox } from './ImageLightbox';

type ImageGalleryProps = {
  images: ImageAsset[];
  selectedImageId?: string;
  archivedImageIds: Record<string, true>;
  editingImageIds: Record<string, true>;
  imageEditErrors: Record<string, string>;
  editPromptByImageId: Record<string, string>;
  onSelect: (image: ImageAsset) => void;
  onArchive: (imageId: string) => void;
  onRestore: (imageId: string) => void;
  onEditPromptChange: (imageId: string, value: string) => void;
  onEdit: (sourceImageId: string, prompt: string) => Promise<ImageAsset | undefined>;
};

export function ImageGallery({
  images,
  selectedImageId,
  archivedImageIds,
  editingImageIds,
  imageEditErrors,
  editPromptByImageId,
  onSelect,
  onArchive,
  onRestore,
  onEditPromptChange,
  onEdit,
}: ImageGalleryProps) {
  // Lightbox open/close state lives here since this is where the trigger lives.
  const [lightboxImage, setLightboxImage] = useState<ImageAsset>();
  const [showArchived, setShowArchived] = useState(false);
  const visibleImages = images.filter((image) => !archivedImageIds[image.image_id]);
  const archivedImages = images.filter((image) => archivedImageIds[image.image_id]);

  function getImageLabel(image: ImageAsset): string {
    if (image.source === 'edited') {
      return '修改版本';
    }
    return image.source === 'generated' ? '生成圖片' : '上傳圖片';
  }

  function handleArchive(image: ImageAsset) {
    if (!window.confirm('將此圖片從工作區隱藏？既有生成工作不會被刪除。')) {
      return;
    }
    onArchive(image.image_id);
    if (lightboxImage?.image_id === image.image_id) {
      setLightboxImage(undefined);
    }
  }

  function openLightbox(image: ImageAsset) {
    setLightboxImage(image);
  }

  async function handleEditLightboxImage() {
    const sourceImageId = lightboxImage?.image_id;
    if (!sourceImageId) {
      return;
    }
    const nextImage = await onEdit(sourceImageId, editPromptByImageId[sourceImageId] ?? '');
    if (!nextImage) {
      return;
    }
    setLightboxImage((current) => (current?.image_id === sourceImageId ? nextImage : current));
  }

  return (
    <section className="panel workspace-panel">
      <div className="section-header">
        <h2>圖片</h2>
        <div className="gallery-header-actions">
          <span>{visibleImages.length ? `${visibleImages.length} 張圖片` : '尚無圖片'}</span>
          <button type="button" disabled={archivedImages.length === 0} onClick={() => setShowArchived((open) => !open)}>
            已隱藏（{archivedImages.length}）
          </button>
        </div>
      </div>

      {visibleImages.length === 0 ? (
        <div className="empty-state">從對話生成或上傳圖片後，圖片會出現在這裡。</div>
      ) : (
        <div className="gallery-grid">
          {visibleImages.map((image) => (
            <div key={image.image_id} className="image-card" data-selected={image.image_id === selectedImageId}>
              {editingImageIds[image.image_id] && (
                <div className="image-editing-overlay" role="status" aria-live="polite">
                  <span className="spinner" aria-hidden="true" />
                  <span>正在產生修改版本…</span>
                </div>
              )}
              <button type="button" className="image-card-select" onClick={() => onSelect(image)}>
                <img src={resolveApiUrl(image.url)} alt={`${image.source} image preview`} />
                <span>{getImageLabel(image)}</span>
                {image.image_id === selectedImageId && <span>目前 Reference</span>}
              </button>
              <button
                type="button"
                className="image-zoom-button"
                aria-label="放大檢視圖片"
                onClick={() => openLightbox(image)}
              >
                ⤢
              </button>
              <button
                type="button"
                className="image-archive-button"
                disabled={Boolean(editingImageIds[image.image_id])}
                onClick={() => handleArchive(image)}
              >
                從工作區隱藏
              </button>
            </div>
          ))}
        </div>
      )}

      {showArchived && archivedImages.length > 0 && (
        <div className="archived-gallery">
          <h3>已隱藏圖片</h3>
          <div className="gallery-grid">
            {archivedImages.map((image) => (
              <div key={image.image_id} className="image-card" data-archived="true">
                <div className="image-card-select">
                  <img src={resolveApiUrl(image.url)} alt={`${image.source} hidden preview`} />
                  <span>{getImageLabel(image)}</span>
                  <span>已隱藏</span>
                </div>
                <button type="button" onClick={() => onRestore(image.image_id)}>
                  恢復到工作區
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {lightboxImage && (
        <ImageLightbox
          key={lightboxImage.image_id}
          image={{
            url: lightboxImage.url,
            imageId: lightboxImage.image_id,
            filename: lightboxImage.filename,
            source: lightboxImage.source,
            parentImageId: lightboxImage.parentImageId,
          }}
          editControls={{
            prompt: editPromptByImageId[lightboxImage.image_id] ?? '',
            isEditing: Boolean(editingImageIds[lightboxImage.image_id]),
            error: imageEditErrors[lightboxImage.image_id],
            onPromptChange: (value) => onEditPromptChange(lightboxImage.image_id, value),
            onSubmit: () => void handleEditLightboxImage(),
          }}
          onClose={() => setLightboxImage(undefined)}
        />
      )}
    </section>
  );
}
