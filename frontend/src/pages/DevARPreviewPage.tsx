import { useSearchParams } from 'react-router-dom';
import { ARPreview } from '../components/ARPreview';

// Dev-only manual test page: /dev/ar-preview?modelUrl=<GLB URL>
// Renders ARPreview directly from a URL param, bypassing WorkspaceContext and
// the real generation pipeline entirely — just for eyeballing/sharing the AR
// compositing result. Registered in App.tsx only behind
// import.meta.env.DEV, so this never ships in a production build.
export function DevARPreviewPage() {
  const [searchParams] = useSearchParams();
  const modelUrl = searchParams.get('modelUrl') ?? undefined;

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
          <ARPreview modelUrl={modelUrl} controls debugOcclusion />
        </div>
      </section>
    </main>
  );
}
