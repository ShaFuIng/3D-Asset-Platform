import '@google/model-viewer';
import { useState } from 'react';

type ModelViewerProps = {
  src?: string;
};

export function ModelViewer({ src }: ModelViewerProps) {
  const [isLoading, setIsLoading] = useState(Boolean(src));
  const [error, setError] = useState<string | null>(null);

  if (!src) {
    return (
      <div className="viewer-placeholder">
        No GLB model is available yet. A generated model will appear here.
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      {isLoading && <div className="viewer-overlay">Loading model...</div>}
      {error && <div className="viewer-error">{error}</div>}
      <model-viewer
        src={src}
        alt="Generated 3D asset preview"
        camera-controls
        auto-rotate
        exposure="1"
        shadow-intensity="1"
        touch-action="pan-y"
        onLoad={() => {
          setIsLoading(false);
          setError(null);
        }}
        onError={() => {
          setIsLoading(false);
          setError('Unable to load this GLB model.');
        }}
      />
    </div>
  );
}
