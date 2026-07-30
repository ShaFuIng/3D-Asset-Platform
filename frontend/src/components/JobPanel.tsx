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
        <h2>3D Job</h2>
        <span>{job ? job.status : 'No job created'}</span>
      </div>

      {selectedImage ? (
        <div className="selected-image">
          <img src={resolveApiUrl(selectedImage.url)} alt="Selected source preview" />
          <div>
            <span>Selected image_id</span>
            <code>{selectedImage.image_id}</code>
          </div>
        </div>
      ) : (
        <div className="empty-state compact">Select an image before creating a 3D job.</div>
      )}

      <button type="button" onClick={onCreateJob} disabled={!canCreateJob}>
        {isCreatingJob ? 'Creating Job...' : 'Create 3D Job'}
      </button>

      {isComfyDisconnected && <p className="hint warning">ComfyUI is disconnected. 3D jobs are disabled.</p>}
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
          Download GLB
        </a>
      )}
    </section>
  );
}

