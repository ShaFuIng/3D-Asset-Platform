import { resolveApiUrl } from '../api/client';
import type { ImageAsset } from '../types/api';

type ImageGalleryProps = {
  images: ImageAsset[];
  selectedImageId?: string;
  onSelect: (image: ImageAsset) => void;
};

export function ImageGallery({ images, selectedImageId, onSelect }: ImageGalleryProps) {
  return (
    <section className="panel workspace-panel">
      <div className="section-header">
        <h2>生成圖片</h2>
        <span>{images.length ? `${images.length} 張圖片` : '尚無圖片'}</span>
      </div>

      {images.length === 0 ? (
        <div className="empty-state">對話生成或上傳的圖片會出現在這裡。</div>
      ) : (
        <div className="gallery-grid">
          {images.map((image) => (
            <button
              key={image.image_id}
              type="button"
              className="image-card"
              data-selected={image.image_id === selectedImageId}
              onClick={() => onSelect(image)}
            >
              <img src={resolveApiUrl(image.url)} alt={`${image.source} image preview`} />
              <span>{image.source === 'generated' ? '生成圖片' : '上傳圖片'}</span>
              <code>{image.image_id}</code>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
