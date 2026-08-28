import { useEffect } from 'react';
import { resolveApiUrl } from '../api/client';
import type { MultiviewViewVersion } from '../types/api';
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
  versionControls?: {
    versions: MultiviewViewVersion[];
    previewImageId: string;
    isPending: boolean;
    error?: string | null;
    onPreview: (imageId: string) => void;
    onPrevious: () => void;
    onNext: () => void;
    onSetCandidate: (imageId: string) => void;
  };
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
  versionControls,
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

  const previewVersion = versionControls?.versions.find(
    (version) => version.image.imageId === versionControls.previewImageId,
  );
  const previewIndex =
    versionControls && previewVersion ? versionControls.versions.indexOf(previewVersion) : -1;
  const hasCandidate = Boolean(versionControls?.versions.some((version) => version.isCandidate));
  const isPreviewUnavailable = Boolean(
    previewVersion && (!previewVersion.available || previewVersion.state !== 'active'),
  );
  const isSetCandidateDisabled = Boolean(
    !previewVersion ||
      !versionControls ||
      versionControls.isPending ||
      !previewVersion.available ||
      previewVersion.state !== 'active' ||
      previewVersion.isCandidate ||
      (previewVersion.isCurrent && !hasCandidate),
  );
  const setCandidateLabel = !previewVersion
    ? '設為候選版本'
    : !previewVersion.available || previewVersion.state !== 'active'
      ? '版本不可用'
      : previewVersion.isCandidate
        ? '目前候選版本'
        : previewVersion.isCurrent && !hasCandidate
          ? '目前採用版本'
          : previewVersion.isCurrent
            ? '回到目前版本／清除候選'
            : '設為候選版本';

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
            {versionControls && previewVersion && (
              <div className="lightbox-version-header">
                <div>
                  <strong>
                    Version {previewIndex + 1} / {versionControls.versions.length}
                  </strong>
                  <span>{getStrategyLabel(previewVersion.strategy)}</span>
                </div>
                <div className="lightbox-version-badges">
                  {previewVersion.isCurrent && (
                    <span className="version-badge" data-kind="current">Current</span>
                  )}
                  {previewVersion.isCandidate && (
                    <span className="version-badge" data-kind="candidate">Candidate</span>
                  )}
                  {previewVersion.state === 'trash' && (
                    <span className="version-badge" data-kind="trash">Trash</span>
                  )}
                  {previewVersion.state === 'missing' && (
                    <span className="version-badge" data-kind="missing">Missing</span>
                  )}
                </div>
              </div>
            )}
            {isPreviewUnavailable ? (
              <div className="version-image-placeholder">版本圖片不可用</div>
            ) : (
              <img src={resolveApiUrl(image.url)} alt="放大檢視的圖片" />
            )}
            {versionControls && previewVersion && (
              <div className="lightbox-version-controls">
                <div className="lightbox-version-nav">
                  <button
                    type="button"
                    disabled={previewIndex <= 0}
                    aria-label="上一個版本"
                    onClick={versionControls.onPrevious}
                  >
                    上一個
                  </button>
                  <button
                    type="button"
                    disabled={previewIndex >= versionControls.versions.length - 1}
                    aria-label="下一個版本"
                    onClick={versionControls.onNext}
                  >
                    下一個
                  </button>
                </div>
                <div className="lightbox-version-strip">
                  {versionControls.versions.map((version, index) => (
                    <button
                      key={version.image.imageId}
                      type="button"
                      className="version-thumbnail"
                      data-active={version.image.imageId === versionControls.previewImageId}
                      onClick={() => versionControls.onPreview(version.image.imageId)}
                    >
                      {version.available && version.state === 'active' ? (
                        <img src={resolveApiUrl(version.image.url)} alt={`Version ${index + 1}`} />
                      ) : (
                        <span className="version-thumbnail-placeholder">不可用</span>
                      )}
                      <span>Version {index + 1}</span>
                      <span>{getStrategyLabel(version.strategy)}</span>
                      <span className="version-thumbnail-badges">
                        {version.isCurrent && (
                          <span className="version-badge" data-kind="current">Current</span>
                        )}
                        {version.isCandidate && (
                          <span className="version-badge" data-kind="candidate">Candidate</span>
                        )}
                        {version.state === 'trash' && (
                          <span className="version-badge" data-kind="trash">Trash</span>
                        )}
                        {version.state === 'missing' && (
                          <span className="version-badge" data-kind="missing">Missing</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="lightbox-set-candidate">
                  <button
                    type="button"
                    disabled={isSetCandidateDisabled}
                    onClick={() => versionControls.onSetCandidate(previewVersion.image.imageId)}
                  >
                    {versionControls.isPending ? '設定中...' : setCandidateLabel}
                  </button>
                  <p className="hint">設為候選後，仍需按接受候選才會正式採用。</p>
                  {versionControls.error && <p className="hint error">{versionControls.error}</p>}
                </div>
              </div>
            )}
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

function getStrategyLabel(strategy: MultiviewViewVersion['strategy']): string {
  if (strategy === 'initial') {
    return 'Initial';
  }
  if (strategy === 'local_reroll') {
    return 'Local Reroll';
  }
  if (strategy === 'openai_reroll') {
    return 'OpenAI Reroll';
  }
  return 'GPT Edit';
}
