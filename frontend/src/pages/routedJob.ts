import type {
  JobEntry,
  MultiviewWorkspace,
  Pipeline,
} from '../context/WorkspaceContext';
import type { ImageAsset } from '../types/api';

export type RoutedJob =
  | { pipeline: 'single'; imageId: string; image?: ImageAsset; entry: JobEntry }
  | { pipeline: 'multiview'; imageId: string; image?: ImageAsset; workspace: MultiviewWorkspace };

export function parsePipeline(param: string | undefined): Pipeline | null {
  return param === 'single' || param === 'multiview' ? param : null;
}

// Resolves a /jobs/:pipeline/:jobId or /viewer/:pipeline/:jobId route back to
// workspace state. Returns null when the job is unknown to this session (e.g.
// after a page refresh), so pages can show recovery guidance.
export function findRoutedJob(args: {
  pipeline: Pipeline;
  jobId: string;
  images: ImageAsset[];
  singleJobsByImageId: Record<string, JobEntry>;
  multiviewByImageId: Record<string, MultiviewWorkspace>;
}): RoutedJob | null {
  const { pipeline, jobId, images, singleJobsByImageId, multiviewByImageId } = args;

  if (pipeline === 'single') {
    const imageId = Object.keys(singleJobsByImageId).find(
      (id) => singleJobsByImageId[id]?.job?.job_id === jobId,
    );
    if (!imageId) {
      return null;
    }
    return {
      pipeline,
      imageId,
      image: images.find((image) => image.image_id === imageId),
      entry: singleJobsByImageId[imageId],
    };
  }

  const imageId = Object.keys(multiviewByImageId).find(
    (id) => multiviewByImageId[id]?.job?.jobId === jobId,
  );
  if (!imageId) {
    return null;
  }
  return {
    pipeline,
    imageId,
    image: images.find((image) => image.image_id === imageId),
    workspace: multiviewByImageId[imageId],
  };
}
