import { NavLink } from 'react-router-dom';
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
        <h1>生成式 AI 3D 資產平台</h1>
        <nav className="app-nav" aria-label="主要頁面">
          <NavLink to="/" end>
            單圖轉 3D
          </NavLink>
          <NavLink to="/three-view">三視圖</NavLink>
        </nav>
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
