import { resolveApiUrl } from '../api/client';
import type { ImageAsset, JobResponse } from '../types/api';
import { ModelViewer } from './ModelViewer';

type JobPanelProps = {
  selectedImage?: ImageAsset;
  job?: JobResponse;
  modelUrl?: string;
  isCreatingJob: boolean;
  isComfyDisconnected: boolean;
  error?: string;
  onCreateJob: () => void;
};

export function JobPanel({
  selectedImage,
  job,
  modelUrl,
  isCreatingJob,
  isComfyDisconnected,
  error,
  onCreateJob,
}: JobPanelProps) {
  const canCreateJob = Boolean(selectedImage) && !isCreatingJob && !isComfyDisconnected;

  return (
    <section className="panel workspace-panel model-panel">
      <div className="section-header">
        <h2>轉成 3D</h2>
        <span>{job ? job.status : '尚未建立 Job'}</span>
      </div>

      {selectedImage ? (
        <div className="selected-image">
          <img src={resolveApiUrl(selectedImage.url)} alt="Selected source preview" />
          <div>
            <span>選定 image_id</span>
            <code>{selectedImage.image_id}</code>
          </div>
        </div>
      ) : (
        <div className="empty-state compact">請先選擇一張圖片。</div>
      )}

      <button type="button" onClick={onCreateJob} disabled={!canCreateJob}>
        {isCreatingJob ? 'Creating Job...' : '建立 3D Job'}
      </button>

      {isComfyDisconnected && <p className="hint warning">ComfyUI 未連線，暫時無法建立 3D Job。</p>}
      {error && <p className="hint error">{error}</p>}

      {job && (
        <div className="job-details">
          <div>
            <span>job_id</span>
            <code>{job.job_id}</code>
          </div>
          <div>
            <span>status</span>
            <strong data-status={job.status}>{job.status}</strong>
          </div>
          <p>{job.message}</p>
        </div>
      )}

      <div className="model-preview">
        <ModelViewer src={modelUrl} />
      </div>

      {modelUrl && (
        <a className="download-link" href={modelUrl} download>
          下載 GLB
        </a>
      )}
    </section>
  );
}
