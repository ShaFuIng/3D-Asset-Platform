import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  acceptMultiviewView,
  ApiClientError,
  create3DJob,
  createMultiviewJob,
  createMultiviewModelJob,
  generateImage as requestGenerateImage,
  get3DJob,
  getMultiviewJob,
  getMultiviewModelJob,
  regenerateMultiviewView,
  resolveApiUrl,
  uploadImage as requestUploadImage,
} from '../api/client';
import type { JobEntry } from '../components/JobPanel';
import type {
  ChatMessage,
  ImageAsset,
  JobStatus,
  MultiviewJobResponse,
  MultiviewModelJobResponse,
  MultiviewName,
} from '../types/api';
import {
  createMessageId,
  formatMessageTime,
  type ConversationMessage,
} from '../types/conversation';

export type Pipeline = 'single' | 'multiview';

export type MultiviewModelKind = 'geometry' | 'textured';

export type MultiviewWorkspace = {
  job: MultiviewJobResponse | null;
  modelJob: MultiviewModelJobResponse | null;
  activeModelKind: MultiviewModelKind;
  isStarting: boolean;
  isStartingModel: boolean;
  error: string | null;
};

const EMPTY_MULTIVIEW_WORKSPACE: MultiviewWorkspace = {
  job: null,
  modelJob: null,
  activeModelKind: 'textured',
  isStarting: false,
  isStartingModel: false,
  error: null,
};

const DEFAULT_JOB_ENTRY: JobEntry = { isCreatingJob: false };

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '發生未知錯誤。';
}

