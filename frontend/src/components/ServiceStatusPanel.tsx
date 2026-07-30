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
    <header className="app-header">
      <div className="brand-block">
        <p className="eyebrow">GPT Image to Hunyuan3D</p>
        <h1>聊天配 3D 生成工具</h1>
      </div>

      <div className="status-grid">
        <StatusRow label="Frontend" state={frontendStatus} />
        <StatusRow label="Backend" state={backend} />
        <StatusRow label="OpenAI" state={openai} />
        <StatusRow label="ComfyUI" state={comfy} />
      </div>
    </header>
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
