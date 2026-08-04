import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { resolveApiUrl } from '../api/client';
import { ImageLightbox } from '../components/ImageLightbox';
import { StageShell } from '../components/StageShell';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { ViewCard } from '../components/ViewCard';
import { useWorkspace } from '../context/WorkspaceContext';
import type { JobStatus, MultiviewName, ServiceHealthState } from '../types/api';

const VIEW_ORDER: MultiviewName[] = ['front', 'left', 'back'];

const VIEW_LABELS: Record<MultiviewName, string> = {
  front: 'Front',
  left: 'Left',
  back: 'Back',
};

function isPending(status?: JobStatus) {
  return status === 'queued' || status === 'running';
}

type MultiviewStagePageProps = {
  comfy: ServiceHealthState;
};

// Stage 03 (multiview): generate Front/Left/Back, review each view
// independently, then confirm the multiview 3D job.
export function MultiviewStagePage({ comfy }: MultiviewStagePageProps) {
  const navigate = useNavigate();
  const params = useParams();
  const {
    images,
    selectedImageId,
    multiviewByImageId,
    startMultiview,
    acceptView,
    regenerateView,
    startModelJob,
  } = useWorkspace();
  const [zoomUrl, setZoomUrl] = useState<string>();

  if (!params.imageId) {
    return selectedImageId ? <Navigate to={`/views/${selectedImageId}`} replace /> : <Navigate to="/reference" replace />;
  }

  const selectedImage = images.find((image) => image.image_id === params.imageId);
  if (!selectedImage) {
    return <Navigate to="/reference" replace />;
  }
  const imageId = params.imageId;
  const workspace = multiviewByImageId[imageId];
  const job = workspace?.job ?? null;
  const modelJob = workspace?.modelJob ?? null;
  const isStarting = workspace?.isStarting ?? false;
  const isStartingModel = workspace?.isStartingModel ?? false;
  const error = workspace?.error ?? null;

  const hasCandidate = Boolean(job && VIEW_ORDER.some((view) => job.views[view].candidateImage));
  const allAccepted = Boolean(
    job && VIEW_ORDER.every((view) => job.views[view].accepted && job.views[view].currentImage),
  );
  const canStartModel = Boolean(job && job.status === 'succeeded' && allAccepted && !hasCandidate);
  const missingViews = VIEW_ORDER.filter(
    (view) => !(job?.views[view].accepted && job.views[view].currentImage),
  );
  const isComfyDisconnected = comfy.status !== 'connected';

  async function handleStartModelJob() {
    if (!canStartModel || isStartingModel) {
      return;
    }
    const started = await startModelJob(imageId);
    if (started && job) {
      navigate(`/jobs/multiview/${job.jobId}`);
    }
  }

  return (
    <StageShell
      current="views"
      pipeline="multiview"
      stepperImageId={imageId}
      viewsPath={`/views/${imageId}`}
      eyebrow="MULTI-VIEW PIPELINE · VIEWS"
      title="生成並確認 Front / Left / Back"
      backTo="/mode"
      backLabel="模式"
      actions={
        <>
          <div className="action-bar-summary">
            {modelJob ? (
              <span className="hint">3D 模型工作狀態：{modelJob.status}</span>
            ) : canStartModel ? (
              <span>三張視圖皆已接受，可以建立 3D。</span>
            ) : job ? (
              <span className="hint">
                {hasCandidate
                  ? '仍有 Candidate 尚未處理，請先接受或等待後續功能。'
                  : `尚缺：${missingViews.map((view) => VIEW_LABELS[view]).join('、')} 未接受。`}
              </span>
            ) : (
              <span className="hint">請先生成 Front / Left / Back 三張視圖。</span>
            )}
          </div>
          {modelJob ? (
            <button
              type="button"
              className="primary-action"
              onClick={() => job && navigate(`/jobs/multiview/${job.jobId}`)}
            >
              查看 3D 生成進度 →
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              disabled={!canStartModel || isStartingModel}
              onClick={() => void handleStartModelJob()}
            >
              {isStartingModel ? '建立 3D 中…' : '建立多視角 3D'}
            </button>
          )}
        </>
      }
    >
      <div className="views-layout">
        <section className="panel views-reference">
          <div className="section-header">
            <h2>Reference</h2>
            <span>{job ? job.status : 'idle'}</span>
          </div>
          <img
            className="mode-reference-image"
            src={resolveApiUrl(selectedImage.url)}
            alt="Selected reference"
          />
          <button
            type="button"
            disabled={
              isStarting || isPending(job?.status) || isPending(modelJob?.status) || isComfyDisconnected
            }
            onClick={() => void startMultiview(imageId)}
          >
            {isStarting || isPending(job?.status) ? '生成三視圖中…' : '生成 Front / Left / Back'}
          </button>
          {isComfyDisconnected && <p className="hint warning">ComfyUI 未連線，無法建立多視角工作。</p>}
          {error && <p className="hint error">{error}</p>}
          {job && (
            <TechnicalDetails
              items={[
                ['image_id', imageId],
                ['job_id', job.jobId],
                ['prompt_id', job.promptId],
              ]}
            />
          )}
        </section>

        <div className="view-card-grid">
          {VIEW_ORDER.map((view) => (
            <ViewCard
              key={view}
              view={view}
              label={VIEW_LABELS[view]}
              slot={job?.views[view]}
              isAcceptPending={Boolean(workspace?.pendingViewActions[view])}
              onAccept={(target) => void acceptView(imageId, target)}
              onRegenerate={(target) => void regenerateView(imageId, target)}
              onZoom={setZoomUrl}
            />
          ))}
        </div>
      </div>

      {zoomUrl && <ImageLightbox image={{ url: zoomUrl }} onClose={() => setZoomUrl(undefined)} />}
    </StageShell>
  );
}
