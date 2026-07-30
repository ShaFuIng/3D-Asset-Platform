import type {
  ApiErrorBody,
  BackendHealthResponse,
  ChatMessage,
  ComfyHealthResponse,
  Create3DJobResponse,
  GenerateImageResponse,
  JobResponse,
  OpenAIHealthResponse,
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

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}
