import type { ImageAsset, ImageSource, LibraryAsset } from '../types/api';

// Shared by LibraryPage.tsx's "設為 Reference 並前往調整" action and
// LibraryImagePicker.tsx's picker: both convert the same LibraryAsset shape
// into the ImageAsset shape WorkspaceContext expects. Kept in one place so
// there is a single implementation instead of copies drifting apart.
export function toWorkspaceImageSource(source: string): ImageSource {
  if (source === 'generated' || source === 'uploaded' || source === 'edited') {
    return source;
  }
  return 'uploaded';
}

export function libraryAssetToImageAsset(asset: LibraryAsset): ImageAsset {
  return {
    image_id: asset.asset_id,
    filename: asset.filename,
    url: asset.content_url,
    source: toWorkspaceImageSource(asset.source),
    parentImageId: asset.parent_image_id ?? undefined,
  };
}
