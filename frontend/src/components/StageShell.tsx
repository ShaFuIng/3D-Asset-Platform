import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace, type Pipeline } from '../context/WorkspaceContext';
import { getStageNavItems, type StageNavId } from '../navigation/stageNav';

export type StageId = StageNavId;

type StageShellProps = {
  current: StageId;
  pipeline?: Pipeline | null;
  stepperImageId?: string;
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
};

// Shared stage frame: fixed home button top-left, the five-stage rail (rules
// come from navigation/stageNav, same as the Home session rail), session
// warning, header and the sticky action bar. Navigation only — clicking a
// stage never triggers generation.
export function StageShell({
  current,
  stepperImageId,
  eyebrow,
  title,
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

  const items = getStageNavItems({
    imageId: stepperImageId ?? selectedImageId,
    pipelineByImageId,
    singleJobsByImageId,
    multiviewByImageId,
    currentStage: current,
  });
  const currentIndex = items.findIndex((item) => item.id === current);

  return (
    <div className="stage-shell">
      <div className="stage-topbar">
        <Link className="back-button" to="/">
          ← 回到首頁
        </Link>

        <nav className="stage-stepper" aria-label="工作流程階段">
          {items.map((item) => {
            const label = (
              <>
                <span className="step-number">{String(item.index + 1).padStart(2, '0')}</span>
                <span className="step-label">
                  {item.label}
                  <small>{item.en}</small>
                </span>
              </>
            );
            const canNavigate = Boolean(item.destination) && item.state !== 'current';
            return (
              <span className="step" data-state={item.state} key={item.id}>
                {canNavigate && item.destination ? (
                  <Link to={item.destination}>{label}</Link>
                ) : (
                  <span className="step-static" title={item.note}>
                    {label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>

        <span className="stage-code" aria-hidden="true">
          SEC.{String(currentIndex + 1).padStart(2, '0')} // {items[currentIndex]?.en ?? '—'}
        </span>
      </div>

      {hasActiveJobs && (
        <p className="session-warning" role="status">
          有生成工作進行中。工作階段狀態僅保存在記憶體，重新整理將失去目前工作的追蹤資訊。
        </p>
      )}

      <header className="stage-header">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <span className="stage-index" aria-hidden="true">
          {String(currentIndex + 1).padStart(2, '0')}
        </span>
      </header>

      <div className="stage-body">{children}</div>

      {actions && <div className="stage-action-bar">{actions}</div>}
    </div>
  );
}
