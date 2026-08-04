import { useEffect, useMemo, useState } from 'react';
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
import {
  DEFAULT_VIEW_GENERATION_STATE,
  type ViewGenerationState,
  type ViewSlotId,
} from '../components/ImageLightbox';
import { JobPanel, type JobEntry } from '../components/JobPanel';
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

// Fake delay so the "generating" state is visible in the UI. No real API call here.
const FAKE_VIEW_GENERATION_DELAY_MS = 1500;

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

export function SingleImageWorkspace({ openai, comfy }: SingleImageWorkspaceProps) {
  const [prompt, setPrompt] = useState('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [previousResponseId, setPreviousResponseId] = useState<string>();
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>();
  const [activityMessage, setActivityMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Keyed by image_id so a previously generated left/back view, and any 3D
  // job created from ImageLightbox, survive switching the gallery selection
  // or closing/reopening the lightbox — see ImageGallery.tsx / ImageLightbox.tsx.
  // JobPanel reads jobsByImageId too, so job creation (triggered in the
  // lightbox) and job display (JobPanel) always agree.
  const [viewStatesByImageId, setViewStatesByImageId] = useState<Record<string, ViewGenerationState>>({});
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
  }, [pendingJobsKey]);

  function handleGenerateSlot(imageId: string, slotId: ViewSlotId) {
    setViewStatesByImageId((current) => {
      const imageState = current[imageId] ?? DEFAULT_VIEW_GENERATION_STATE;
      if (imageState[slotId] === 'generating') {
        return current;
      }
      return { ...current, [imageId]: { ...imageState, [slotId]: 'generating' } };
    });

    window.setTimeout(() => {
      setViewStatesByImageId((current) => {
        const imageState = current[imageId] ?? DEFAULT_VIEW_GENERATION_STATE;
        return { ...current, [imageId]: { ...imageState, [slotId]: 'done' } };
      });
    }, FAKE_VIEW_GENERATION_DELAY_MS);
  }

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

  return (
    <section className="workspace" aria-label="單圖轉 3D 工作區">
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
        viewStatesByImageId={viewStatesByImageId}
        onGenerateSlot={handleGenerateSlot}
        jobsByImageId={jobsByImageId}
        isComfyDisconnected={isComfyDisconnected}
        onCreateJob={handleCreateJobForImage}
      />

      <JobPanel
        selectedImage={selectedImage}
        viewState={selectedImage ? viewStatesByImageId[selectedImage.image_id] : undefined}
        jobEntry={selectedImage ? jobsByImageId[selectedImage.image_id] : undefined}
      />
    </section>
  );
}
