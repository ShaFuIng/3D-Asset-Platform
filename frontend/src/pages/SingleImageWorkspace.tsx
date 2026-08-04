import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveApiUrl } from '../api/client';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ImageGallery } from '../components/ImageGallery';
import { JobPanel } from '../components/JobPanel';
import { useWorkspace, type Pipeline } from '../context/WorkspaceContext';
import { MultiviewPanel } from './ThreeViewPage';
import type { ServiceHealthState } from '../types/api';

type SingleImageWorkspaceProps = {
  openai: ServiceHealthState;
  comfy: ServiceHealthState;
};

// Legacy query-string compatibility layer: "?mode=multiview" (also used by the
// /three-view redirect) only supplies a mode when the selected image has no
// explicit pipeline choice. pipelineByImageId is the single source of truth;
// this fallback and the setSearchParams calls are removed in Phase 2 routing.
function getModeFromSearch(searchParams: URLSearchParams): Pipeline {
  return searchParams.get('mode') === 'multiview' ? 'multiview' : 'single';
}

export function SingleImageWorkspace({ openai, comfy }: SingleImageWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
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
    generateImage,
    uploadImage,
    selectImage,
    pipelineByImageId,
    setPipeline,
    singleJobsByImageId,
    createSingleJob,
  } = useWorkspace();

  const selectedImage = useMemo(
    () => images.find((image) => image.image_id === selectedImageId),
    [images, selectedImageId],
  );

  const mode: Pipeline =
    (selectedImageId ? pipelineByImageId[selectedImageId] : undefined) ??
    getModeFromSearch(searchParams);

  const isOpenAIDisabled = openai.status !== 'configured';
  const isComfyDisconnected = comfy.status !== 'connected';
  const openaiDisabledReason =
    openai.status === 'checking'
      ? '正在檢查 OpenAI 設定。'
      : 'OpenAI API key 尚未設定，因此不能使用 Prompt 生成圖片。';

  function handleGenerateImage() {
    if (isOpenAIDisabled) {
      return;
    }
    void generateImage();
  }

  function handleCreateJobForImage(imageId: string) {
    if (isComfyDisconnected) {
      return;
    }
    void createSingleJob(imageId);
  }

  function handleModeChange(nextMode: Pipeline) {
    if (selectedImageId) {
      setPipeline(selectedImageId, nextMode);
    }
    setSearchParams(nextMode === 'multiview' ? { mode: 'multiview' } : {});
  }

  return (
    <section className="workspace-page" aria-label="3D 生成工作區">
      <div className="workspace">
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
          onSubmit={handleGenerateImage}
          onUpload={(file) => void uploadImage(file)}
        />

        <ImageGallery
          images={images}
          selectedImageId={selectedImageId}
          onSelect={selectImage}
        />

        <section className="panel workspace-panel selected-reference-panel">
          <div className="section-header">
            <h2>Reference Image</h2>
            <span>{selectedImage ? selectedImage.source : 'none'}</span>
          </div>
          {selectedImage ? (
            <div className="selected-image">
              <img src={resolveApiUrl(selectedImage.url)} alt="Selected reference preview" />
              <div>
                <span>目前選取 image_id</span>
                <code>{selectedImage.image_id}</code>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">請先從 Gallery 選擇一張圖片。</div>
          )}
          <div className="mode-toggle" role="group" aria-label="Workspace mode">
            <button type="button" data-selected={mode === 'single'} onClick={() => handleModeChange('single')}>
              Single Image
            </button>
            <button type="button" data-selected={mode === 'multiview'} onClick={() => handleModeChange('multiview')}>
              Multiview
            </button>
          </div>
        </section>
      </div>

      {mode === 'single' ? (
        <JobPanel
          selectedImage={selectedImage}
          jobEntry={selectedImage ? singleJobsByImageId[selectedImage.image_id] : undefined}
          isComfyDisconnected={isComfyDisconnected}
          onCreateJob={handleCreateJobForImage}
        />
      ) : (
        <MultiviewPanel selectedImage={selectedImage} comfy={comfy} />
      )}
    </section>
  );
}
