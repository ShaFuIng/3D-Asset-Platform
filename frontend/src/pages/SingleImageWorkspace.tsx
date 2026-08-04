import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ApiClientError,
  create3DJob,
  generateImage,
  get3DJob,
  resolveApiUrl,
  uploadImage,
} from '../api/client';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ImageGallery } from '../components/ImageGallery';
import { JobPanel, type JobEntry } from '../components/JobPanel';
import { MultiviewPanel } from './ThreeViewPage';
import type { ChatMessage, ImageAsset, ServiceHealthState } from '../types/api';
import {
  createMessageId,
  formatMessageTime,
  type ConversationMessage,
} from '../types/conversation';

type SingleImageWorkspaceProps = {
  openai: ServiceHealthState;
  comfy: ServiceHealthState;
};

const DEFAULT_JOB_ENTRY: JobEntry = { isCreatingJob: false };
type WorkspaceMode = 'single' | 'multiview';

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '發生未知錯誤。';
}

function createConversationMessage(
  role: ConversationMessage['role'],
  content: string,
  imageId?: string,
): ConversationMessage {
  return {
    id: createMessageId(),
    role,
    content,
    createdAt: formatMessageTime(),
    imageId,
  };
}

function toApiMessages(messages: ConversationMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
    .slice(-20);
}

function getModeFromSearch(searchParams: URLSearchParams): WorkspaceMode {
  return searchParams.get('mode') === 'multiview' ? 'multiview' : 'single';
}

