import { useMemo } from 'react';
import { resolveApiUrl } from '../api/client';
import { ModelViewer } from '../components/ModelViewer';
import { useWorkspace } from '../context/WorkspaceContext';
import type {
  ImageAsset,
  JobStatus,
  MultiviewName,
  ServiceHealthState,
} from '../types/api';

const VIEW_ORDER: MultiviewName[] = ['front', 'left', 'back'];

const VIEW_LABELS: Record<MultiviewName, string> = {
  front: 'Front',
  left: 'Left',
  back: 'Back',
};

function isPending(status?: JobStatus) {
  return status === 'queued' || status === 'running';
}

type MultiviewPanelProps = {
  selectedImage?: ImageAsset;
  comfy: ServiceHealthState;
};

export function MultiviewPanel({ selectedImage, comfy }: MultiviewPanelProps) {
  const {
    multiviewByImageId,
    startMultiview,
    acceptView,
    regenerateView,
    startModelJob,
    setMultiviewModelKind,
  } = useWorkspace();

  const imageId = selectedImage?.image_id;
  // Each image owns an isolated multiview workspace; selecting another image
  // never shows or touches this image's job state.
  const workspace = imageId ? multiviewByImageId[imageId] : undefined;
  const job = workspace?.job ?? null;
  const modelJob = workspace?.modelJob ?? null;
  const isStarting = workspace?.isStarting ?? false;
  const isStartingModel = workspace?.isStartingModel ?? false;
  const activeModelKind = workspace?.activeModelKind ?? 'textured';
  const error = workspace?.error ?? null;

  const hasCandidate = useMemo(
    () => Boolean(job && VIEW_ORDER.some((view) => job.views[view].candidateImage)),
    [job],
  );
  const allAccepted = useMemo(
    () => Boolean(job && VIEW_ORDER.every((view) => job.views[view].accepted && job.views[view].currentImage)),
    [job],
  );
  const canStartModel = Boolean(job && job.status === 'succeeded' && allAccepted && !hasCandidate);
  const geometryUrl = modelJob?.geometryModel.downloadUrl
    ? resolveApiUrl(modelJob.geometryModel.downloadUrl)
    : null;
  const texturedUrl = modelJob?.texturedModel.downloadUrl
    ? resolveApiUrl(modelJob.texturedModel.downloadUrl)
    : null;
  const activeModelUrl = activeModelKind === 'textured' ? texturedUrl || geometryUrl : geometryUrl || texturedUrl;
  const isComfyDisconnected = comfy.status !== 'connected';

  function handleStartMultiview() {
    if (!imageId || isComfyDisconnected) {
      return;
    }
    void startMultiview(imageId);
  }

  function handleAcceptView(view: MultiviewName) {
    if (imageId) {
      void acceptView(imageId, view);
    }
  }

  function handleRegenerateView(view: MultiviewName) {
    if (imageId) {
      void regenerateView(imageId, view);
    }
  }

  function handleStartModelJob() {
    if (!imageId || !canStartModel) {
      return;
    }
    void startModelJob(imageId);
  }

  return (
    <section className="mode-panel" aria-labelledby="three-view-title">
      <div className="page-intro">
        <p className="eyebrow">Multiview workspace</p>
        <h2 id="three-view-title">三視圖 3D 生成</h2>
        <p>Reference 會先生成 Front、Left、Back；三張視圖確認後，再送入多視角 3D Workflow。</p>
      </div>

      <div className="three-view-layout">
        <section className="panel three-view-chat">
          <div className="section-header">
            <h2>Reference</h2>
            <span>{job ? job.status : 'idle'}</span>
          </div>

          {selectedImage ? (
            <div className="selected-image">
              <img src={resolveApiUrl(selectedImage.url)} alt="Selected reference preview" />
              <div>
                <span>selected reference image_id</span>
                <code>{selectedImage.image_id}</code>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">請先從 Gallery 選擇一張 Reference 圖片。</div>
          )}

          <button
            type="button"
            disabled={
              !selectedImage ||
              isStarting ||
              isPending(job?.status) ||
              isPending(modelJob?.status) ||
              isComfyDisconnected
            }
            onClick={handleStartMultiview}
          >
            {isStarting || isPending(job?.status) ? '生成三視圖中...' : '生成 Front / Left / Back'}
          </button>
          {isComfyDisconnected && <p className="hint warning">ComfyUI 未連線，無法建立多視角工作。</p>}

          {job?.referenceImage && (
            <div className="selected-image">
              <img src={resolveApiUrl(job.referenceImage.url)} alt="Reference preview" />
              <div>
                <span>reference image_id</span>
                <code>{job.referenceImage.imageId}</code>
              </div>
            </div>
          )}

          {job && (
            <div className="job-details">
              <div>
                <span>job_id</span>
                <code>{job.jobId}</code>
              </div>
              <div>
                <span>status</span>
                <strong data-status={job.status}>{job.status}</strong>
              </div>
              <p>{job.message}</p>
            </div>
          )}

          {error && <p className="hint error">{error}</p>}
        </section>

        <section className="panel three-view-preview-panel">
          <div className="section-header">
            <h2>視圖確認</h2>
            <span>Front / Left / Back</span>
          </div>

          <div className="three-view-grid">
            {VIEW_ORDER.map((view) => {
              const slot = job?.views[view];
              const image = slot?.candidateImage ?? slot?.currentImage;
              return (
                <article className="view-slot" key={view}>
                  <div className="view-slot-header">
                    <strong>{VIEW_LABELS[view]}</strong>
                    <span>{slot?.status ?? 'idle'}</span>
                  </div>
                  {image ? (
                    <img className="view-slot-image" src={resolveApiUrl(image.url)} alt={`${view} view`} />
                  ) : (
                    <div className="view-placeholder">
                      {slot && isPending(slot.status) ? '生成中...' : '尚未生成'}
                    </div>
                  )}
                  {slot?.candidateImage && <p className="hint warning">Candidate 尚未接受</p>}
                  {slot?.currentImage && (
                    <code>{slot.currentImage.imageId}</code>
                  )}
                  {slot?.error && <p className="hint error">{slot.error}</p>}
                  <button
                    type="button"
                    disabled={!slot?.currentImage && !slot?.candidateImage}
                    onClick={() => handleAcceptView(view)}
                  >
                    {slot?.accepted && !slot?.candidateImage ? '已接受' : '接受此視圖'}
                  </button>
                  <button
                    type="button"
                    disabled={!job || isPending(job.status)}
                    onClick={() => handleRegenerateView(view)}
                  >
                    重新生成 Candidate
                  </button>
                </article>
              );
            })}
          </div>

          <button type="button" disabled={!canStartModel || isStartingModel} onClick={handleStartModelJob}>
            {isStartingModel || isPending(modelJob?.status) ? '建立 3D 中...' : '建立多視角 3D'}
          </button>
          {!allAccepted && job?.status === 'succeeded' && <p className="hint warning">請先接受三個視圖。</p>}
          {hasCandidate && <p className="hint warning">仍有 Candidate 尚未處理，暫不能建立 3D。</p>}
        </section>
      </div>

      <section className="panel workspace-panel model-panel">
        <div className="section-header">
          <h2>模型結果</h2>
          <span>{modelJob?.status ?? 'not started'}</span>
        </div>
        <div className="model-toggle" role="group" aria-label="Model result selector">
          <button
            type="button"
            data-selected={activeModelKind === 'geometry'}
            onClick={() => imageId && setMultiviewModelKind(imageId, 'geometry')}
          >
            Geometry
          </button>
          <button
            type="button"
            data-selected={activeModelKind === 'textured'}
            onClick={() => imageId && setMultiviewModelKind(imageId, 'textured')}
          >
            Textured
          </button>
        </div>
        {modelJob && (
          <div className="job-details">
            <div>
              <span>status</span>
              <strong data-status={modelJob.status}>{modelJob.status}</strong>
            </div>
            <p>{modelJob.message}</p>
          </div>
        )}
        <div className="model-preview">
          <ModelViewer src={activeModelUrl ?? undefined} />
        </div>
        <div className="model-downloads">
          <a className="download-link" href={geometryUrl ?? undefined} aria-disabled={!geometryUrl} download>
            下載 Geometry GLB
          </a>
          <a className="download-link" href={texturedUrl ?? undefined} aria-disabled={!texturedUrl} download>
            下載 Textured GLB
          </a>
        </div>
      </section>
    </section>
  );
}
