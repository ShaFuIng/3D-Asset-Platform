// Mock implementation of frontend/src/api/client.ts.
//
// Every exported function here mirrors the signature (params + return type)
// of its real counterpart in api/client.ts, so api/client.ts can delegate to
// this module without any change on the calling side. See config.ts for how
// to enable mock mode and tune timings/scenarios.
import { getMockModelUrl, createPlaceholderImageDataUrl, readFileAsDataUrl } from './assets';
import { MOCK_DELAYS, MOCK_JOB_FAILURE_RATE, MOCK_JOB_OUTCOME_MODE } from './config';
import { MOCK_ASSISTANT_REPLIES, pickRandom } from './fixtures';
import { createMockId, delay } from './utils';
import { ApiClientError } from '../api/client';
import type {
  BackendHealthResponse,
  ChatMessage,
  ComfyHealthResponse,
  Create3DJobResponse,
  GenerateImageResponse,
  JobResponse,
  JobStatus,
  OpenAIHealthResponse,
  UploadImageResponse,
} from '../types/api';

type MockJobOutcome = 'succeeded' | 'failed';

type MockJobState = {
  createdAt: number;
  imageId: string;
  promptId: string;
  outcome: MockJobOutcome;
};

// In-memory job store, keyed by job_id. Reset on page reload, which is fine
// for a dev-only tool.
const jobStore = new Map<string, MockJobState>();

function resolveJobOutcome(): MockJobOutcome {
  if (MOCK_JOB_OUTCOME_MODE === 'always-fail') return 'failed';
  if (MOCK_JOB_OUTCOME_MODE === 'always-succeed') return 'succeeded';
  return Math.random() < MOCK_JOB_FAILURE_RATE ? 'failed' : 'succeeded';
}

function computeJobStatus(state: MockJobState): JobStatus {
  const elapsed = Date.now() - state.createdAt;
  if (elapsed < MOCK_DELAYS.jobQueuedDuration) {
    return 'queued';
  }
  if (elapsed < MOCK_DELAYS.jobQueuedDuration + MOCK_DELAYS.jobRunningDuration) {
    return 'running';
  }
  return state.outcome === 'failed' ? 'failed' : 'succeeded';
}

export async function mockGetBackendHealth(signal?: AbortSignal): Promise<BackendHealthResponse> {
  await delay(MOCK_DELAYS.networkLatency, signal);
  return { status: 'connected', service: 'backend', message: 'Mock backend is healthy.' };
}

export async function mockGetOpenAIHealth(signal?: AbortSignal): Promise<OpenAIHealthResponse> {
  await delay(MOCK_DELAYS.networkLatency, signal);
  return { status: 'configured', service: 'openai', message: 'Mock OpenAI is configured.' };
}

export async function mockGetComfyHealth(signal?: AbortSignal): Promise<ComfyHealthResponse> {
  await delay(MOCK_DELAYS.networkLatency, signal);
  return {
    status: 'connected',
    service: 'comfyui',
    base_url: 'mock://comfyui',
    message: 'Mock ComfyUI is connected.',
  };
}

export async function mockGenerateImage(
  messages: ChatMessage[],
  previousResponseId?: string,
  signal?: AbortSignal,
): Promise<GenerateImageResponse> {
  await delay(MOCK_DELAYS.imageGeneration, signal);

  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const prompt = lastUserMessage?.content ?? '';
  const imageId = createMockId('img');

  return {
    image_id: imageId,
    filename: `${imageId}.png`,
    url: createPlaceholderImageDataUrl(prompt),
    assistant_message: pickRandom(MOCK_ASSISTANT_REPLIES),
    image_prompt: prompt || null,
    response_id: createMockId('resp'),
  };
}

export async function mockUploadImage(file: File, signal?: AbortSignal): Promise<UploadImageResponse> {
  await delay(MOCK_DELAYS.imageUpload, signal);
  const url = await readFileAsDataUrl(file);

  return {
    image_id: createMockId('img'),
    filename: file.name,
    url,
  };
}

export async function mockCreate3DJob(
  imageId: string,
  signal?: AbortSignal,
): Promise<Create3DJobResponse> {
  await delay(MOCK_DELAYS.networkLatency, signal);

  const jobId = createMockId('job');
  jobStore.set(jobId, {
    createdAt: Date.now(),
    imageId,
    promptId: createMockId('prompt'),
    outcome: resolveJobOutcome(),
  });

  return { job_id: jobId, status: 'queued', status_url: `/api/3d/jobs/${jobId}` };
}

export async function mockGet3DJob(jobId: string, signal?: AbortSignal): Promise<JobResponse> {
  await delay(MOCK_DELAYS.networkLatency, signal);

  const state = jobStore.get(jobId);
  if (!state) {
    throw new ApiClientError('Mock job not found.', 404);
  }

  const status = computeJobStatus(state);

  if (status === 'queued') {
    return { job_id: jobId, status, message: 'Job is queued.', prompt_id: null, result: null };
  }
  if (status === 'running') {
    return {
      job_id: jobId,
      status,
      message: 'Generating 3D model...',
      prompt_id: state.promptId,
      result: null,
    };
  }
  if (status === 'failed') {
    return {
      job_id: jobId,
      status,
      message: 'Mock job failed (simulated failure).',
      prompt_id: state.promptId,
      result: null,
    };
  }

  return {
    job_id: jobId,
    status,
    message: 'Mock 3D model generated.',
    prompt_id: state.promptId,
    result: { model_url: await getMockModelUrl() },
  };
}
