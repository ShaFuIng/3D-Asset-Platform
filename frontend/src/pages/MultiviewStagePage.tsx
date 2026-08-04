import { useEffect, useState } from 'react';
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
  openai: ServiceHealthState;
};

type MultiviewZoomState = {
  view: MultiviewName;
  previewImageId: string;
};

function getDefaultPreviewImageId(slot: { candidateImage?: { imageId: string } | null; currentImage?: { imageId: string } | null; versions: { image: { imageId: string }; available: boolean }[] }) {
  return (
    slot.candidateImage?.imageId ??
    slot.currentImage?.imageId ??
    [...slot.versions].reverse().find((version) => version.available)?.image.imageId
  );
}

// Stage 03 (multiview): generate Front/Left/Back, review each view
// independently, then confirm the multiview 3D job.
export function MultiviewStagePage({ comfy, openai }: MultiviewStagePageProps) {
  const navigate = useNavigate();
  const params = useParams();
  const {
    images,
    selectedImageId,
    multiviewByImageId,
    startMultiview,
    acceptView,
    setViewCandidate,
    regenerateView,
    multiviewEditDrafts,
    setMultiviewEditDraft,
    startModelJob,
  } = useWorkspace();
  const [zoomState, setZoomState] = useState<MultiviewZoomState>();
  // Lightbox-scoped error for the Set Candidate action only.
  const [candidateError, setCandidateError] = useState<string | null>(null);

  const imageId = params.imageId ?? selectedImageId ?? '';
  const selectedImage = imageId ? images.find((image) => image.image_id === imageId) : undefined;
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
  const isOpenAIAvailable = openai.status === 'configured';
  const comfyUnavailableReason =
    comfy.status === 'checking'
      ? 'ComfyUI 狀態檢查中。'
      : comfy.message ?? 'ComfyUI 目前不可用。';
  const openAIUnavailableReason =
    openai.status === 'checking'
      ? 'OpenAI 狀態檢查中。'
      : openai.status === 'not_configured'
        ? 'OpenAI API Key 尚未設定。'
        : openai.message ?? 'OpenAI 目前不可用。';
  const zoomSlot = zoomState && job ? job.views[zoomState.view] : null;
  const zoomPreviewVersion = zoomSlot?.versions.find(
    (version) => version.image.imageId === zoomState?.previewImageId,
  );
  const zoomPreviewIndex = zoomSlot && zoomPreviewVersion ? zoomSlot.versions.indexOf(zoomPreviewVersion) : -1;
  const isZoomActionPending = Boolean(
    zoomState &&
      workspace &&
      (workspace.pendingViewActions[zoomState.view] ||
        isPending(job?.status) ||
        isPending(job?.views[zoomState.view].status)),
  );

  function getDraft(view: MultiviewName) {
    return job ? (multiviewEditDrafts[`${job.jobId}:${view}`] ?? '') : '';
  }

  useEffect(() => {
    if (!zoomState || !job) {
      return;
    }
    const slot = job.views[zoomState.view];
    if (slot.versions.some((version) => version.image.imageId === zoomState.previewImageId)) {
      return;
    }
    const fallbackImageId = getDefaultPreviewImageId(slot);
    if (fallbackImageId) {
      setZoomState({ ...zoomState, previewImageId: fallbackImageId });
    } else {
      closeZoom();
    }
  }, [job, zoomState]);

  function closeZoom() {
    setCandidateError(null);
    setZoomState(undefined);
  }

  function openZoom(view: MultiviewName) {
    const slot = job?.views[view];
    if (!slot) {
      return;
    }
    const previewImageId = getDefaultPreviewImageId(slot);
    if (previewImageId) {
      setCandidateError(null);
      setZoomState({ view, previewImageId });
    }
  }

  function previewVersionAt(index: number) {
    if (!zoomState || !zoomSlot || index < 0 || index >= zoomSlot.versions.length) {
      return;
    }
    setZoomState({ ...zoomState, previewImageId: zoomSlot.versions[index].image.imageId });
  }

  async function handleSetCandidate(versionImageId: string) {
    if (!zoomState) {
      return;
    }
    setCandidateError(null);
    const result = await setViewCandidate(imageId, zoomState.view, versionImageId);
    if (result.ok) {
      setCandidateError(null);
      setZoomState((current) => (current ? { ...current, previewImageId: versionImageId } : current));
      return;
    }
    if (result.error) {
      setCandidateError(result.error);
    }
  }

  async function handleStartModelJob() {
    if (!canStartModel || isStartingModel) {
      return;
    }
    const started = await startModelJob(imageId);
    if (started && job) {
      navigate(`/jobs/multiview/${job.jobId}`);
    }
  }

  if (!params.imageId) {
    return selectedImageId ? <Navigate to={`/views/${selectedImageId}`} replace /> : <Navigate to="/reference" replace />;
  }

  if (!selectedImage) {
    return <Navigate to="/reference" replace />;
  }

  return (
    <StageShell
      current="views"
      pipeline="multiview"
      stepperImageId={imageId}
      eyebrow="MULTI-VIEW PIPELINE · VIEWS"
      title="生成並確認 Front / Left / Back"
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
              pendingAction={workspace?.pendingViewActions[view]}
              editDraft={getDraft(view)}
              isComfyAvailable={!isComfyDisconnected}
              comfyUnavailableReason={comfyUnavailableReason}
              isOpenAIAvailable={isOpenAIAvailable}
              openAIUnavailableReason={openAIUnavailableReason}
              onAccept={(target) => void acceptView(imageId, target)}
              onLocalReroll={(target) => void regenerateView(imageId, target, 'local_reroll')}
              onOpenAIEdit={(target) => void regenerateView(imageId, target, 'openai_edit', getDraft(target))}
              onEditDraftChange={(target, value) => {
                if (job) {
                  setMultiviewEditDraft(job.jobId, target, value);
                }
              }}
              onZoom={openZoom}
            />
          ))}
        </div>
      </div>

      {zoomState && zoomSlot && zoomPreviewVersion && (
        <ImageLightbox
          image={zoomPreviewVersion.image}
          versionControls={{
            versions: zoomSlot.versions,
            previewImageId: zoomState.previewImageId,
            isPending: isZoomActionPending,
            error: candidateError,
            onPreview: (versionImageId) => setZoomState({ ...zoomState, previewImageId: versionImageId }),
            onPrevious: () => previewVersionAt(zoomPreviewIndex - 1),
            onNext: () => previewVersionAt(zoomPreviewIndex + 1),
            onSetCandidate: (versionImageId) => void handleSetCandidate(versionImageId),
          }}
          onClose={closeZoom}
        />
      )}
    </StageShell>
  );
}
