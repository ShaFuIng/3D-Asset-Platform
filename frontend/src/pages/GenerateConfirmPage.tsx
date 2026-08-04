import { Navigate, useNavigate, Link } from 'react-router-dom';
import { resolveApiUrl } from '../api/client';
import { StageShell } from '../components/StageShell';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { useWorkspace } from '../context/WorkspaceContext';
import type { ServiceHealthState } from '../types/api';

type GenerateConfirmPageProps = {
  comfy: ServiceHealthState;
};

// Stage 03 (single-view): explicit confirmation before any GPU work starts.
// The job is created only when the user presses the generate button.
export function GenerateConfirmPage({ comfy }: GenerateConfirmPageProps) {
  const navigate = useNavigate();
  const { images, selectedImageId, pipelineByImageId, singleJobsByImageId, createSingleJob } =
    useWorkspace();

  const selectedImage = images.find((image) => image.image_id === selectedImageId);
  if (!selectedImage) {
    return <Navigate to="/reference" replace />;
  }
  const imageId = selectedImage.image_id;
  if (pipelineByImageId[imageId] !== 'single') {
    return <Navigate to="/mode" replace />;
  }

  const entry = singleJobsByImageId[imageId];
  const existingJob = entry?.job;
  const isComfyDisconnected = comfy.status !== 'connected';
  const isFailed = existingJob?.status === 'failed';
  const isSucceeded = existingJob?.status === 'succeeded';
  const isBusy = Boolean(
    entry?.isCreatingJob || existingJob?.status === 'queued' || existingJob?.status === 'running',
  );

  async function handleGenerate() {
    if (isComfyDisconnected || isBusy) {
      return;
    }
    const jobId = await createSingleJob(imageId);
    if (jobId) {
      navigate(`/jobs/single/${jobId}`, { replace: true });
    }
  }

  return (
    <StageShell
      current="generate"
      pipeline="single"
      eyebrow="SINGLE-VIEW PIPELINE · GENERATE"
      title="確認生成 3D"
      backTo="/mode"
      backLabel="模式"
    >
      <div className="confirm-layout">
        <section className="panel">
          <div className="section-header">
            <h2>Reference</h2>
            <span>SINGLE-VIEW</span>
          </div>
          <img
            className="mode-reference-image"
            src={resolveApiUrl(selectedImage.url)}
            alt="Selected reference"
          />
          <TechnicalDetails items={[['image_id', imageId]]} />
        </section>

        <section className="panel confirm-panel">
          <div className="section-header">
            <h2>生成確認</h2>
            <span>{existingJob ? existingJob.status : 'ready'}</span>
          </div>

          <p>將使用這張 Reference Image 建立單圖 3D 生成工作。生成需要較長時間與運算資源，按下「開始生成 3D」後才會送出。</p>

          {isComfyDisconnected && <p className="hint warning">ComfyUI 未連線，目前無法建立 3D 工作。</p>}
          {entry?.error && <p className="hint error">{entry.error}</p>}

          {existingJob && !isFailed ? (
            <div className="confirm-existing">
              <p className="hint">這張圖片已經有 3D 生成工作（狀態：{existingJob.status}）。</p>
              {isSucceeded && entry?.modelUrl ? (
                <Link className="primary-action-link" to={`/viewer/single/${existingJob.job_id}`}>
                  檢視 3D 模型 →
                </Link>
              ) : (
                <Link className="primary-action-link" to={`/jobs/single/${existingJob.job_id}`}>
                  查看現有工作進度 →
                </Link>
              )}
            </div>
          ) : (
            <>
              {isFailed && <p className="hint error">上一個 3D 生成工作失敗，可手動重新嘗試。</p>}
              <button
                type="button"
                className="primary-action"
                disabled={isComfyDisconnected || isBusy}
                onClick={() => void handleGenerate()}
              >
                {entry?.isCreatingJob ? '正在建立 3D Job…' : isFailed ? '重新嘗試生成 3D' : '開始生成 3D'}
              </button>
            </>
          )}
        </section>
      </div>
    </StageShell>
  );
}
