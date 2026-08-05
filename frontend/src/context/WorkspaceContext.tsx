import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  acceptMultiviewView,
  ApiClientError,
  create3DJob,
  createMultiviewJob,
  createMultiviewModelJob,
  editImage as requestEditImage,
  generateImage as requestGenerateImage,
  get3DJob,
  getMultiviewJob,
  getMultiviewModelJob,
  regenerateMultiviewView,
  resolveApiUrl,
  setMultiviewViewCandidate,
  uploadImage as requestUploadImage,
} from '../api/client';
import type {
  ChatMessage,
  ImageAsset,
  JobResponse,
  JobStatus,
  MultiviewJobResponse,
  MultiviewModelJobResponse,
  MultiviewName,
  RegenerateMultiviewViewRequest,
  RegenerateStrategy,
} from '../types/api';
import {
  createMessageId,
  formatMessageTime,
  type ConversationMessage,
} from '../types/conversation';

export type Pipeline = 'single' | 'multiview';

// Per-image single-view job state. Defined here (not in a presentational
// component) because the provider owns it.
export type JobEntry = {
  job?: JobResponse;
  modelUrl?: string;
  isCreatingJob: boolean;
  error?: string;
};

export type MultiviewModelKind = 'geometry' | 'textured';

// Tracks user-triggered per-view actions currently in flight, so view cards
// can show their own loading state. The ref-based locks stay the real
// concurrency guard; this field is display-only.
export type PendingViewAction = 'accept' | 'set_candidate' | RegenerateStrategy;
export type PendingViewActions = Partial<Record<MultiviewName, PendingViewAction>>;

export type ViewCandidateResult = {
  ok: boolean;
  error: string | null;
};

export type MultiviewWorkspace = {
  job: MultiviewJobResponse | null;
  modelJob: MultiviewModelJobResponse | null;
  activeModelKind: MultiviewModelKind;
  isStarting: boolean;
  isStartingModel: boolean;
  error: string | null;
  pendingViewActions: PendingViewActions;
};

const EMPTY_MULTIVIEW_WORKSPACE: MultiviewWorkspace = {
  job: null,
  modelJob: null,
  activeModelKind: 'textured',
  isStarting: false,
  isStartingModel: false,
  error: null,
  pendingViewActions: {},
};

const DEFAULT_JOB_ENTRY: JobEntry = { isCreatingJob: false };
const MULTIVIEW_ORDER: MultiviewName[] = ['front', 'left', 'back'];

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

function hasPendingMultiviewJob(workspace: MultiviewWorkspace): boolean {
  if (!workspace.job) {
    return false;
  }
  return (
    isPendingStatus(workspace.job.status) ||
    MULTIVIEW_ORDER.some((view) => isPendingStatus(workspace.job?.views[view].status))
  );
}

