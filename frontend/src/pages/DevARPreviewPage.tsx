import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ARPreview,
  DEFAULT_CHARACTER_DEPTH,
  DEFAULT_POSITION_X,
  DEFAULT_POSITION_Y,
  DEFAULT_ROTATION_DEG,
  DEFAULT_SIZE,
} from '../components/ARPreview';
import { ARPlacementControls } from '../components/ARPlacementControls';

// Dev-only manual test page: /dev/ar-preview?modelUrl=<GLB URL>
// Renders ARPreview directly from a URL param, bypassing WorkspaceContext and
// the real generation pipeline entirely — just for eyeballing/calibrating the
// AR compositing result. Registered in App.tsx only behind
// import.meta.env.DEV, so this never ships in a production build. Owns the
// same placement state ARStudioPage owns and reuses the same
// ARPlacementControls component — layout here isn't important, this page
// only needs to be usable for tuning the DEFAULT_* constants.
export function DevARPreviewPage() {
  const [searchParams] = useSearchParams();
  const modelUrl = searchParams.get('modelUrl') ?? undefined;

  const [positionX, setPositionX] = useState(DEFAULT_POSITION_X);
  const [positionY, setPositionY] = useState(DEFAULT_POSITION_Y);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [rotationDeg, setRotationDeg] = useState(DEFAULT_ROTATION_DEG);
  const [characterDepth, setCharacterDepth] = useState(DEFAULT_CHARACTER_DEPTH);
  const [debugOcclusion, setDebugOcclusion] = useState(false);

  return (
    <main className="app">
      <section className="panel viewer-panel">
        <div className="section-header">
          <h2>Dev: AR Preview</h2>
          <span className="hint">/dev/ar-preview?modelUrl=&lt;GLB URL&gt;</span>
        </div>
        {!modelUrl && (
          <p className="hint warning">
            請在網址加上 ?modelUrl=&lt;GLB 網址&gt;，例如
            ?modelUrl=http://127.0.0.1:8000/api/3d/jobs/xxx/model
          </p>
        )}
        <div className="model-preview">
          <ARPreview
            modelUrl={modelUrl}
            positionX={positionX}
            positionY={positionY}
            size={size}
            rotationDeg={rotationDeg}
            characterDepth={characterDepth}
            debugOcclusion={debugOcclusion}
          />
        </div>
      </section>

      {modelUrl && (
        <section className="panel">
          <div className="section-header">
            <h2>校準</h2>
          </div>
          <ARPlacementControls
            positionX={positionX}
            onPositionXChange={setPositionX}
            positionY={positionY}
            onPositionYChange={setPositionY}
            size={size}
            onSizeChange={setSize}
            rotationDeg={rotationDeg}
            onRotationDegChange={setRotationDeg}
            characterDepth={characterDepth}
            onCharacterDepthChange={setCharacterDepth}
            debugOcclusion={debugOcclusion}
            onDebugOcclusionChange={setDebugOcclusion}
          />
        </section>
      )}
    </main>
  );
}
