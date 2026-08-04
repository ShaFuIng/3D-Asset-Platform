import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace, type Pipeline } from '../context/WorkspaceContext';

export type StageId = 'reference' | 'mode' | 'views' | 'generate' | 'inspect';

type StageDef = {
  id: StageId;
  label: string;
  en: string;
  path?: string;
};

const STAGE_DEFS: Record<StageId, StageDef> = {
  reference: { id: 'reference', label: '參考圖', en: 'REFERENCE', path: '/reference' },
  mode: { id: 'mode', label: '模式', en: 'MODE', path: '/mode' },
  views: { id: 'views', label: '視圖', en: 'VIEWS', path: '/views' },
  generate: { id: 'generate', label: '生成', en: 'GENERATE' },
  inspect: { id: 'inspect', label: '檢視', en: 'INSPECT' },
};

// The stepper never skips numbers: single-view hides the views stage instead
// of showing a gap. Before a pipeline is chosen, later stages are unknown.
function stagesForPipeline(pipeline?: Pipeline | null): StageDef[] {
  if (pipeline === 'single') {
    return [STAGE_DEFS.reference, STAGE_DEFS.mode, STAGE_DEFS.generate, STAGE_DEFS.inspect];
  }
  if (pipeline === 'multiview') {
    return [
      STAGE_DEFS.reference,
      STAGE_DEFS.mode,
      STAGE_DEFS.views,
      STAGE_DEFS.generate,
      STAGE_DEFS.inspect,
    ];
  }
  return [STAGE_DEFS.reference, STAGE_DEFS.mode];
}

type StageShellProps = {
  current: StageId;
  pipeline?: Pipeline | null;
  stepperImageId?: string;
  viewsPath?: string;
  eyebrow: string;
  title: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function StageShell({
  current,
  pipeline,
  stepperImageId,
  viewsPath,
  eyebrow,
  title,
  backTo,
  backLabel,
  actions,
  children,
}: StageShellProps) {
  const {
    selectedImageId,
    pipelineByImageId,
    singleJobsByImageId,
    multiviewByImageId,
    hasActiveJobs,
  } = useWorkspace();
  const activeImageId = stepperImageId ?? selectedImageId;
  const activePipeline = pipeline ?? (activeImageId ? pipelineByImageId[activeImageId] : null);
  const stages = stagesForPipeline(activePipeline);
  const currentIndex = stages.findIndex((stage) => stage.id === current);
  const singleEntry = activeImageId ? singleJobsByImageId[activeImageId] : undefined;
  const singleJob = singleEntry?.job;
  const multiviewWorkspace = activeImageId ? multiviewByImageId[activeImageId] : undefined;
  const multiviewJob = multiviewWorkspace?.job;
  const modelJob = multiviewWorkspace?.modelJob;

  function getStageDestination(stage: StageId): string | null {
    if (stage === 'reference') {
      return '/reference';
    }
    if (!activeImageId) {
      return null;
    }
    if (stage === 'mode') {
      return '/mode';
    }
    if (activePipeline === 'single') {
      if (stage === 'generate') {
        return singleJob ? `/jobs/single/${singleJob.job_id}` : '/generate';
      }
      if (stage === 'inspect' && singleJob?.status === 'succeeded' && singleEntry?.modelUrl) {
        return `/viewer/single/${singleJob.job_id}`;
      }
      return null;
    }
    if (activePipeline === 'multiview') {
      if (stage === 'views') {
        return viewsPath ?? `/views/${activeImageId}`;
      }
      if (stage === 'generate' && multiviewJob && modelJob) {
        return `/jobs/multiview/${multiviewJob.jobId}`;
      }
      if (
        stage === 'inspect' &&
        multiviewJob &&
        modelJob?.status === 'succeeded' &&
        (modelJob.geometryModel.available || modelJob.texturedModel.available)
      ) {
        return `/viewer/multiview/${multiviewJob.jobId}`;
      }
    }
    return null;
  }

  return (
    <div className="stage-shell">
      <div className="stage-topbar">
        {backTo ? (
          <Link className="back-button" to={backTo}>
            ← {backLabel ?? '返回'}
          </Link>
        ) : (
          <span className="back-button-spacer" />
        )}

        <nav className="stage-stepper" aria-label="工作流程階段">
          {stages.map((stage, index) => {
            const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
            const destination = getStageDestination(stage.id);
            const label = (
              <>
                <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="step-label">
                  {stage.label}
                  <small>{stage.en}</small>
                </span>
              </>
            );
            return (
              <span className="step" data-state={state} key={stage.id}>
                {state !== 'current' && destination ? (
                  <Link to={destination}>{label}</Link>
                ) : (
                  <span className="step-static">{label}</span>
                )}
              </span>
            );
          })}
          {!pipeline && <span className="step step-unknown">···</span>}
        </nav>

        <span className="back-button-spacer" />
      </div>

      {hasActiveJobs && (
        <p className="session-warning" role="status">
          有生成工作進行中。工作階段狀態僅保存在記憶體，重新整理將失去目前工作的追蹤資訊。
        </p>
      )}

      <header className="stage-header">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </header>

      <div className="stage-body">{children}</div>

      {actions && <div className="stage-action-bar">{actions}</div>}
    </div>
  );
}