export function SingleImageWorkspace({ openai, comfy }: SingleImageWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<WorkspaceMode>(() => getModeFromSearch(searchParams));
  const [prompt, setPrompt] = useState('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [previousResponseId, setPreviousResponseId] = useState<string>();
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>();
  const [activityMessage, setActivityMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [jobsByImageId, setJobsByImageId] = useState<Record<string, JobEntry>>({});

  const selectedImage = useMemo(
    () => images.find((image) => image.image_id === selectedImageId),
    [images, selectedImageId],
  );

  const isOpenAIDisabled = openai.status !== 'configured';
  const isComfyDisconnected = comfy.status !== 'connected';
  const openaiDisabledReason =
    openai.status === 'checking'
      ? '正在檢查 OpenAI 設定。'
      : 'OpenAI API key 尚未設定，因此不能使用 Prompt 生成圖片。';

  useEffect(() => {
    setMode(getModeFromSearch(searchParams));
  }, [searchParams]);

  function updateJobEntry(imageId: string, updater: (entry: JobEntry) => JobEntry) {
    setJobsByImageId((current) => ({
      ...current,
      [imageId]: updater(current[imageId] ?? DEFAULT_JOB_ENTRY),
    }));
  }

  // Derived summary of which jobs are still queued/running, and their
  // job_id/status. Mirrors the previous single-job polling effect's
  // [job?.job_id, job?.status] dependency, generalized to multiple
  // concurrent jobs (one per image_id a job was created from).
  const pendingJobsKey = Object.entries(jobsByImageId)
    .filter(([, entry]) => entry.job && (entry.job.status === 'queued' || entry.job.status === 'running'))
    .map(([imageId, entry]) => `${imageId}:${entry.job!.job_id}:${entry.job!.status}`)
    .join('|');

  useEffect(() => {
    if (mode !== 'single') {
      return;
    }

    const pendingImageIds = Object.entries(jobsByImageId)
      .filter(([, entry]) => entry.job && (entry.job.status === 'queued' || entry.job.status === 'running'))
      .map(([imageId]) => imageId);

    if (pendingImageIds.length === 0) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    // Real (non-abort) polling errors stop that one image's polling, same as
    // the previous single-job effect did, without touching other pending jobs.
    const stillPolling = new Set(pendingImageIds);

    const timerId = window.setInterval(() => {
      stillPolling.forEach((imageId) => {
        const jobId = jobsByImageId[imageId]?.job?.job_id;
        if (!jobId) {
          return;
        }
        void get3DJob(jobId, controller.signal)
          .then((nextJob) => {
            if (!isActive) {
              return;
            }
            updateJobEntry(imageId, (entry) => {
              const next: JobEntry = { ...entry, job: nextJob };
              if (nextJob.status === 'succeeded' && nextJob.result?.model_url) {
                next.modelUrl = resolveApiUrl(nextJob.result.model_url);
              }
              if (nextJob.status === 'failed') {
                next.error = nextJob.message;
              }
              return next;
            });
          })
          .catch((error) => {
            if (!isActive) {
              return;
            }
            const message = getErrorMessage(error);
            if (message) {
              stillPolling.delete(imageId);
              updateJobEntry(imageId, (entry) => ({ ...entry, error: message }));
            }
          });
      });
    }, 2000);

    return () => {
      isActive = false;
      controller.abort();
      window.clearInterval(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pendingJobsKey]);

  async function handleCreateJobForImage(imageId: string) {
    if (isComfyDisconnected || jobsByImageId[imageId]?.isCreatingJob) {
      return;
    }

    updateJobEntry(imageId, () => ({ isCreatingJob: true }));

    try {
      const created = await create3DJob(imageId);
      updateJobEntry(imageId, () => ({
        isCreatingJob: false,
        job: {
          job_id: created.job_id,
          status: created.status,
          message: '3D generation job is queued.',
          prompt_id: null,
          result: null,
        },
      }));
    } catch (error) {
      updateJobEntry(imageId, () => ({ isCreatingJob: false, error: getErrorMessage(error) }));
    }
  }

  function addAndSelectImage(image: ImageAsset) {
    setImages((current) => [image, ...current]);
    setSelectedImageId(image.image_id);
  }

  async function handleGenerateImage() {
    const content = prompt.trim();
    if (!content || isOpenAIDisabled || isGenerating) {
      return;
    }

    const userMessage = createConversationMessage('user', content);
    const nextConversation = [...conversation, userMessage];
    setConversation(nextConversation);
    setPrompt('');
    setIsGenerating(true);
    setErrorMessage(undefined);
    setActivityMessage('正在生成圖片...');

    try {
      const requestMessages = previousResponseId
        ? toApiMessages([userMessage])
        : toApiMessages(nextConversation);
      const data = await generateImage(requestMessages, previousResponseId);
      addAndSelectImage({ ...data, source: 'generated' });
      setPreviousResponseId(data.response_id);
      setConversation((current) => [
        ...current,
        createConversationMessage('assistant', data.assistant_message, data.image_id),
      ]);
      setActivityMessage('圖片已生成。');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setActivityMessage(undefined);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleUploadImage(file: File) {
    if (isUploading) {
      return;
    }

    setIsUploading(true);
    setErrorMessage(undefined);
    setActivityMessage('正在上傳圖片...');
    try {
      const data = await uploadImage(file);
      addAndSelectImage({ ...data, source: 'uploaded' });
      setConversation((current) => [
        ...current,
        createConversationMessage(
          'assistant',
          '已加入你上傳的圖片，可以選擇它建立 3D 模型。',
          data.image_id,
        ),
      ]);
      setActivityMessage('圖片已上傳。');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setActivityMessage(undefined);
    } finally {
      setIsUploading(false);
    }
  }

  function handleSelectImage(image: ImageAsset) {
    setSelectedImageId(image.image_id);
  }

  function handleModeChange(nextMode: WorkspaceMode) {
    setMode(nextMode);
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
          onUpload={handleUploadImage}
        />

        <ImageGallery
          images={images}
          selectedImageId={selectedImageId}
          onSelect={handleSelectImage}
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
          jobEntry={selectedImage ? jobsByImageId[selectedImage.image_id] : undefined}
          isComfyDisconnected={isComfyDisconnected}
          onCreateJob={handleCreateJobForImage}
        />
      ) : (
        <MultiviewPanel selectedImage={selectedImage} comfy={comfy} />
      )}
    </section>
  );
}