function isPendingStatus(status?: JobStatus): boolean {
  return status === 'queued' || status === 'running';
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

export type WorkspaceContextValue = {
  // Reference stage (prompt-to-image chat, upload, gallery selection).
  prompt: string;
  setPrompt: (value: string) => void;
  conversation: ConversationMessage[];
  images: ImageAsset[];
  selectedImageId?: string;
  activityMessage?: string;
  errorMessage?: string;
  isGenerating: boolean;
  isUploading: boolean;
  generateImage: () => Promise<void>;
  uploadImage: (file: File) => Promise<void>;
  selectImage: (image: ImageAsset) => void;

  // Pipeline choice per image. Pure UI state: setting it never calls an API.
  pipelineByImageId: Record<string, Pipeline>;
  setPipeline: (imageId: string, pipeline: Pipeline) => void;

  // Single-view pipeline: one active job entry per image.
  singleJobsByImageId: Record<string, JobEntry>;
  createSingleJob: (imageId: string) => Promise<void>;

  // Multiview pipeline: one isolated workspace per image.
  multiviewByImageId: Record<string, MultiviewWorkspace>;
  startMultiview: (imageId: string) => Promise<void>;
  acceptView: (imageId: string, view: MultiviewName) => Promise<void>;
  regenerateView: (imageId: string, view: MultiviewName) => Promise<void>;
  startModelJob: (imageId: string) => Promise<void>;
  setMultiviewModelKind: (imageId: string, kind: MultiviewModelKind) => void;

  // Reserved for the Phase 2 refresh warning; intentionally unused in Phase 1.
  hasActiveJobs: boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [previousResponseId, setPreviousResponseId] = useState<string>();
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>();
  const [activityMessage, setActivityMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [pipelineByImageId, setPipelineByImageId] = useState<Record<string, Pipeline>>({});
  const [singleJobsByImageId, setSingleJobsByImageId] = useState<Record<string, JobEntry>>({});
  const [multiviewByImageId, setMultiviewByImageId] = useState<Record<string, MultiviewWorkspace>>({});

  // In-flight locks: synchronous, render-cycle-independent guards against
  // double submission. The React busy states (isCreatingJob / isStarting /
  // isStartingModel) remain for UI display only and are never the sole
  // concurrency guard. Keys are per image (or per image+view), so operations
  // on different images or different views never block each other.
  const singleCreateLockRef = useRef<Set<string>>(new Set());
  const multiviewStartLockRef = useRef<Set<string>>(new Set());
  const modelStartLockRef = useRef<Set<string>>(new Set());
  const viewActionLockRef = useRef<Set<string>>(new Set());

  function updateSingleJobEntry(imageId: string, updater: (entry: JobEntry) => JobEntry) {
    setSingleJobsByImageId((current) => ({
      ...current,
      [imageId]: updater(current[imageId] ?? DEFAULT_JOB_ENTRY),
    }));
  }

  function updateMultiviewEntry(
    imageId: string,
    updater: (workspace: MultiviewWorkspace) => MultiviewWorkspace,
  ) {
    setMultiviewByImageId((current) => ({
      ...current,
      [imageId]: updater(current[imageId] ?? EMPTY_MULTIVIEW_WORKSPACE),
    }));
  }

  // Stale-response guards. An async response is only written when the entry
  // still exists AND its current job identity equals the identity captured
  // when the request was sent. Restarting a workspace clears/replaces the
  // job synchronously before any new POST returns, so a jobId mismatch also
  // covers the "new job POST not yet returned" window; responses from an old
  // job can never overwrite a fresh or reset entry.
  function updateSingleJobEntryIfJob(
    imageId: string,
    expectedJobId: string,
    updater: (entry: JobEntry) => JobEntry,
  ) {
    setSingleJobsByImageId((current) => {
      const entry = current[imageId];
      if (!entry || entry.job?.job_id !== expectedJobId) {
        return current;
      }
      return { ...current, [imageId]: updater(entry) };
    });
  }

  function updateMultiviewEntryIfJob(
    imageId: string,
    expectedJobId: string,
    updater: (workspace: MultiviewWorkspace) => MultiviewWorkspace,
  ) {
    setMultiviewByImageId((current) => {
      const workspace = current[imageId];
      if (!workspace || workspace.job?.jobId !== expectedJobId) {
        return current;
      }
      return { ...current, [imageId]: updater(workspace) };
    });
  }

  // ----- Polling: only jobs that already exist in state are polled. -----
  // Polling never creates jobs; create/accept/regenerate stay user-triggered.
  //
  // Error strategy mirrors the original single-job effect: a real (non-abort)
  // polling error stops polling for that one image only and records the error
  // on the entry, without rewriting the job status. Polling for that image
  // stays stopped until its derived pending key changes (job restarted, or
  // accept/regenerate returns a new snapshot), which re-creates the effect
  // with a fresh stillPolling set. Other images keep polling unaffected.

  // Derived key of pending single-view jobs, mirroring the previous
  // single-image polling effect's [job?.job_id, job?.status] dependency,
  // generalized to one entry per image. No longer gated on workspace mode,
  // so polling continues while the user looks at another view.
  const pendingSingleJobsKey = Object.entries(singleJobsByImageId)
    .filter(([, entry]) => entry.job && isPendingStatus(entry.job.status))
    .map(([imageId, entry]) => `${imageId}:${entry.job!.job_id}:${entry.job!.status}`)
    .join('|');

  useEffect(() => {
    const pendingImageIds = Object.entries(singleJobsByImageId)
      .filter(([, entry]) => entry.job && isPendingStatus(entry.job.status))
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
        const jobId = singleJobsByImageId[imageId]?.job?.job_id;
        if (!jobId) {
          return;
        }
        void get3DJob(jobId, controller.signal)
          .then((nextJob) => {
            if (!isActive) {
              return;
            }
            updateSingleJobEntryIfJob(imageId, jobId, (entry) => {
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
            if (message && stillPolling.has(imageId)) {
              stillPolling.delete(imageId);
              updateSingleJobEntryIfJob(imageId, jobId, (entry) => ({ ...entry, error: message }));
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
  }, [pendingSingleJobsKey]);

  const pendingMultiviewJobsKey = Object.entries(multiviewByImageId)
    .filter(([, workspace]) => workspace.job && isPendingStatus(workspace.job.status))
    .map(([imageId, workspace]) => `${imageId}:${workspace.job!.jobId}:${workspace.job!.status}`)
    .join('|');

  useEffect(() => {
    const pendingImageIds = Object.entries(multiviewByImageId)
      .filter(([, workspace]) => workspace.job && isPendingStatus(workspace.job.status))
      .map(([imageId]) => imageId);

    if (pendingImageIds.length === 0) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    const stillPolling = new Set(pendingImageIds);

    const timerId = window.setInterval(() => {
      stillPolling.forEach((imageId) => {
        const jobId = multiviewByImageId[imageId]?.job?.jobId;
        if (!jobId) {
          return;
        }
        void getMultiviewJob(jobId, controller.signal)
          .then((nextJob) => {
            if (!isActive) {
              return;
            }
            updateMultiviewEntryIfJob(imageId, jobId, (workspace) => ({ ...workspace, job: nextJob }));
          })
          .catch((error) => {
            if (!isActive) {
              return;
            }
            const message = getErrorMessage(error);
            if (message && stillPolling.has(imageId)) {
              stillPolling.delete(imageId);
              updateMultiviewEntryIfJob(imageId, jobId, (workspace) => ({ ...workspace, error: message }));
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
  }, [pendingMultiviewJobsKey]);

  const pendingModelJobsKey = Object.entries(multiviewByImageId)
    .filter(([, workspace]) => workspace.job && workspace.modelJob && isPendingStatus(workspace.modelJob.status))
    .map(([imageId, workspace]) => `${imageId}:${workspace.job!.jobId}:${workspace.modelJob!.status}`)
    .join('|');

  useEffect(() => {
    const pendingImageIds = Object.entries(multiviewByImageId)
      .filter(([, workspace]) => workspace.job && workspace.modelJob && isPendingStatus(workspace.modelJob.status))
      .map(([imageId]) => imageId);

    if (pendingImageIds.length === 0) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    const stillPolling = new Set(pendingImageIds);

    const timerId = window.setInterval(() => {
      stillPolling.forEach((imageId) => {
        const jobId = multiviewByImageId[imageId]?.job?.jobId;
        if (!jobId) {
          return;
        }
        void getMultiviewModelJob(jobId, controller.signal)
          .then((nextModelJob) => {
            if (!isActive) {
              return;
            }
            updateMultiviewEntryIfJob(imageId, jobId, (workspace) => ({
              ...workspace,
              modelJob: nextModelJob,
              activeModelKind: nextModelJob.texturedModel.available
                ? 'textured'
                : nextModelJob.geometryModel.available
                  ? 'geometry'
                  : workspace.activeModelKind,
            }));
          })
          .catch((error) => {
            if (!isActive) {
              return;
            }
            const message = getErrorMessage(error);
            if (message && stillPolling.has(imageId)) {
              stillPolling.delete(imageId);
              updateMultiviewEntryIfJob(imageId, jobId, (workspace) => ({ ...workspace, error: message }));
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
  }, [pendingModelJobsKey]);

  // ----- User-triggered actions (reference stage) -----

  function addAndSelectImage(image: ImageAsset) {
    setImages((current) => [image, ...current]);
    setSelectedImageId(image.image_id);
  }

  function selectImage(image: ImageAsset) {
    setSelectedImageId(image.image_id);
  }

  async function generateImage() {
    const content = prompt.trim();
    if (!content || isGenerating) {
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
      const data = await requestGenerateImage(requestMessages, previousResponseId);
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

  async function uploadImage(file: File) {
    if (isUploading) {
      return;
    }

    setIsUploading(true);
    setErrorMessage(undefined);
    setActivityMessage('正在上傳圖片...');
    try {
      const data = await requestUploadImage(file);
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

  // ----- User-triggered actions (pipelines) -----

  function setPipeline(imageId: string, pipeline: Pipeline) {
    setPipelineByImageId((current) => ({ ...current, [imageId]: pipeline }));
  }

  async function createSingleJob(imageId: string) {
    const lock = singleCreateLockRef.current;
    if (singleJobsByImageId[imageId]?.isCreatingJob || lock.has(imageId)) {
      return;
    }
    lock.add(imageId);

    updateSingleJobEntry(imageId, () => ({ isCreatingJob: true }));

    try {
      const created = await create3DJob(imageId);
      updateSingleJobEntry(imageId, () => ({
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
      updateSingleJobEntry(imageId, () => ({ isCreatingJob: false, error: getErrorMessage(error) }));
    } finally {
      lock.delete(imageId);
    }
  }

  async function startMultiview(imageId: string) {
    const lock = multiviewStartLockRef.current;
    if (lock.has(imageId)) {
      return;
    }
    const existing = multiviewByImageId[imageId];
    if (existing?.isStarting) {
      return;
    }
    // Never replace a workspace whose views job or model job is still
    // queued/running. Restarting a finished/failed workspace keeps the
    // previous reset behavior; an overwrite confirmation arrives in Phase 2.
    if (isPendingStatus(existing?.job?.status) || isPendingStatus(existing?.modelJob?.status)) {
      return;
    }
    lock.add(imageId);

    setMultiviewByImageId((current) => ({
      ...current,
      [imageId]: { ...EMPTY_MULTIVIEW_WORKSPACE, isStarting: true },
    }));

    try {
      const created = await createMultiviewJob(imageId);
      const nextJob = await getMultiviewJob(created.jobId);
      // Start-attempt guard: the entry was reset to job: null before the
      // POST, so a jobId-equality check can never match here. The start lock
      // guarantees no second start for this imageId can begin while this one
      // is in flight, so isStarting === true is sufficient proof that this
      // response still belongs to the current attempt.
      setMultiviewByImageId((current) => {
        const workspace = current[imageId];
        if (!workspace?.isStarting) {
          return current;
        }
        return { ...current, [imageId]: { ...workspace, isStarting: false, job: nextJob } };
      });
    } catch (error) {
      // Only surface the error if this start is still the current attempt.
      setMultiviewByImageId((current) => {
        const workspace = current[imageId];
        if (!workspace?.isStarting) {
          return current;
        }
        return { ...current, [imageId]: { ...workspace, isStarting: false, error: getErrorMessage(error) } };
      });
    } finally {
      lock.delete(imageId);
    }
  }

  async function acceptView(imageId: string, view: MultiviewName) {
    const lockKey = `${imageId}:${view}`;
    const lock = viewActionLockRef.current;
    const job = multiviewByImageId[imageId]?.job;
    if (!job || lock.has(lockKey)) {
      return;
    }
    lock.add(lockKey);

    const expectedJobId = job.jobId;
    updateMultiviewEntry(imageId, (workspace) => ({ ...workspace, error: null }));
    try {
      const nextJob = await acceptMultiviewView(expectedJobId, view);
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({ ...workspace, job: nextJob }));
    } catch (error) {
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({
        ...workspace,
        error: getErrorMessage(error),
      }));
    } finally {
      lock.delete(lockKey);
    }
  }

  async function regenerateView(imageId: string, view: MultiviewName) {
    const lockKey = `${imageId}:${view}`;
    const lock = viewActionLockRef.current;
    const job = multiviewByImageId[imageId]?.job;
    if (!job || lock.has(lockKey)) {
      return;
    }
    lock.add(lockKey);

    const expectedJobId = job.jobId;
    updateMultiviewEntry(imageId, (workspace) => ({ ...workspace, error: null }));
    try {
      const nextJob = await regenerateMultiviewView(expectedJobId, view);
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({ ...workspace, job: nextJob }));
    } catch (error) {
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({
        ...workspace,
        error: getErrorMessage(error),
      }));
    } finally {
      lock.delete(lockKey);
    }
  }

  async function startModelJob(imageId: string) {
    const lock = modelStartLockRef.current;
    if (lock.has(imageId)) {
      return;
    }
    const existing = multiviewByImageId[imageId];
    const job = existing?.job;
    if (!job || existing?.isStartingModel || isPendingStatus(existing?.modelJob?.status)) {
      return;
    }
    lock.add(imageId);

    const expectedJobId = job.jobId;
    updateMultiviewEntry(imageId, (workspace) => ({ ...workspace, isStartingModel: true, error: null }));
    try {
      const modelJob = await createMultiviewModelJob(expectedJobId);
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({
        ...workspace,
        isStartingModel: false,
        modelJob,
      }));
    } catch (error) {
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({
        ...workspace,
        isStartingModel: false,
        error: getErrorMessage(error),
      }));
    } finally {
      lock.delete(imageId);
    }
  }

  function setMultiviewModelKind(imageId: string, kind: MultiviewModelKind) {
    updateMultiviewEntry(imageId, (workspace) => ({ ...workspace, activeModelKind: kind }));
  }

  const hasActiveJobs =
    Object.values(singleJobsByImageId).some((entry) => entry.job && isPendingStatus(entry.job.status)) ||
    Object.values(multiviewByImageId).some(
      (workspace) => isPendingStatus(workspace.job?.status) || isPendingStatus(workspace.modelJob?.status),
    );

  const value: WorkspaceContextValue = {
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
    multiviewByImageId,
    startMultiview,
    acceptView,
    regenerateView,
    startModelJob,
    setMultiviewModelKind,
    hasActiveJobs,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider.');
  }
  return context;
}
