import type { ServiceHealthState } from '../types/api';

type ServiceStatusPanelProps = {
  backend: ServiceHealthState;
  openai: ServiceHealthState;
  comfy: ServiceHealthState;
};

const frontendStatus: ServiceHealthState = {
  status: 'connected',
  message: 'Vite is running.',
};

export function ServiceStatusPanel({ backend, openai, comfy }: ServiceStatusPanelProps) {
  return (
    <section className="panel">
      <div>
        <p className="eyebrow">Generation Workspace</p>
        <h1>Generative AI Editable 3D Asset Platform</h1>
      </div>

      <div className="status-grid">
        <StatusRow label="Frontend" state={frontendStatus} />
        <StatusRow label="Backend" state={backend} />
        <StatusRow label="OpenAI" state={openai} />
        <StatusRow label="ComfyUI" state={comfy} />
      </div>
    </section>
  );
}

function StatusRow({ label, state }: { label: string; state: ServiceHealthState }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <strong data-status={state.status}>{state.status}</strong>
      {state.message && <small>{state.message}</small>}
    </div>
  );
}

