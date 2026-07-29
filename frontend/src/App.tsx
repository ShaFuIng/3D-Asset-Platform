import { useEffect, useState } from 'react';
import { ModelViewer } from './components/ModelViewer';

type ServiceStatus = 'checking' | 'connected' | 'disconnected';

type HealthState = {
  status: ServiceStatus;
  message?: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';
const sampleGlbUrl = '/sample.glb';

async function fetchHealth(path: string): Promise<HealthState> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`);
    const data = await response.json();

    if (!response.ok) {
      return { status: 'disconnected', message: data.detail ?? response.statusText };
    }

    return {
      status: data.status === 'connected' ? 'connected' : 'disconnected',
      message: data.message,
    };
  } catch (error) {
    return {
      status: 'disconnected',
      message: error instanceof Error ? error.message : 'Unknown connection error',
    };
  }
}

function StatusRow({ label, state }: { label: string; state: HealthState }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <strong data-status={state.status}>{state.status}</strong>
      {state.message && <small>{state.message}</small>}
    </div>
  );
}

export default function App() {
  const [backend, setBackend] = useState<HealthState>({ status: 'checking' });
  const [comfy, setComfy] = useState<HealthState>({ status: 'checking' });

  useEffect(() => {
    void fetchHealth('/api/health').then(setBackend);
    void fetchHealth('/api/comfy/health').then(setComfy);
  }, []);

  return (
    <main className="app">
      <section className="panel">
        <div>
          <p className="eyebrow">Phase 1 Environment Check</p>
          <h1>Generative AI Editable 3D Asset Platform</h1>
        </div>

        <div className="status-grid">
          <StatusRow label="Frontend" state={{ status: 'connected', message: 'Vite is running.' }} />
          <StatusRow label="Backend" state={backend} />
          <StatusRow label="ComfyUI" state={comfy} />
        </div>
      </section>

      <section className="preview-area">
        <div className="preview-header">
          <h2>GLB Preview</h2>
          <span>{sampleGlbUrl}</span>
        </div>
        <ModelViewer src={sampleGlbUrl} />
      </section>
    </main>
  );
}

