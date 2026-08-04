import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { resolveApiUrl } from '../api/client';
import { StageShell } from '../components/StageShell';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { useWorkspace } from '../context/WorkspaceContext';
import { findRoutedJob, parsePipeline } from './routedJob';

const STATUS_TEXT: Record<string, string> = {
  queued: '排隊中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失敗',
};

// Stage 04: job progress for both pipelines. The job identity comes from the
// URL; if it is unknown to this session (e.g. after refresh), show recovery
// guidance instead of guessing.
export function JobProgressPage() {
  const params = useParams();
  const pipeline = parsePipeline(params.pipeline);
  const jobId = params.jobId;
  const { images, singleJobsByImageId, multiviewByImageId, refreshJobStatus } = useWorkspace();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();

  const routed =
    pipeline && jobId
      ? findRoutedJob({ pipeline, jobId, images, singleJobsByImageId, multiviewByImageId })
      : null;

  if (!pipeline || !jobId) {
    return <MissingJob reason="路由參數無效。" />;
  }
  if (!routed) {
    return (
      <MissingJob reason="這個生成工作不存在於目前的工作階段。頁面可能經過重新整理，記憶體中的追蹤資訊已重置（已生成的檔案仍保留在後端）。" />
    );
  }

  async function handleRefresh() {
    if (!pipeline || !jobId) {
      return;
    }
    setIsRefreshing(true);
    setRefreshError(undefined);
    try {
      await refreshJobStatus(pipeline, jobId);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : '重新整理狀態失敗。');
    } finally {
      setIsRefreshing(false);
    }
  }

  const viewsPath = routed.pipeline === 'multiview' ? `/views/${routed.imageId}` : undefined;
  const viewerPath = `/viewer/${routed.pipeline}/${jobId}`;

  const status = routed.pipeline === 'single' ? routed.entry.job?.status : routed.workspace.modelJob?.status;
  const message = routed.pipeline === 'single' ? routed.entry.job?.message : routed.workspace.modelJob?.message;
  const error =
    routed.pipeline === 'single' ? routed.entry.error ?? undefined : routed.workspace.error ?? undefined;
  const isDone = status === 'succeeded';
  const isFailed = status === 'failed';

  return (
      <StageShell
        current="generate"
        pipeline={routed.pipeline}
        stepperImageId={routed.imageId}
      eyebrow={`${routed.pipeline === 'single' ? 'SINGLE-VIEW' : 'MULTI-VIEW'} PIPELINE · GENERATE`}
      title="3D 生成進度"
      actions={
        <>
          <div className="action-bar-summary">
            {isDone ? (
              <span>模型已生成完成。</span>
            ) : isFailed ? (
              <span className="hint error">生成失敗，可返回上一階段重新嘗試。</span>
            ) : (
              <span className="hint">生成需要數分鐘，狀態會自動更新；也可以離開此頁，從首頁隨時回來。</span>
            )}
          </div>
          {isDone ? (
            <Link className="primary-action-link" to={viewerPath}>
              進入檢視工作區 →
            </Link>
          ) : (
            <button type="button" disabled={isRefreshing} onClick={() => void handleRefresh()}>
              {isRefreshing ? '重新整理中…' : '重新整理狀態'}
            </button>
          )}
        </>
      }
    >
      <div className="confirm-layout">
        {routed.image && (
          <section className="panel">
            <div className="section-header">
              <h2>Reference</h2>
              <span>{routed.pipeline === 'single' ? 'SINGLE-VIEW' : 'MULTI-VIEW'}</span>
            </div>
            <img
              className="mode-reference-image"
              src={resolveApiUrl(routed.image.url)}
              alt="Job reference"
            />
          </section>
        )}

        <section className="panel confirm-panel">
          <div className="section-header">
            <h2>生成狀態</h2>
            <span className="badge" data-kind={status ?? 'unknown'}>
              {status ? STATUS_TEXT[status] ?? status : '讀取中'}
            </span>
          </div>

          {status && !isDone && !isFailed && (
            <div className="progress-indicator">
              <span className="spinner" aria-hidden="true" />
              <span>{STATUS_TEXT[status]}…</span>
            </div>
          )}
          {message && <p>{message}</p>}
          {error && <p className="hint error">{error}</p>}
          {refreshError && <p className="hint error">{refreshError}</p>}

          {routed.pipeline === 'multiview' && (
            <p className="hint">
              三視圖已確認。需要調整視圖時可<Link to={viewsPath ?? '/reference'}>返回視圖確認</Link>。
            </p>
          )}

          <TechnicalDetails
            items={[
              ['job_id', jobId],
              ['pipeline', routed.pipeline],
              [
                'prompt_id',
                routed.pipeline === 'single'
                  ? routed.entry.job?.prompt_id
                  : routed.workspace.modelJob?.promptId ?? routed.workspace.job?.promptId,
              ],
            ]}
          />
        </section>
      </div>
    </StageShell>
  );
}

function MissingJob({ reason }: { reason: string }) {
  return (
    <StageShell
      current="generate"
      pipeline={null}
      showSessionStepper={false}
      eyebrow="GENERATE"
      title="找不到這個生成工作"
    >
      <section className="panel">
        <p>{reason}</p>
        <div className="recovery-actions">
          <Link className="primary-action-link" to="/reference">
            回到 Reference 重新開始
          </Link>
          <Link to="/">回首頁</Link>
        </div>
      </section>
    </StageShell>
  );
}
