import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { JobPanel } from '../components/JobPanel';
import type { ChatMessage, ImageAsset, JobResponse, ServiceHealthState } from '../types/api';
import {
  createMessageId,
  formatMessageTime,
  type ConversationMessage,
} from '../types/conversation';

type SingleImageWorkspaceProps = {
  openai: ServiceHealthState;
  comfy: ServiceHealthState;
};

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
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [job, setJob] = useState<JobResponse>();
  const [modelUrl, setModelUrl] = useState<string>();

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
    if (!job || !['queued', 'running'].includes(job.status)) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    const timerId = window.setInterval(() => {
      void get3DJob(job.job_id, controller.signal)
        .then((nextJob) => {
          if (!isActive) {
            return;
          }
          setJob(nextJob);
          if (nextJob.status === 'succeeded' && nextJob.result?.model_url) {
            setModelUrl(resolveApiUrl(nextJob.result.model_url));
            setActivityMessage('3D 模型已完成。');
          }
          if (nextJob.status === 'failed') {
            setActivityMessage(undefined);
            setErrorMessage(nextJob.message);
          }
        })
        .catch((error) => {
          if (!isActive) {
            return;
          }
          const message = getErrorMessage(error);
          if (message) {
            setErrorMessage(message);
            setActivityMessage(undefined);
            window.clearInterval(timerId);
          }
        });
    }, 2000);

    return () => {
      isActive = false;
      controller.abort();
      window.clearInterval(timerId);
    };
  }, [job?.job_id, job?.status]);

  const resetJobState = useCallback(() => {
    setJob(undefined);
    setModelUrl(undefined);
    setErrorMessage(undefined);
    setActivityMessage(undefined);
  }, []);

  function addAndSelectImage(image: ImageAsset) {
    setImages((current) => [image, ...current]);
    setSelectedImageId(image.image_id);
    resetJobState();
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

  async function handleCreateJob() {
    if (!selectedImage || isComfyDisconnected || isCreatingJob) {
      return;
    }

    setIsCreatingJob(true);
    setErrorMessage(undefined);
    setModelUrl(undefined);
    setActivityMessage('正在建立 3D Job...');
    setJob(undefined);
    try {
      const created = await create3DJob(selectedImage.image_id);
      setJob({
        job_id: created.job_id,
        status: created.status,
        message: '3D generation job is queued.',
        prompt_id: null,
        result: null,
      });
      setActivityMessage('3D Job 已建立，正在等待後端處理。');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setActivityMessage(undefined);
    } finally {
      setIsCreatingJob(false);
    }
  }

  function handleSelectImage(image: ImageAsset) {
    setSelectedImageId(image.image_id);
    resetJobState();
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

      <ImageGallery images={images} selectedImageId={selectedImageId} onSelect={handleSelectImage} />

      <JobPanel
        selectedImage={selectedImage}
        job={job}
        modelUrl={modelUrl}
        isCreatingJob={isCreatingJob}
        isComfyDisconnected={isComfyDisconnected}
        error={errorMessage}
        onCreateJob={handleCreateJob}
      />
    </section>
  );
}
