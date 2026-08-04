import type {
  JobEntry,
  MultiviewWorkspace,
  Pipeline,
} from '../context/WorkspaceContext';
import type { MultiviewName } from '../types/api';

// Single source of truth for the five-stage workflow navigation, shared by
// the Home session rail and StageShell. Pure presentation logic: it only
// reads workspace state and produces routes; it never triggers any API.

export type StageNavId = 'reference' | 'mode' | 'views' | 'generate' | 'inspect';

export type StageNavState = 'done' | 'current' | 'available' | 'locked' | 'na';

export type StageNavItem = {
  id: StageNavId;
  index: number;
  label: string;
  en: string;
  state: StageNavState;
  destination: string | null;
  note?: string;
};

const STAGE_ORDER: Array<{ id: StageNavId; label: string; en: string }> = [
  { id: 'reference', label: '參考圖', en: 'REFERENCE' },
  { id: 'mode', label: '模式', en: 'MODE' },
  { id: 'views', label: '視圖', en: 'VIEWS' },
  { id: 'generate', label: '生成', en: 'GENERATE' },
  { id: 'inspect', label: '檢視', en: 'INSPECT' },
];

const VIEW_NAMES: MultiviewName[] = ['front', 'left', 'back'];

export function getStageNavItems(args: {
  imageId?: string;
  pipelineByImageId: Record<string, Pipeline>;
  singleJobsByImageId: Record<string, JobEntry>;
  multiviewByImageId: Record<string, MultiviewWorkspace>;
  currentStage?: StageNavId;
}): StageNavItem[] {
  const { imageId, pipelineByImageId, singleJobsByImageId, multiviewByImageId, currentStage } = args;

  const hasImage = Boolean(imageId);
  const pipeline = imageId ? pipelineByImageId[imageId] : undefined;
  const singleEntry = imageId ? singleJobsByImageId[imageId] : undefined;
  const singleJob = singleEntry?.job;
  const workspace = imageId ? multiviewByImageId[imageId] : undefined;
  const multiviewJob = workspace?.job ?? null;
  const modelJob = workspace?.modelJob ?? null;

  const allAccepted = Boolean(
    multiviewJob &&
      VIEW_NAMES.every((view) => multiviewJob.views[view].accepted && multiviewJob.views[view].currentImage),
  );
  const hasCandidate = Boolean(
    multiviewJob && VIEW_NAMES.some((view) => multiviewJob.views[view].candidateImage),
  );
  const viewsComplete = Boolean(multiviewJob && multiviewJob.status === 'succeeded' && allAccepted && !hasCandidate);
  const singleModelReady = Boolean(singleJob?.status === 'succeeded' && singleEntry?.modelUrl);
  const multiviewModelReady = Boolean(
    modelJob?.status === 'succeeded' &&
      (modelJob.geometryModel.available || modelJob.texturedModel.available),
  );

  type Base = { destination: string | null; na?: boolean; completed?: boolean; note?: string };
  const base: Record<StageNavId, Base> = {
    reference: { destination: '/reference', completed: hasImage },
    mode: hasImage
      ? { destination: '/mode', completed: Boolean(pipeline) }
      : { destination: null, note: '需要先選擇 Reference Image' },
    views: !hasImage
      ? { destination: null, note: '需要先選擇 Reference Image' }
      : pipeline === 'single'
        ? { destination: null, na: true, note: 'Single-view 不需要三視圖' }
        : pipeline === 'multiview'
          ? { destination: `/views/${imageId}`, completed: viewsComplete }
          : { destination: null, note: '請先在 Mode 選擇 Multi-view' },
    generate: !hasImage
      ? { destination: null, note: '需要先選擇 Reference Image' }
      : pipeline === 'single'
        ? {
            destination: singleJob ? `/jobs/single/${singleJob.job_id}` : '/generate',
            completed: singleJob?.status === 'succeeded',
          }
        : pipeline === 'multiview'
          ? modelJob && multiviewJob
            ? {
                destination: `/jobs/multiview/${multiviewJob.jobId}`,
                completed: modelJob.status === 'succeeded',
              }
            : { destination: null, note: '需先完成三視圖確認' }
          : { destination: null, note: '請先在 Mode 選擇生成模式' },
    inspect: !hasImage
      ? { destination: null, note: '需要先選擇 Reference Image' }
      : pipeline === 'single'
        ? singleModelReady && singleJob
          ? { destination: `/viewer/single/${singleJob.job_id}` }
          : { destination: null, note: '需要已完成的 3D 模型' }
        : pipeline === 'multiview'
          ? multiviewModelReady && multiviewJob
            ? { destination: `/viewer/multiview/${multiviewJob.jobId}` }
            : { destination: null, note: '需要已完成的 3D 模型' }
          : { destination: null, note: '請先在 Mode 選擇生成模式' },
  };

  const currentIndex = currentStage
    ? STAGE_ORDER.findIndex((stage) => stage.id === currentStage)
    : -1;

  return STAGE_ORDER.map((stage, index) => {
    const entry = base[stage.id];
    let state: StageNavState;
    if (currentStage && stage.id === currentStage) {
      state = 'current';
    } else if (entry.na) {
      state = 'na';
    } else if (!entry.destination) {
      state = 'locked';
    } else if (currentStage && index < currentIndex) {
      state = 'done';
    } else {
      state = entry.completed ? 'done' : 'available';
    }
    return {
      id: stage.id,
      index,
      label: stage.label,
      en: stage.en,
      state,
      destination: entry.na ? null : entry.destination,
      note: entry.note,
    };
  });
}
