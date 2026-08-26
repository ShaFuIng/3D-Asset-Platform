import type {
  ApiErrorBody,
  BackendHealthResponse,
  ChatMessage,
  ComfyHealthResponse,
  Create3DJobResponse,
  CreateMultiviewJobResponse,
  DeleteLibraryAssetResponse,
  EditImageResponse,
  GenerateImageResponse,
  JobResponse,
  LibraryAsset,
  LibraryAssetListResponse,
  LibraryAssetQuery,
  MultiviewJobResponse,
  MultiviewModelJobResponse,
  MultiviewName,
  OpenAIHealthResponse,
  RegenerateMultiviewViewRequest,
  UploadImageResponse,
} from '../types/api';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

export class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}

export function resolveApiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const base = apiBaseUrl.replace(/\/+$/, '');
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

export async function getBackendHealth(signal?: AbortSignal): Promise<BackendHealthResponse> {
  return requestJson('/api/health', { signal });
}

export async function getOpenAIHealth(signal?: AbortSignal): Promise<OpenAIHealthResponse> {
  return requestJson('/api/openai/health', { signal });
}

export async function getComfyHealth(signal?: AbortSignal): Promise<ComfyHealthResponse> {
  return requestJson('/api/comfy/health', { signal });
}

export async function generateImage(
  messages: ChatMessage[],
  previousResponseId?: string,
  signal?: AbortSignal,
): Promise<GenerateImageResponse> {
  return requestJson('/api/images/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      previous_response_id: previousResponseId,
    }),
    signal,
  });
}

export async function uploadImage(file: File, signal?: AbortSignal): Promise<UploadImageResponse> {
  const form = new FormData();
  form.append('image', file);
  return requestJson('/api/images/upload', {
    method: 'POST',
    body: form,
    signal,
  });
}

export async function editImage(
  sourceImageId: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<EditImageResponse> {
  const data = await requestJson<EditImageResponseBody>(
    `/api/images/${encodeURIComponent(sourceImageId)}/edits`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal,
    },
  );
  return {
    image_id: data.image_id,
    filename: data.filename,
    url: data.url,
    source: data.source,
    parentImageId: data.parent_image_id,
    assistant_message: data.assistant_message,
    image_prompt: data.image_prompt,
    response_id: data.response_id,
  };
}

export async function create3DJob(
  imageId: string,
  signal?: AbortSignal,
): Promise<Create3DJobResponse> {
  return requestJson('/api/3d/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId }),
    signal,
  });
}

export async function get3DJob(jobId: string, signal?: AbortSignal): Promise<JobResponse> {
  return requestJson(`/api/3d/jobs/${jobId}`, { signal });
}

export async function createMultiviewJob(
  referenceImageId: string,
  signal?: AbortSignal,
): Promise<CreateMultiviewJobResponse> {
  const data = await requestJson<CreateMultiviewJobResponseBody>('/api/multiview/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference_image_id: referenceImageId, provider: 'local' }),
    signal,
  });
  return toCreateMultiviewJob(data);
}

export async function getMultiviewJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<MultiviewJobResponse> {
  const data = await requestJson<MultiviewJobResponseBody>(`/api/multiview/jobs/${jobId}`, {
    signal,
  });
  return toMultiviewJob(data);
}

export async function acceptMultiviewView(
  jobId: string,
  view: MultiviewName,
  signal?: AbortSignal,
): Promise<MultiviewJobResponse> {
  const data = await requestJson<MultiviewJobResponseBody>(
    `/api/multiview/jobs/${encodeURIComponent(jobId)}/views/${encodeURIComponent(view)}/accept`,
    { method: 'POST', signal },
  );
  return toMultiviewJob(data);
}

export async function setMultiviewViewCandidate(
  jobId: string,
  view: MultiviewName,
  imageId: string,
  signal?: AbortSignal,
): Promise<MultiviewJobResponse> {
  const data = await requestJson<MultiviewJobResponseBody>(
    `/api/multiview/jobs/${encodeURIComponent(jobId)}/views/${encodeURIComponent(view)}/candidate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId }),
      signal,
    },
  );
  return toMultiviewJob(data);
}

export async function regenerateMultiviewView(
  jobId: string,
  view: MultiviewName,
  payload: RegenerateMultiviewViewRequest,
  signal?: AbortSignal,
): Promise<MultiviewJobResponse> {
  const data = await requestJson<MultiviewJobResponseBody>(
    `/api/multiview/jobs/${encodeURIComponent(jobId)}/views/${encodeURIComponent(view)}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
  return toMultiviewJob(data);
}

export async function createMultiviewModelJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<MultiviewModelJobResponse> {
  const data = await requestJson<MultiviewModelJobResponseBody>(
    `/api/multiview/jobs/${jobId}/model-job`,
    { method: 'POST', signal },
  );
  return toMultiviewModelJob(data);
}

export async function getMultiviewModelJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<MultiviewModelJobResponse> {
  const data = await requestJson<MultiviewModelJobResponseBody>(
    `/api/multiview/jobs/${jobId}/model-job`,
    { signal },
  );
  return toMultiviewModelJob(data);
}

export async function getLibraryAssets(
  query: LibraryAssetQuery = {},
  signal?: AbortSignal,
): Promise<LibraryAssetListResponse> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  const suffix = params.toString();
  return requestJson(`/api/library/assets${suffix ? `?${suffix}` : ''}`, { signal });
}

