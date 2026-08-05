import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ARPreview } from '../components/ARPreview';
import { ModelViewer } from '../components/ModelViewer';
import { StageShell } from '../components/StageShell';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { useWorkspace } from '../context/WorkspaceContext';
import { findRoutedJob, parsePipeline } from './routedJob';
import { resolveApiUrl } from '../api/client';

type ViewerMode = '3d' | 'ar';

// Stage 05: inspection workspace. Single-view shows one GLB; multiview keeps
// the geometry/textured variants with an explicit "now previewing" indicator.
export function ViewerStagePage() {
  const params = useParams();
  const pipeline = parsePipeline(params.pipeline);
  const jobId = params.jobId;
  const { images, singleJobsByImageId, multiviewByImageId, setMultiviewModelKind } = useWorkspace();
  // Local only, same as the existing Geometry/Textured toggle below — not
  // part of WorkspaceContext/stageNav's state machine, just which viewer
  // component is currently shown for whichever model is already resolved.
  const [viewerMode, setViewerMode] = useState<ViewerMode>('3d');

  const routed =
    pipeline && jobId
      ? findRoutedJob({ pipeline, jobId, images, singleJobsByImageId, multiviewByImageId })
      : null;

  if (!routed) {
    return (
      <StageShell
        current="inspect"
        pipeline={pipeline}
        showSessionStepper={false}
        eyebrow="INSPECT"
        title="找不到這個模型"
      >
        <section className="panel">
          <p>這個模型不存在於目前的工作階段。頁面可能經過重新整理，記憶體中的追蹤資訊已重置（已生成的檔案仍保留在後端）。</p>
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

  const viewsPath = routed.pipeline === 'multiview' ? `/views/${routed.imageId}` : undefined;

  if (routed.pipeline === 'single') {
    const modelUrl = routed.entry.modelUrl;
    return (
      <StageShell
        current="inspect"
        pipeline="single"
        stepperImageId={routed.imageId}
        eyebrow="SINGLE-VIEW PIPELINE · INSPECT"
        title="3D 模型檢視"
      >
        <section className="panel viewer-panel">
          <div className="section-header">
            <h2>模型預覽</h2>
            <span className="badge" data-kind={modelUrl ? 'succeeded' : 'unknown'}>
              {modelUrl ? 'Ready' : 'Unavailable'}
            </span>
          </div>

          <div className="model-toggle" role="group" aria-label="Viewer mode selector">
            <button type="button" data-selected={viewerMode === '3d'} onClick={() => setViewerMode('3d')}>
              3D 檢視
            </button>
            <button type="button" data-selected={viewerMode === 'ar'} onClick={() => setViewerMode('ar')}>
              AR 預覽
            </button>
          </div>

          <div className="model-preview">
            {viewerMode === '3d' ? <ModelViewer src={modelUrl} /> : <ARPreview modelUrl={modelUrl} />}
          </div>
          <div className="model-downloads">
            {modelUrl ? (
              <a className="download-link" href={modelUrl} download>
                下載 GLB
              </a>
            ) : (
              <span className="hint">模型尚不可用；請回到生成進度頁確認狀態。</span>
            )}
          </div>
          <TechnicalDetails items={[['job_id', jobId], ['pipeline', 'single']]} />
        </section>
      </StageShell>
    );
  }

  const { workspace, imageId } = routed;
  const modelJob = workspace.modelJob;
  const geometryUrl = modelJob?.geometryModel.downloadUrl
    ? resolveApiUrl(modelJob.geometryModel.downloadUrl)
    : null;
  const texturedUrl = modelJob?.texturedModel.downloadUrl
    ? resolveApiUrl(modelJob.texturedModel.downloadUrl)
    : null;
  const activeModelKind = workspace.activeModelKind;
  const activeModelUrl =
    activeModelKind === 'textured' ? texturedUrl || geometryUrl : geometryUrl || texturedUrl;

  return (
    <StageShell
        current="inspect"
        pipeline="multiview"
        stepperImageId={routed.imageId}
      eyebrow="MULTI-VIEW PIPELINE · INSPECT"
      title="3D 模型檢視"
      actions={
        <>
          <div className="action-bar-summary">
            <span className="hint">想調整 Front / Left / Back 視圖時，可回到視圖確認階段。</span>
          </div>
          <Link className="primary-action-link" to={viewsPath ?? '/reference'}>
            返回調整視圖
          </Link>
        </>
      }
    >
      <section className="panel viewer-panel">
        <div className="section-header">
          <h2>模型預覽</h2>
          <span className="badge" data-kind={activeModelUrl ? 'succeeded' : 'unknown'}>
            正在預覽：{activeModelKind === 'textured' ? 'Textured' : 'Geometry'}
          </span>
        </div>

        <div className="model-toggle" role="group" aria-label="Model result selector">
          <button
            type="button"
            data-selected={activeModelKind === 'geometry'}
            onClick={() => setMultiviewModelKind(imageId, 'geometry')}
          >
            Geometry{geometryUrl ? '' : '（不可用）'}
          </button>
          <button
            type="button"
            data-selected={activeModelKind === 'textured'}
            onClick={() => setMultiviewModelKind(imageId, 'textured')}
          >
            Textured{texturedUrl ? '' : '（不可用）'}
          </button>
        </div>

        <div className="model-toggle" role="group" aria-label="Viewer mode selector">
          <button type="button" data-selected={viewerMode === '3d'} onClick={() => setViewerMode('3d')}>
            3D 檢視
          </button>
          <button type="button" data-selected={viewerMode === 'ar'} onClick={() => setViewerMode('ar')}>
            AR 預覽
          </button>
        </div>

        <div className="model-preview">
          {viewerMode === '3d' ? (
            <ModelViewer src={activeModelUrl ?? undefined} />
          ) : (
            <ARPreview modelUrl={activeModelUrl ?? undefined} />
          )}
        </div>

        <div className="model-downloads">
          {geometryUrl ? (
            <a className="download-link" href={geometryUrl} download>
              下載 Geometry GLB
            </a>
          ) : (
            <span className="hint">Geometry GLB 不可用</span>
          )}
          {texturedUrl ? (
            <a className="download-link" href={texturedUrl} download>
              下載 Textured GLB
            </a>
          ) : (
            <span className="hint">Textured GLB 不可用</span>
          )}
        </div>

        <TechnicalDetails
          items={[
            ['job_id', jobId],
            ['pipeline', 'multiview'],
            ['prompt_id', modelJob?.promptId],
            ['model_status', modelJob?.status],
          ]}
        />
      </section>
    </StageShell>
  );
}
