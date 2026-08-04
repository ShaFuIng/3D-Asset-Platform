import { Navigate, useNavigate } from 'react-router-dom';
import { resolveApiUrl } from '../api/client';
import { StageShell } from '../components/StageShell';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { useWorkspace, type Pipeline } from '../context/WorkspaceContext';

// Stage 02: pipeline selection only. Clicking a card records the choice and
// navigates; it never calls a generation API.
export function ModeSelectPage() {
  const navigate = useNavigate();
  const { images, selectedImageId, pipelineByImageId, setPipeline } = useWorkspace();

  const selectedImage = images.find((image) => image.image_id === selectedImageId);
  if (!selectedImage) {
    return <Navigate to="/reference" replace />;
  }

  const currentPipeline = pipelineByImageId[selectedImage.image_id];

  function choose(pipeline: Pipeline, destination: string) {
    setPipeline(selectedImage!.image_id, pipeline);
    navigate(destination);
  }

  return (
    <StageShell
      current="mode"
      pipeline={currentPipeline ?? null}
      eyebrow="STAGE 02 · MODE"
      title="選擇生成模式"
      backTo="/reference"
      backLabel="參考圖"
    >
      <div className="mode-layout">
        <section className="panel mode-reference">
          <div className="section-header">
            <h2>Reference</h2>
            <span>{selectedImage.source === 'generated' ? '生成' : '上傳'}</span>
          </div>
          <img
            className="mode-reference-image"
            src={resolveApiUrl(selectedImage.url)}
            alt="Selected reference"
          />
          <TechnicalDetails items={[['image_id', selectedImage.image_id]]} />
        </section>

        <div className="mode-cards">
          <button
            type="button"
            className="mode-card"
            data-selected={currentPipeline === 'single'}
            onClick={() => choose('single', '/generate')}
          >
            <span className="mode-card-eyebrow">SINGLE-VIEW · 1 IMAGE</span>
            <strong>單圖轉 3D</strong>
            <span className="mode-card-flow">Reference → 3D</span>
            <span className="mode-card-desc">
              直接使用這張圖生成 3D 模型。速度快；背面與側面由模型推測。
            </span>
            {currentPipeline === 'single' && <span className="badge" data-kind="accepted">目前選擇</span>}
          </button>

          <button
            type="button"
            className="mode-card"
            data-selected={currentPipeline === 'multiview'}
            onClick={() => choose('multiview', `/views/${selectedImage.image_id}`)}
          >
            <span className="mode-card-eyebrow">MULTI-VIEW · 3 VIEWS</span>
            <strong>多視圖轉 3D</strong>
            <span className="mode-card-flow">Reference → Front / Left / Back → 3D</span>
            <span className="mode-card-desc">
              先生成 Front、Left、Back 三張視圖，逐一檢查確認後再生成 3D。品質較可控，流程較長。
            </span>
            {currentPipeline === 'multiview' && <span className="badge" data-kind="accepted">目前選擇</span>}
          </button>
        </div>
      </div>
    </StageShell>
  );
}
