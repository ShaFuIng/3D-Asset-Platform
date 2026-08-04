import { useEffect, useMemo, useState } from 'react';
import {
  acceptMultiviewView,
  ApiClientError,
  createMultiviewJob,
  createMultiviewModelJob,
  getMultiviewJob,
  getMultiviewModelJob,
  regenerateMultiviewView,
  resolveApiUrl,
  uploadImage,
} from '../api/client';
import { ModelViewer } from '../components/ModelViewer';
import type {
  JobStatus,
  MultiviewJobResponse,
  MultiviewModelJobResponse,
  MultiviewName,
} from '../types/api';

const VIEW_ORDER: MultiviewName[] = ['front', 'left', 'back'];

const VIEW_LABELS: Record<MultiviewName, string> = {
  front: 'Front',
  left: 'Left',
  back: 'Back',
};

type ModelKind = 'geometry' | 'textured';

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '操作失敗。';
}

function isPending(status?: JobStatus) {
  return status === 'queued' || status === 'running';
}

export function ThreeViewPage() {
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [job, setJob] = useState<MultiviewJobResponse | null>(null);
  const [modelJob, setModelJob] = useState<MultiviewModelJobResponse | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStartingModel, setIsStartingModel] = useState(false);
  const [activeModelKind, setActiveModelKind] = useState<ModelKind>('textured');
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!job || !isPending(job.status)) {
      return;
    }
    const controller = new AbortController();
    const timerId = window.setInterval(() => {
      void getMultiviewJob(job.jobId, controller.signal)
        .then(setJob)
        .catch((nextError) => {
          const message = getErrorMessage(nextError);
          if (message) setError(message);
        });
    }, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timerId);
    };
  }, [job?.jobId, job?.status]);

  useEffect(() => {
    if (!job || !modelJob || !isPending(modelJob.status)) {
      return;
    }
    const controller = new AbortController();
    const timerId = window.setInterval(() => {
      void getMultiviewModelJob(job.jobId, controller.signal)
        .then((nextModelJob) => {
          setModelJob(nextModelJob);
          if (nextModelJob.texturedModel.available) {
            setActiveModelKind('textured');
          } else if (nextModelJob.geometryModel.available) {
            setActiveModelKind('geometry');
          }
        })
        .catch((nextError) => {
          const message = getErrorMessage(nextError);
          if (message) setError(message);
        });
    }, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timerId);
    };
  }, [job?.jobId, modelJob?.status]);

  async function handleStartMultiview() {
    if (!referenceFile || isStarting) {
      return;
    }
    setIsStarting(true);
    setError(null);
    setJob(null);
    setModelJob(null);
    try {
      const uploaded = await uploadImage(referenceFile);
      const created = await createMultiviewJob(uploaded.image_id);
      const nextJob = await getMultiviewJob(created.jobId);
      setJob(nextJob);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsStarting(false);
    }
  }

  async function handleAcceptView(view: MultiviewName) {
    if (!job) {
      return;
    }
    setError(null);
    try {
      setJob(await acceptMultiviewView(job.jobId, view));
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    }
  }

  async function handleRegenerateView(view: MultiviewName) {
    if (!job) {
      return;
    }
    setError(null);
    try {
      setJob(await regenerateMultiviewView(job.jobId, view));
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    }
  }

  async function handleStartModelJob() {
    if (!job || !canStartModel || isStartingModel) {
      return;
    }
    setIsStartingModel(true);
    setError(null);
    try {
      setModelJob(await createMultiviewModelJob(job.jobId));
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsStartingModel(false);
    }
  }

  return (
    <section className="three-view-page" aria-labelledby="three-view-title">
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

          <label className="upload-control">
            選擇 Reference 圖片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={isStarting || isPending(job?.status)}
              onChange={(event) => setReferenceFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {referenceFile && <p className="hint">{referenceFile.name}</p>}
          <button type="button" disabled={!referenceFile || isStarting || isPending(job?.status)} onClick={handleStartMultiview}>
            {isStarting || isPending(job?.status) ? '生成三視圖中...' : '生成 Front / Left / Back'}
          </button>

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
          <button type="button" data-selected={activeModelKind === 'geometry'} onClick={() => setActiveModelKind('geometry')}>
            Geometry
          </button>
          <button type="button" data-selected={activeModelKind === 'textured'} onClick={() => setActiveModelKind('textured')}>
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
