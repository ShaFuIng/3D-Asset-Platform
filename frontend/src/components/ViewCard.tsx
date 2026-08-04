import { resolveApiUrl } from '../api/client';
import type { JobStatus, MultiviewName, MultiviewSlot } from '../types/api';

// UI state derived from the backend slot.
type ViewState = 'empty' | 'loading' | 'review' | 'candidate' | 'accepted' | 'error';

const VIEW_STATE_TEXT: Record<ViewState, string> = {
  empty: '尚未生成',
  loading: '生成中…',
  review: '等待確認',
  candidate: 'Candidate 待確認',
  accepted: '已接受 ✓',
  error: '錯誤',
};

function isPending(status?: JobStatus) {
  return status === 'queued' || status === 'running';
}

function getViewState(slot: MultiviewSlot | undefined, isAcceptPending: boolean): ViewState {
  if (isAcceptPending || (slot && isPending(slot.status))) {
    return 'loading';
  }
  if (slot?.error) {
    return 'error';
  }
  if (slot?.candidateImage) {
    return 'candidate';
  }
  if (slot?.currentImage) {
    return slot.accepted ? 'accepted' : 'review';
  }
  return 'empty';
}

type ViewCardProps = {
  view: MultiviewName;
  label: string;
  slot?: MultiviewSlot;
  isAcceptPending: boolean;
  onAccept: (view: MultiviewName) => void;
  onRegenerate: (view: MultiviewName) => void;
  onZoom: (url: string) => void;
};

export function ViewCard({ view, label, slot, isAcceptPending, onAccept, onRegenerate, onZoom }: ViewCardProps) {
  const state = getViewState(slot, isAcceptPending);
  const image = slot?.candidateImage ?? slot?.currentImage;
  const canAccept = Boolean(
    slot && !isAcceptPending && !isPending(slot.status) && image && !(slot.accepted && !slot.candidateImage),
  );
  const canRegenerate = Boolean(slot && !isAcceptPending && !isPending(slot.status));

  return (
    <article className="view-card" data-state={state}>
      <div className="view-card-header">
        <strong>{label}</strong>
        <span className="badge" data-kind={state}>
          {state === 'loading' && <span className="spinner" aria-hidden="true" />}
          {VIEW_STATE_TEXT[state]}
        </span>
      </div>

      <div className="view-card-image-wrap">
        {image ? (
          <>
            <img className="view-slot-image" src={resolveApiUrl(image.url)} alt={`${label} view`} />
            <button
              type="button"
              className="image-zoom-button"
              aria-label={`放大檢視 ${label} 視圖`}
              onClick={() => onZoom(resolveApiUrl(image.url))}
            >
              ⤢
            </button>
          </>
        ) : (
          <div className="view-placeholder">
            {state === 'loading' ? '生成中…' : '尚未生成'}
          </div>
        )}
      </div>

      {state === 'candidate' && (
        <p className="hint warning">新的 Candidate 尚未接受；接受後才會用於 3D 生成。</p>
      )}
      {state === 'error' && slot?.error && <p className="hint error">{slot.error}</p>}

      <div className="view-card-actions">
        <button
          type="button"
          className="view-card-accept"
          disabled={!canAccept}
          onClick={() => onAccept(view)}
        >
          {slot?.accepted && !slot.candidateImage ? '已接受' : 'Accept Candidate／接受候選'}
        </button>
        <button type="button" disabled={!canRegenerate} onClick={() => onRegenerate(view)}>
          Regenerate
        </button>
      </div>
    </article>
  );
}
