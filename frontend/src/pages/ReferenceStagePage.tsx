import { useNavigate } from 'react-router-dom';
import { resolveApiUrl } from '../api/client';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ImageGallery } from '../components/ImageGallery';
import { StageShell } from '../components/StageShell';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { useWorkspace } from '../context/WorkspaceContext';
import type { ServiceHealthState } from '../types/api';

type ReferenceStagePageProps = {
  openai: ServiceHealthState;
};

// Stage 01: the shared input for both pipelines — generate or upload a
// reference image, then pick one to continue.
export function ReferenceStagePage({ openai }: ReferenceStagePageProps) {
  const navigate = useNavigate();
  const {
    prompt,
    setPrompt,
    conversation,
    images,
    selectedImageId,
    activityMessage,
    errorMessage,
    isGenerating,
    isUploading,
    archivedImageIds,
    editingImageIds,
    imageEditErrors,
    editPromptByImageId,
    generateImage,
    uploadImage,
    selectImage,
    startNewConversation,
    archiveImage,
    restoreImage,
    setEditPrompt,
    editImage,
  } = useWorkspace();

  const selectedImage = images.find((image) => image.image_id === selectedImageId);
  const isOpenAIDisabled = openai.status !== 'configured';
  const openaiDisabledReason =
    openai.status === 'checking'
      ? '正在檢查 OpenAI 設定。'
      : 'OpenAI API key 尚未設定，因此不能使用 Prompt 生成圖片。';

  return (
    <StageShell
      current="reference"
      pipeline={null}
      eyebrow="STAGE 01 · REFERENCE"
      title="建立或上傳 Reference Image"
      actions={
        <>
          <div className="action-bar-summary">
            {selectedImage ? (
              <>
                <img src={resolveApiUrl(selectedImage.url)} alt="Selected reference" />
                <span>已選擇 Reference（{selectedImage.source === 'generated' ? '生成' : '上傳'}）</span>
              </>
            ) : (
              <span className="hint">請先從圖庫選擇一張圖片，或由對話生成／上傳新圖。</span>
            )}
          </div>
          <button
            type="button"
            className="primary-action"
            disabled={!selectedImage}
            onClick={() => navigate('/mode')}
          >
            下一步：選擇生成模式 →
          </button>
        </>
      }
    >
      <div className="reference-layout">
        <ChatPanel
          messages={conversation}
          prompt={prompt}
          isGenerating={isGenerating}
          isUploading={isUploading}
          isDisabled={isOpenAIDisabled}
          disabledReason={openaiDisabledReason}
          activityMessage={activityMessage}
          errorMessage={errorMessage}
          onPromptChange={setPrompt}
          onSubmit={() => {
            if (!isOpenAIDisabled) {
              void generateImage();
            }
          }}
          onUpload={(file) => void uploadImage(file)}
          onStartNewConversation={startNewConversation}
        />

        <div className="reference-side">
          <ImageGallery
            images={images}
            selectedImageId={selectedImageId}
            archivedImageIds={archivedImageIds}
            editingImageIds={editingImageIds}
            imageEditErrors={imageEditErrors}
            editPromptByImageId={editPromptByImageId}
            onSelect={selectImage}
            onArchive={archiveImage}
            onRestore={restoreImage}
            onEditPromptChange={setEditPrompt}
            onEdit={editImage}
          />
          {selectedImage && (
            <TechnicalDetails
              items={[
                ['image_id', selectedImage.image_id],
                ['filename', selectedImage.filename],
                ['source', selectedImage.source],
                ['parent_image_id', selectedImage.parentImageId],
              ]}
            />
          )}
        </div>
      </div>
    </StageShell>
  );
}