export async function getLibraryAsset(assetId: string, signal?: AbortSignal): Promise<LibraryAsset> {
  return requestJson(`/api/library/assets/${encodeURIComponent(assetId)}`, { signal });
}

export async function trashLibraryAsset(assetId: string, signal?: AbortSignal): Promise<LibraryAsset> {
  return requestJson(`/api/library/assets/${encodeURIComponent(assetId)}/trash`, {
    method: 'POST',
    signal,
  });
}

export async function restoreLibraryAsset(assetId: string, signal?: AbortSignal): Promise<LibraryAsset> {
  return requestJson(`/api/library/assets/${encodeURIComponent(assetId)}/restore`, {
    method: 'POST',
    signal,
  });
}

export async function calibrateAsset(
  assetId: string,
  targetMaxDimensionCm: number,
  signal?: AbortSignal,
): Promise<LibraryAsset> {
  return requestJson(`/api/library/assets/${encodeURIComponent(assetId)}/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_max_dimension_cm: targetMaxDimensionCm }),
    signal,
  });
}

export async function deleteLibraryAsset(
  assetId: string,
  signal?: AbortSignal,
): Promise<DeleteLibraryAssetResponse> {
  return requestJson(`/api/library/assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
    signal,
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiClientError('無法連線到 API 服務。', 0);
  }

  const data = await readJson<ApiErrorBody | T>(response);
  if (!response.ok) {
    const body = data as ApiErrorBody;
    throw new ApiClientError(
      body.error?.message ?? response.statusText ?? 'API request failed.',
      response.status,
    );
  }

  return data as T;
}

type MultiviewImageRefBody = {
  image_id: string;
  filename: string;
  url: string;
};

type EditImageResponseBody = {
  image_id: string;
  filename: string;
  url: string;
  source: 'edited';
  parent_image_id: string;
  assistant_message: string;
  image_prompt: string | null;
  response_id: string;
};

type MultiviewSlotBody = {
  status: JobResponse['status'];
  current_image: MultiviewImageRefBody | null;
  candidate_image: MultiviewImageRefBody | null;
  accepted: boolean;
  error: string | null;
  provider: 'local';
  versions: MultiviewViewVersionBody[];
};

type MultiviewViewVersionBody = {
  image: MultiviewImageRefBody;
  strategy: 'initial' | 'local_reroll' | 'openai_edit';
  created_at: string;
  is_current: boolean;
  is_candidate: boolean;
  available: boolean;
  state: 'active' | 'trash' | 'missing';
};

type CreateMultiviewJobResponseBody = {
  job_id: string;
  status: JobResponse['status'];
  provider: 'local';
  status_url: string;
};

type MultiviewJobResponseBody = {
  job_id: string;
  status: JobResponse['status'];
  message: string;
  provider: 'local';
  prompt_id: string | null;
  reference_image: MultiviewImageRefBody;
  views: Record<MultiviewName, MultiviewSlotBody>;
};

type MultiviewModelJobResponseBody = {
  status: JobResponse['status'];
  message: string;
  prompt_id: string | null;
  geometry_model: {
    available: boolean;
    download_url: string | null;
    asset_id: string | null;
  };
  textured_model: {
    available: boolean;
    download_url: string | null;
    asset_id: string | null;
  };
};

function toImageRef(image: MultiviewImageRefBody) {
  return {
    imageId: image.image_id,
    filename: image.filename,
    url: image.url,
  };
}

function toCreateMultiviewJob(data: CreateMultiviewJobResponseBody): CreateMultiviewJobResponse {
  return {
    jobId: data.job_id,
    status: data.status,
    provider: data.provider,
    statusUrl: data.status_url,
  };
}

function toMultiviewJob(data: MultiviewJobResponseBody): MultiviewJobResponse {
  return {
    jobId: data.job_id,
    status: data.status,
    message: data.message,
    provider: data.provider,
    promptId: data.prompt_id,
    referenceImage: toImageRef(data.reference_image),
    views: {
      front: toSlot('front', data.views.front),
      left: toSlot('left', data.views.left),
      back: toSlot('back', data.views.back),
    },
  };
}

function toSlot(view: MultiviewName, slot: MultiviewSlotBody) {
  return {
    view,
    status: slot.status,
    currentImage: slot.current_image ? toImageRef(slot.current_image) : null,
    candidateImage: slot.candidate_image ? toImageRef(slot.candidate_image) : null,
    accepted: slot.accepted,
    error: slot.error,
    provider: slot.provider,
    versions: slot.versions.map((version) => ({
      image: toImageRef(version.image),
      strategy: version.strategy,
      createdAt: version.created_at,
      isCurrent: version.is_current,
      isCandidate: version.is_candidate,
      available: version.available,
      state: version.state,
    })),
  };
}

function toMultiviewModelJob(data: MultiviewModelJobResponseBody): MultiviewModelJobResponse {
  return {
    status: data.status,
    message: data.message,
    promptId: data.prompt_id,
    geometryModel: {
      available: data.geometry_model.available,
      downloadUrl: data.geometry_model.download_url,
      assetId: data.geometry_model.asset_id,
    },
    texturedModel: {
      available: data.textured_model.available,
      downloadUrl: data.textured_model.download_url,
      assetId: data.textured_model.asset_id,
    },
  };
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}
