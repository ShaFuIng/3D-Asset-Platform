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

export type ImageSource = 'generated' | 'uploaded' | 'edited';

export type ImageAsset = {
  image_id: string;
  filename: string;
  url: string;
  source: ImageSource;
  parentImageId?: string;
  assistant_message?: string;
  image_prompt?: string | null;
};

export type GenerateImageResponse = {
  image_id: string;
  filename: string;
  url: string;
  assistant_message: string;
  image_prompt: string | null;
  response_id: string;
};

export type UploadImageResponse = {
  image_id: string;
  filename: string;
  url: string;
};

export type EditImageResponse = {
  image_id: string;
  filename: string;
  url: string;
  source: 'edited';
  parentImageId: string;
  assistant_message: string;
  image_prompt: string | null;
  response_id: string;
};

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type Create3DJobResponse = {
  job_id: string;
  status: JobStatus;
  status_url: string;
  asset_id: string | null;
};

export type JobResponse = {
  job_id: string;
  status: JobStatus;
  message: string;
  prompt_id: string | null;
  result: {
    model_url: string;
  } | null;
  asset_id: string | null;
};

export type MultiviewName = 'front' | 'left' | 'back';

export type MultiviewProvider = 'local';

export type RegenerateStrategy = 'local_reroll' | 'openai_edit';

export type RegenerateMultiviewViewRequest =
  | { strategy: 'local_reroll' }
  | { strategy: 'openai_edit'; instruction: string };

export type MultiviewImageRef = {
  imageId: string;
  url: string;
  filename: string;
};

export type MultiviewVersionStrategy = 'initial' | 'local_reroll' | 'openai_edit';

export type MultiviewVersionState = 'active' | 'trash' | 'missing';

export type MultiviewViewVersion = {
  image: MultiviewImageRef;
  strategy: MultiviewVersionStrategy;
  createdAt: string;
  isCurrent: boolean;
  isCandidate: boolean;
  available: boolean;
  state: MultiviewVersionState;
};

export type MultiviewSlot = {
  view: MultiviewName;
  status: JobStatus;
  currentImage: MultiviewImageRef | null;
  candidateImage: MultiviewImageRef | null;
  accepted: boolean;
  error: string | null;
  provider: MultiviewProvider;
  versions: MultiviewViewVersion[];
};

export type CreateMultiviewJobResponse = {
  jobId: string;
  status: JobStatus;
  provider: MultiviewProvider;
  statusUrl: string;
};

export type MultiviewJobResponse = {
  jobId: string;
  status: JobStatus;
  message: string;
  provider: MultiviewProvider;
  promptId: string | null;
  referenceImage: MultiviewImageRef;
  views: Record<MultiviewName, MultiviewSlot>;
};

export type MultiviewModelResult = {
  geometryModelUrl: string | null;
  texturedModelUrl: string | null;
};

export type MultiviewModelJobResponse = {
  status: JobStatus;
  message: string;
  promptId: string | null;
  geometryModel: {
    available: boolean;
    downloadUrl: string | null;
    assetId: string | null;
  };
  texturedModel: {
    available: boolean;
    downloadUrl: string | null;
    assetId: string | null;
  };
};

export type ServiceHealthState = {
  status: ServiceStatus;
  message?: string;
};

export type LibraryAssetType = 'image' | 'model';
export type LibraryAssetState = 'active' | 'trash';
export type LibraryAssetSort =
  | 'created_at_desc'
  | 'created_at_asc'
  | 'filename_asc'
  | 'filename_desc'
  | 'size_desc'
  | 'size_asc';

export type LibraryAsset = {
  asset_id: string;
  asset_type: LibraryAssetType;
  content_url: string;
  filename: string;
  media_type: string;
  source: string;
  created_at: string;
  deleted_at: string | null;
  size_bytes: number;
  status: 'available' | 'missing';
  parent_image_id: string | null;
  pipeline: string | null;
  model_variant: string | null;
  related_job_id: string | null;
  reference_image_id: string | null;
  view_name: string | null;
  original_filename: string | null;
  parent_asset_id: string | null;
  calibrated_asset_ids: string[];
};

export type LibraryAssetQuery = {
  type?: LibraryAssetType;
  state?: LibraryAssetState;
  source?: string;
  pipeline?: string;
  search?: string;
  sort?: LibraryAssetSort;
  page?: number;
  page_size?: number;
};

export type LibraryAssetListResponse = {
  items: LibraryAsset[];
  page: number;
  page_size: number;
  total: number;
};

export type DeleteLibraryAssetResponse = {
  deleted_asset_id: string;
};