function getMultiviewPollingKey(imageId: string, workspace: MultiviewWorkspace): string {
  const job = workspace.job;
  if (!job) {
    return '';
  }
  const viewStatuses = MULTIVIEW_ORDER.map((view) => job.views[view].status).join(':');
  return `${imageId}:${job.jobId}:${job.status}:${viewStatuses}`;
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
  archivedImageIds: Record<string, true>;
  editingImageIds: Record<string, true>;
  imageEditErrors: Record<string, string>;
  editPromptByImageId: Record<string, string>;
  generateImage: () => Promise<void>;
  uploadImage: (file: File) => Promise<void>;
  selectImage: (image: ImageAsset) => void;
  startNewConversation: () => void;
  archiveImage: (imageId: string) => void;
  restoreImage: (imageId: string) => void;
  importLibraryImageAsReference: (image: ImageAsset) => void;
  forgetWorkspaceImage: (imageId: string) => void;
  setEditPrompt: (imageId: string, value: string) => void;
  editImage: (sourceImageId: string, prompt: string) => Promise<ImageAsset | undefined>;

  // Pipeline choice per image. Pure UI state: setting it never calls an API.
  pipelineByImageId: Record<string, Pipeline>;
  setPipeline: (imageId: string, pipeline: Pipeline) => void;

  // Single-view pipeline: one active job entry per image. Resolves to the
  // created job_id so callers can navigate to the job route.
  singleJobsByImageId: Record<string, JobEntry>;
  createSingleJob: (imageId: string) => Promise<string | undefined>;

  // Multiview pipeline: one isolated workspace per image.
  multiviewByImageId: Record<string, MultiviewWorkspace>;
  startMultiview: (imageId: string) => Promise<void>;
  acceptView: (imageId: string, view: MultiviewName) => Promise<void>;
  setViewCandidate: (
    imageId: string,
    view: MultiviewName,
    versionImageId: string,
  ) => Promise<ViewCandidateResult>;
  regenerateView: (
    imageId: string,
    view: MultiviewName,
    strategy: RegenerateStrategy,
    instruction?: string,
  ) => Promise<void>;
  multiviewEditDrafts: Record<string, string>;
  setMultiviewEditDraft: (jobId: string, view: MultiviewName, value: string) => void;
  startModelJob: (imageId: string) => Promise<boolean>;
  setMultiviewModelKind: (imageId: string, kind: MultiviewModelKind) => void;

  // User-triggered one-shot status refresh. Complements polling (which stops
  // for an image after a real error); never creates or alters jobs.
  refreshJobStatus: (pipeline: Pipeline, jobId: string) => Promise<void>;

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
  const [archivedImageIds, setArchivedImageIds] = useState<Record<string, true>>({});
  const [editingImageIds, setEditingImageIds] = useState<Record<string, true>>({});
  const [imageEditErrors, setImageEditErrors] = useState<Record<string, string>>({});
  const [editPromptByImageId, setEditPromptByImageId] = useState<Record<string, string>>({});

  const [pipelineByImageId, setPipelineByImageId] = useState<Record<string, Pipeline>>({});
  const [singleJobsByImageId, setSingleJobsByImageId] = useState<Record<string, JobEntry>>({});
  const [multiviewByImageId, setMultiviewByImageId] = useState<Record<string, MultiviewWorkspace>>({});
  const [multiviewEditDrafts, setMultiviewEditDrafts] = useState<Record<string, string>>({});

  // In-flight locks: synchronous, render-cycle-independent guards against
  // double submission. The React busy states (isCreatingJob / isStarting /
  // isStartingModel) remain for UI display only and are never the sole
  // concurrency guard. Keys are per image (or per image+view), so operations
  // on different images or different views never block each other.
  const singleCreateLockRef = useRef<Set<string>>(new Set());
  const multiviewStartLockRef = useRef<Set<string>>(new Set());
  const modelStartLockRef = useRef<Set<string>>(new Set());
  const viewActionLockRef = useRef<Set<string>>(new Set());
  const imageEditLockRef = useRef<Set<string>>(new Set());

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

  function getMultiviewEditDraftKey(jobId: string, view: MultiviewName): string {
    return `${jobId}:${view}`;
  }

  function setMultiviewEditDraft(jobId: string, view: MultiviewName, value: string) {
    setMultiviewEditDrafts((current) => ({
      ...current,
      [getMultiviewEditDraftKey(jobId, view)]: value,
    }));
  }

  // Display-only per-view pending flag (the real concurrency guard is the
  // view action lock above).
  function setViewActionPending(imageId: string, view: MultiviewName, action?: PendingViewAction) {
    updateMultiviewEntry(imageId, (workspace) => {
      const next: PendingViewActions = { ...workspace.pendingViewActions };
      if (action) {
        next[view] = action;
      } else {
        delete next[view];
      }
      return { ...workspace, pendingViewActions: next };
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
    .filter(([, workspace]) => hasPendingMultiviewJob(workspace))
    .map(([imageId, workspace]) => getMultiviewPollingKey(imageId, workspace))
    .join('|');

  useEffect(() => {
    const pendingImageIds = Object.entries(multiviewByImageId)
      .filter(([, workspace]) => hasPendingMultiviewJob(workspace))
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

  function startNewConversation() {
    if (isGenerating) {
      return;
    }
    setConversation([]);
    setPreviousResponseId(undefined);
    setPrompt('');
    setActivityMessage(undefined);
    setErrorMessage(undefined);
  }

  function archiveImage(imageId: string) {
    setArchivedImageIds((current) => ({ ...current, [imageId]: true }));
    setSelectedImageId((current) => {
      if (current !== imageId) {
        return current;
      }
      return images.find((image) => image.image_id !== imageId && !archivedImageIds[image.image_id])?.image_id;
    });
  }

  function restoreImage(imageId: string) {
    setArchivedImageIds((current) => {
      if (!current[imageId]) {
        return current;
      }
      const next = { ...current };
      delete next[imageId];
      return next;
    });
  }

  function importLibraryImageAsReference(image: ImageAsset) {
    setImages((current) => {
      if (current.some((item) => item.image_id === image.image_id)) {
        return current;
      }
      return [image, ...current];
    });
    setSelectedImageId(image.image_id);
  }

  function forgetWorkspaceImage(imageId: string) {
    setImages((current) => current.filter((image) => image.image_id !== imageId));
    setSelectedImageId((current) => {
      if (current !== imageId) {
        return current;
      }
      return images.find((image) => image.image_id !== imageId && !archivedImageIds[image.image_id])?.image_id;
    });
    setArchivedImageIds((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    setEditPromptByImageId((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    setImageEditErrors((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    setEditingImageIds((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    setPipelineByImageId((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    setSingleJobsByImageId((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    setMultiviewByImageId((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
  }

  function setEditPrompt(imageId: string, value: string) {
    setEditPromptByImageId((current) => ({ ...current, [imageId]: value }));
  }

  async function editImage(sourceImageId: string, editPrompt: string): Promise<ImageAsset | undefined> {
    const content = editPrompt.trim();
    const lock = imageEditLockRef.current;
    if (!content || lock.has(sourceImageId) || !images.some((image) => image.image_id === sourceImageId)) {
      return undefined;
    }
    lock.add(sourceImageId);
    setEditingImageIds((current) => ({ ...current, [sourceImageId]: true }));
    setImageEditErrors((current) => {
      if (!current[sourceImageId]) {
        return current;
      }
      const next = { ...current };
      delete next[sourceImageId];
      return next;
    });

    try {
      const data = await requestEditImage(sourceImageId, content);
      const image: ImageAsset = {
        ...data,
        source: 'edited',
        parentImageId: data.parentImageId,
      };
      addAndSelectImage(image);
      setEditPromptByImageId((current) => {
        if (!current[sourceImageId]) {
          return current;
        }
        const next = { ...current };
        delete next[sourceImageId];
        return next;
      });
      return image;
    } catch (error) {
      const message = getErrorMessage(error);
      setImageEditErrors((current) => ({ ...current, [sourceImageId]: message }));
      return undefined;
    } finally {
      lock.delete(sourceImageId);
      setEditingImageIds((current) => {
        if (!current[sourceImageId]) {
          return current;
        }
        const next = { ...current };
        delete next[sourceImageId];
        return next;
      });
    }
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

  async function createSingleJob(imageId: string): Promise<string | undefined> {
    const lock = singleCreateLockRef.current;
    if (singleJobsByImageId[imageId]?.isCreatingJob || lock.has(imageId)) {
      return undefined;
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
      return created.job_id;
    } catch (error) {
      updateSingleJobEntry(imageId, () => ({ isCreatingJob: false, error: getErrorMessage(error) }));
      return undefined;
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
    const lock = viewActionLockRef.current;
    const job = multiviewByImageId[imageId]?.job;
    const lockKey = job ? `${imageId}:${job.jobId}:${view}` : `${imageId}:${view}`;
    if (!job || lock.has(lockKey)) {
      return;
    }
    lock.add(lockKey);
    setViewActionPending(imageId, view, 'accept');

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
      setViewActionPending(imageId, view);
    }
  }

  async function setViewCandidate(
    imageId: string,
    view: MultiviewName,
    versionImageId: string,
  ): Promise<ViewCandidateResult> {
    const lock = viewActionLockRef.current;
    const job = multiviewByImageId[imageId]?.job;
    const lockKey = job ? `${imageId}:${job.jobId}:${view}` : `${imageId}:${view}`;
    if (!job || lock.has(lockKey) || isPendingStatus(job.status) || isPendingStatus(job.views[view].status)) {
      return { ok: false, error: null };
    }
    lock.add(lockKey);
    setViewActionPending(imageId, view, 'set_candidate');

    const expectedJobId = job.jobId;
    updateMultiviewEntry(imageId, (workspace) => ({ ...workspace, error: null }));
    try {
      const nextJob = await setMultiviewViewCandidate(expectedJobId, view, versionImageId);
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({ ...workspace, job: nextJob }));
      return { ok: true, error: null };
    } catch (error) {
      const message = getErrorMessage(error);
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({
        ...workspace,
        error: message,
      }));
      return { ok: false, error: message };
    } finally {
      lock.delete(lockKey);
      setViewActionPending(imageId, view);
    }
  }

  async function regenerateView(
    imageId: string,
    view: MultiviewName,
    strategy: RegenerateStrategy,
    instruction?: string,
  ) {
    const lock = viewActionLockRef.current;
    const job = multiviewByImageId[imageId]?.job;
    const lockKey = job ? `${imageId}:${job.jobId}:${view}` : `${imageId}:${view}`;
    if (!job || lock.has(lockKey)) {
      return;
    }
    const content = instruction?.trim() ?? '';
    if (strategy === 'openai_edit' && !content) {
      return;
    }
    const payload: RegenerateMultiviewViewRequest =
      strategy === 'local_reroll'
        ? { strategy: 'local_reroll' }
        : { strategy: 'openai_edit', instruction: content };
    lock.add(lockKey);
    setViewActionPending(imageId, view, strategy);

    const expectedJobId = job.jobId;
    updateMultiviewEntry(imageId, (workspace) => ({ ...workspace, error: null }));
    try {
      const nextJob = await regenerateMultiviewView(expectedJobId, view, payload);
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({ ...workspace, job: nextJob }));
    } catch (error) {
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({
        ...workspace,
        error: getErrorMessage(error),
      }));
    } finally {
      lock.delete(lockKey);
      setViewActionPending(imageId, view);
    }
  }

  async function startModelJob(imageId: string): Promise<boolean> {
    const lock = modelStartLockRef.current;
    if (lock.has(imageId)) {
      return false;
    }
    const existing = multiviewByImageId[imageId];
    const job = existing?.job;
    if (!job || existing?.isStartingModel || isPendingStatus(existing?.modelJob?.status)) {
      return false;
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
      return true;
    } catch (error) {
      updateMultiviewEntryIfJob(imageId, expectedJobId, (workspace) => ({
        ...workspace,
        isStartingModel: false,
        error: getErrorMessage(error),
      }));
      return false;
    } finally {
      lock.delete(imageId);
    }
  }

  async function refreshJobStatus(pipeline: Pipeline, jobId: string): Promise<void> {
    if (pipeline === 'single') {
      const imageId = Object.keys(singleJobsByImageId).find(
        (id) => singleJobsByImageId[id]?.job?.job_id === jobId,
      );
      if (!imageId) {
        return;
      }
      const nextJob = await get3DJob(jobId);
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
      return;
    }

    const imageId = Object.keys(multiviewByImageId).find(
      (id) => multiviewByImageId[id]?.job?.jobId === jobId,
    );
    if (!imageId) {
      return;
    }
    const nextJob = await getMultiviewJob(jobId);
    updateMultiviewEntryIfJob(imageId, jobId, (workspace) => ({ ...workspace, job: nextJob }));
    if (multiviewByImageId[imageId]?.modelJob) {
      const nextModelJob = await getMultiviewModelJob(jobId);
      updateMultiviewEntryIfJob(imageId, jobId, (workspace) => ({
        ...workspace,
        modelJob: nextModelJob,
        activeModelKind: nextModelJob.texturedModel.available
          ? 'textured'
          : nextModelJob.geometryModel.available
            ? 'geometry'
            : workspace.activeModelKind,
      }));
    }
  }

  function setMultiviewModelKind(imageId: string, kind: MultiviewModelKind) {
    updateMultiviewEntry(imageId, (workspace) => ({ ...workspace, activeModelKind: kind }));
  }

  const hasActiveJobs =
    Object.values(singleJobsByImageId).some((entry) => entry.job && isPendingStatus(entry.job.status)) ||
    Object.values(multiviewByImageId).some(
      (workspace) => hasPendingMultiviewJob(workspace) || isPendingStatus(workspace.modelJob?.status),
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
    importLibraryImageAsReference,
    forgetWorkspaceImage,
    setEditPrompt,
    editImage,
    pipelineByImageId,
    setPipeline,
    singleJobsByImageId,
    createSingleJob,
    multiviewByImageId,
    startMultiview,
    acceptView,
    setViewCandidate,
    regenerateView,
    multiviewEditDrafts,
    setMultiviewEditDraft,
    startModelJob,
    setMultiviewModelKind,
    refreshJobStatus,
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
