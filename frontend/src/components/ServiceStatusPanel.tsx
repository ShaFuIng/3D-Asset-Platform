import { Link } from 'react-router-dom';
import type { ServiceHealthState } from '../types/api';

type ServiceStatusPanelProps = {
  backend: ServiceHealthState;
  openai: ServiceHealthState;
  comfy: ServiceHealthState;
};

// Slim global bar: brand link back to Home plus compact service dots.
// Detailed status text lives on the Home page.
export function ServiceStatusPanel({ backend, openai, comfy }: ServiceStatusPanelProps) {
  return (
    <header className="app-header slim">
      <Link className="brand-mini" to="/">
        <span className="eyebrow">GPT Image to Hunyuan3D</span>
        <strong>3D 資產平台</strong>
      </Link>
      <div className="status-dots" aria-label="服務狀態">
        <StatusDot label="Backend" state={backend} />
        <StatusDot label="OpenAI" state={openai} />
        <StatusDot label="ComfyUI" state={comfy} />
      </div>
    </header>
  );
}

function StatusDot({ label, state }: { label: string; state: ServiceHealthState }) {
  return (
    <span className="status-dot" data-status={state.status} title={state.message ?? state.status}>
      <span className="status-dot-light" aria-hidden="true" />
      {label}
    </span>
  );
}
