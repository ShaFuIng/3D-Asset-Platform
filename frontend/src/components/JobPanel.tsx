import { resolveApiUrl } from '../api/client';
import type { ImageAsset, JobResponse } from '../types/api';
import type { ViewGenerationState } from './ImageLightbox';
import { ModelViewer } from './ModelViewer';

// Job creation is triggered from ImageLightbox (see create3DJob call there),
// so this is shared state read by both. Owned by SingleImageWorkspace.
export type JobEntry = {
  job?: JobResponse;
  modelUrl?: string;
  isCreatingJob: boolean;
  error?: string;
};

type JobPanelProps = {
  selectedImage?: ImageAsset;
  viewState?: ViewGenerationState;
  jobEntry?: JobEntry;
};

export function JobPanel({ selectedImage, viewState, jobEntry }: JobPanelProps) {
  const job = jobEntry?.job;
  const modelUrl = jobEntry?.modelUrl;
  const hasGeneratedAllViews = viewState?.left === 'done' && viewState?.back === 'done';
  const statusLabel = job ? job.status : jobEntry?.isCreatingJob ? '建立中...' : '尚未建立 Job';

  return (
    <section className="panel workspace-panel model-panel">
      <div className="section-header">
        <h2>3D 工作區</h2>
        <span>{statusLabel}</span>
      </div>

      {selectedImage ? (
        <div className="selected-image">
          <img src={resolveApiUrl(selectedImage.url)} alt="Selected source preview" />
          <div>
            <span>選取的 image_id</span>
            <code>{selectedImage.image_id}</code>
          </div>
        </div>
      ) : (
        <div className="empty-state compact">請先選擇一張圖片。</div>
      )}

      {selectedImage && (
        <p className="hint">{hasGeneratedAllViews ? '已生成三視圖。' : '尚未生成三視圖。'}</p>
      )}

      {jobEntry?.error && <p className="hint error">{jobEntry.error}</p>}

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
