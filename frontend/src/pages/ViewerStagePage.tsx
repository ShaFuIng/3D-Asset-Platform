import { Link, useParams } from 'react-router-dom';
import { ModelViewer } from '../components/ModelViewer';
import { StageShell } from '../components/StageShell';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAssetCalibration } from '../hooks/useAssetCalibration';
import { findRoutedJob, parsePipeline } from './routedJob';
import { resolveApiUrl } from '../api/client';

// Stage 05: inspection workspace. Single-view shows one GLB; multiview keeps
// the geometry/textured variants with an explicit "now previewing" indicator.
export function ViewerStagePage() {
  const params = useParams();
  const pipeline = parsePipeline(params.pipeline);
  const jobId = params.jobId;
  const { images, singleJobsByImageId, multiviewByImageId, setMultiviewModelKind } = useWorkspace();

  const routed =
    pipeline && jobId
      ? findRoutedJob({ pipeline, jobId, images, singleJobsByImageId, multiviewByImageId })
      : null;

  // Computed unconditionally (before the early returns below) so the
  // useAssetCalibration() hook call that follows always runs in the same
  // order across renders, regardless of which pipeline/branch ends up
  // rendering -- each raw asset (single GLB, or geometry/textured
  // individually) has its own independent calibration state (Phase 2/4),
  // so switching activeModelKind naturally re-queries via the assetId change.
  let inspectAssetId: string | undefined;
  if (routed?.pipeline === 'single') {
    inspectAssetId = routed.entry.job?.asset_id ?? undefined;
  } else if (routed?.pipeline === 'multiview') {
    const modelJob = routed.workspace.modelJob;
    inspectAssetId =
      (routed.workspace.activeModelKind === 'textured'
        ? modelJob?.texturedModel.assetId ?? modelJob?.geometryModel.assetId
        : modelJob?.geometryModel.assetId ?? modelJob?.texturedModel.assetId) ?? undefined;
  }
  const calibration = useAssetCalibration(inspectAssetId);

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
    // Backend converts + caches USDZ on first hit (see blender_client.py);
    // ModelViewer only fetches this when the user actually clicks "在 AR
    // 中檢視" on iOS.
    const usdzUrl = modelUrl ? resolveApiUrl(`/api/3d/jobs/${jobId}/usdz`) : undefined;
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
          {calibration.error && <p className="hint error">{calibration.error}</p>}
          <div className="model-preview">
            <ModelViewer
              src={
                calibration.calibratedAsset?.status === 'available'
                  ? resolveApiUrl(calibration.calibratedAsset.content_url)
                  : modelUrl
              }
              usdzUrl={usdzUrl}
              assetId={inspectAssetId}
              rawAsset={calibration.rawAsset}
              calibratedAsset={calibration.calibratedAsset}
              isCalibrated={calibration.calibratedAsset?.status === 'available'}
              onCalibrated={() => void calibration.refresh()}
            />
          </div>
          <div className="model-downloads">
          {modelUrl ? (
              <a className="download-link" href={modelUrl} download={calibration.rawAsset?.filename}>
                下載原始生成 GLB
              </a>
            ) : (
              <span className="hint">模型尚不可用；請回到生成進度頁確認狀態。</span>
            )}
            {calibration.calibratedAsset?.status === 'available' && (
              <a
                className="download-link"
                href={resolveApiUrl(calibration.calibratedAsset.content_url)}
                download={calibration.calibratedAsset.filename}
              >
                下載校正後 GLB
              </a>
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
  // Mirrors the single-pipeline usdzUrl above, but keyed to whichever kind
  // (geometry/textured) is currently selected -- see
  // GET /api/multiview/jobs/{job_id}/models/{kind}/usdz.
  const usdzUrl = activeModelUrl
    ? resolveApiUrl(`/api/multiview/jobs/${jobId}/models/${activeModelKind}/usdz`)
    : undefined;

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

        {calibration.error && <p className="hint error">{calibration.error}</p>}
        <div className="model-preview">
          <ModelViewer
            src={
              calibration.calibratedAsset?.status === 'available'
                ? resolveApiUrl(calibration.calibratedAsset.content_url)
                : activeModelUrl ?? undefined
            }
            assetId={inspectAssetId}
            rawAsset={calibration.rawAsset}
            calibratedAsset={calibration.calibratedAsset}
            isCalibrated={calibration.calibratedAsset?.status === 'available'}
            onCalibrated={() => void calibration.refresh()}
          />
        </div>

        <div className="model-downloads">
          {geometryUrl ? (
            <a
              className="download-link"
              href={geometryUrl}
              download={
                workspace.activeModelKind === 'geometry' ? calibration.rawAsset?.filename : undefined
              }
            >
              下載原始生成 Geometry GLB
            </a>
          ) : (
            <span className="hint">Geometry GLB 不可用</span>
          )}
          {texturedUrl ? (
            <a
              className="download-link"
              href={texturedUrl}
              download={
                workspace.activeModelKind === 'textured' ? calibration.rawAsset?.filename : undefined
              }
            >
              下載原始生成 Textured GLB
            </a>
          ) : (
            <span className="hint">Textured GLB 不可用</span>
          )}
          {calibration.calibratedAsset?.status === 'available' && (
            <a
              className="download-link"
              href={resolveApiUrl(calibration.calibratedAsset.content_url)}
              download={calibration.calibratedAsset.filename}
            >
              下載校正後 GLB
            </a>
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
