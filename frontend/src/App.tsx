import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiClientError,
  create3DJob,
  generateImage,
  get3DJob,
  getBackendHealth,
  getComfyHealth,
  getOpenAIHealth,
  resolveApiUrl,
  uploadImage,
} from './api/client';
import { ImageGallery } from './components/ImageGallery';
import { JobPanel } from './components/JobPanel';
import { PromptComposer } from './components/PromptComposer';
import { ServiceStatusPanel } from './components/ServiceStatusPanel';
import type { ImageAsset, JobResponse, ServiceHealthState } from './types/api';

const checkingState: ServiceHealthState = { status: 'checking' };

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '發生未知錯誤。';
}

export default function App() {
  const [backend, setBackend] = useState<ServiceHealthState>(checkingState);
  const [openai, setOpenai] = useState<ServiceHealthState>(checkingState);
  const [comfy, setComfy] = useState<ServiceHealthState>(checkingState);
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>();
  const [assistantMessage, setAssistantMessage] = useState<string>();
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
      ? 'Checking OpenAI configuration...'
      : 'OpenAI API key is not configured. You can still upload a local image.';

  useEffect(() => {
    const controller = new AbortController();

    void getBackendHealth(controller.signal)
      .then((data) => setBackend({ status: data.status, message: data.message }))
      .catch((error) => {
        const message = getErrorMessage(error);
        if (message) setBackend({ status: 'disconnected', message });
      });

    void getOpenAIHealth(controller.signal)
      .then((data) => setOpenai({ status: data.status, message: data.message }))
      .catch((error) => {
        const message = getErrorMessage(error);
        if (message) setOpenai({ status: 'disconnected', message });
      });

    void getComfyHealth(controller.signal)
      .then((data) => setComfy({ status: data.status, message: data.message }))
      .catch((error) => {
        const message = getErrorMessage(error);
        if (message) setComfy({ status: 'disconnected', message });
      });

    return () => controller.abort();
  }, []);

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
            setActivityMessage('3D model generation completed.');
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
    if (!content || isOpenAIDisabled) {
      return;
    }

    setIsGenerating(true);
    setErrorMessage(undefined);
    setActivityMessage('Generating image...');
    try {
      const data = await generateImage([{ role: 'user', content }]);
      addAndSelectImage({ ...data, source: 'generated' });
      setAssistantMessage(data.assistant_message);
      setPrompt('');
      setActivityMessage('Image generated.');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setActivityMessage(undefined);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleUploadImage(file: File) {
    setIsUploading(true);
    setErrorMessage(undefined);
    setActivityMessage('Uploading image...');
    try {
      const data = await uploadImage(file);
      addAndSelectImage({ ...data, source: 'uploaded' });
      setAssistantMessage(undefined);
      setActivityMessage('Image uploaded.');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setActivityMessage(undefined);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleCreateJob() {
    if (!selectedImage || isComfyDisconnected) {
      return;
    }

    setIsCreatingJob(true);
    setErrorMessage(undefined);
    setModelUrl(undefined);
    setActivityMessage('Creating 3D job...');
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
      setActivityMessage('3D job created. Waiting for progress...');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setActivityMessage(undefined);
    } finally {
      setIsCreatingJob(false);
    }
  }

  function handleSelectImage(image: ImageAsset) {
    setSelectedImageId(image.image_id);
    setAssistantMessage(image.assistant_message);
    resetJobState();
  }

  return (
    <main className="app">
      <ServiceStatusPanel backend={backend} openai={openai} comfy={comfy} />

      <section className="workspace">
        <div className="workspace-column">
          <PromptComposer
            prompt={prompt}
            isGenerating={isGenerating}
            isDisabled={isOpenAIDisabled}
            disabledReason={openaiDisabledReason}
            onPromptChange={setPrompt}
            onSubmit={handleGenerateImage}
            onUpload={handleUploadImage}
          />

          {(activityMessage || errorMessage || assistantMessage || isUploading) && (
            <section className="panel feedback-panel">
              {isUploading && <p className="hint">Uploading image...</p>}
              {activityMessage && <p className="hint success">{activityMessage}</p>}
              {assistantMessage && <p className="assistant-message">{assistantMessage}</p>}
              {errorMessage && <p className="hint error">{errorMessage}</p>}
            </section>
          )}
        </div>

        <ImageGallery
          images={images}
          selectedImageId={selectedImageId}
          onSelect={handleSelectImage}
        />

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
    </main>
  );
}
