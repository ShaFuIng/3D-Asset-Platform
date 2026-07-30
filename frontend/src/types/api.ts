export type ServiceStatus = 'checking' | 'connected' | 'disconnected' | 'configured' | 'not_configured';

export type BackendHealthResponse = {
  status: 'connected';
  service: 'backend';
  message: string;
};

export type OpenAIHealthResponse = {
  status: 'configured' | 'not_configured';
  service: 'openai';
  message: string;
};

export type ComfyHealthResponse = {
  status: 'connected' | 'disconnected';
  service: 'comfyui';
  base_url: string;
  message: string;
};

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ImageSource = 'generated' | 'uploaded';

export type ImageAsset = {
  image_id: string;
  filename: string;
  url: string;
  source: ImageSource;
  assistant_message?: string;
  image_prompt?: string | null;
};

export type GenerateImageResponse = {
  image_id: string;
  filename: string;
  url: string;
  assistant_message: string;
  image_prompt: string | null;
};

export type UploadImageResponse = {
  image_id: string;
  filename: string;
  url: string;
};

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type Create3DJobResponse = {
  job_id: string;
  status: JobStatus;
  status_url: string;
};

export type JobResponse = {
  job_id: string;
  status: JobStatus;
  message: string;
  prompt_id: string | null;
  result: {
    model_url: string;
  } | null;
};

export type ServiceHealthState = {
  status: ServiceStatus;
  message?: string;
};
