import { resolveApiUrl } from '../api/client';
import type { JobStatus, MultiviewName, MultiviewSlot } from '../types/api';
import type { PendingViewAction } from '../context/WorkspaceContext';

type ViewState = 'empty' | 'loading' | 'review' | 'candidate' | 'accepted' | 'error';

const VIEW_STATE_TEXT: Record<ViewState, string> = {
  empty: '尚未生成',
  loading: '生成中',
  review: '待確認',
  candidate: 'Candidate 待確認',
  accepted: '已接受',
  error: '錯誤',
};

function isPending(status?: JobStatus) {
  return status === 'queued' || status === 'running';
}

function getViewState(slot: MultiviewSlot | undefined, pendingAction?: PendingViewAction): ViewState {
  if (pendingAction || (slot && isPending(slot.status))) {
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
  pendingAction?: PendingViewAction;
  editDraft: string;
  isComfyAvailable: boolean;
  comfyUnavailableReason?: string;
  isOpenAIAvailable: boolean;
  openAIUnavailableReason?: string;
  onAccept: (view: MultiviewName) => void;
  onLocalReroll: (view: MultiviewName) => void;
  onOpenAIReroll: (view: MultiviewName) => void;
  onOpenAIEdit: (view: MultiviewName) => void;
  onEditDraftChange: (view: MultiviewName, value: string) => void;
  onZoom: (view: MultiviewName) => void;
};

export function ViewCard({
  view,
  label,
  slot,
  pendingAction,
  editDraft,
  isComfyAvailable,
  comfyUnavailableReason,
  isOpenAIAvailable,
  openAIUnavailableReason,
  onAccept,
  onLocalReroll,
  onOpenAIReroll,
  onOpenAIEdit,
  onEditDraftChange,
  onZoom,
}: ViewCardProps) {
  const state = getViewState(slot, pendingAction);
  const slotPending = Boolean(slot && isPending(slot.status));
  const image = slotPending ? slot?.currentImage : (slot?.candidateImage ?? slot?.currentImage);
  const hasCurrentImage = Boolean(slot?.currentImage);
  const versionCount = slot?.versions.length ?? 0;
  const isBusy = Boolean(pendingAction || slotPending);
  const canAccept = Boolean(slot && !isBusy && image && !(slot.accepted && !slot.candidateImage));
  const canLocalReroll = Boolean(slot && hasCurrentImage && !isBusy && isComfyAvailable);
  const canOpenAIReroll = Boolean(slot && hasCurrentImage && !isBusy && isOpenAIAvailable);
  const canOpenAIEdit = Boolean(
    slot && hasCurrentImage && !isBusy && isOpenAIAvailable && editDraft.trim(),
  );

  return (
    <article className="view-card" data-state={state}>
      <div className="view-card-header">
        <strong>{label}</strong>
        <div className="view-card-header-badges">
          {versionCount > 0 && <span className="view-version-count">{versionCount} 個版本</span>}
          <span className="badge" data-kind={state}>
            {state === 'loading' && <span className="spinner" aria-hidden="true" />}
            {VIEW_STATE_TEXT[state]}
          </span>
        </div>
      </div>

      <div className="view-card-image-wrap">
        {image ? (
          <>
            <img className="view-slot-image" src={resolveApiUrl(image.url)} alt={`${label} view`} />
            <button
              type="button"
              className="image-zoom-button"
              aria-label={`放大檢視 ${label} 視角`}
              onClick={() => onZoom(view)}
            >
              放大
            </button>
          </>
        ) : (
          <div className="view-placeholder">{state === 'loading' ? '生成中' : '尚未生成'}</div>
        )}
      </div>

      {state === 'candidate' && (
        <p className="hint warning">已有 Candidate 待確認；接受後才會用於多視角 3D。</p>
      )}
      {state === 'error' && slot?.error && <p className="hint error">{slot.error}</p>}

      <div className="view-card-actions">
        <button
          type="button"
          className="view-card-accept"
          disabled={!canAccept}
          onClick={() => onAccept(view)}
        >
          {slot?.accepted && !slot.candidateImage ? '已接受' : 'Accept Candidate'}
        </button>
      </div>

      <div className="view-regenerate-actions">
        <div className="view-regenerate-group">
          <button type="button" disabled={!canLocalReroll} onClick={() => onLocalReroll(view)}>
            {pendingAction === 'local_reroll' ? '重新抽選中...' : '重新抽選（本機）'}
          </button>
          <p className="hint">使用固定視角提示詞與新 Seed，不消耗 OpenAI 額度。</p>
          {!isComfyAvailable && comfyUnavailableReason && (
            <p className="hint warning">{comfyUnavailableReason}</p>
          )}
        </div>

        <div className="view-regenerate-group">
          <button type="button" disabled={!canOpenAIReroll} onClick={() => onOpenAIReroll(view)}>
            {pendingAction === 'openai_reroll' ? '重新抽選中...' : '重新抽選（OpenAI）'}
          </button>
          <p className="hint">使用 OpenAI 從參考圖重新生成此視角，不需輸入指示文字。</p>
          {!isOpenAIAvailable && openAIUnavailableReason && (
            <p className="hint warning">{openAIUnavailableReason}</p>
          )}
        </div>

        <div className="view-regenerate-group">
          <label htmlFor={`edit-${view}`}>使用 GPT 調整</label>
          <textarea
            id={`edit-${view}`}
            value={editDraft}
            placeholder="描述要調整的部分，可直接輸入中文……"
            disabled={isBusy || !hasCurrentImage || !isOpenAIAvailable}
            onChange={(event) => onEditDraftChange(view, event.target.value)}
          />
          <button type="button" disabled={!canOpenAIEdit} onClick={() => onOpenAIEdit(view)}>
            {pendingAction === 'openai_edit' ? 'GPT 調整中...' : '使用 GPT 調整'}
          </button>
          <p className="hint">此操作會使用 OpenAI API 額度。</p>
          {!isOpenAIAvailable && openAIUnavailableReason && (
            <p className="hint warning">{openAIUnavailableReason}</p>
          )}
        </div>
      </div>
    </article>
  );
}
