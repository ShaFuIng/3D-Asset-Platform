import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, getLibraryAsset } from '../api/client';
import type { LibraryAsset } from '../types/api';

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return 'Request failed.';
}

export type UseAssetCalibrationResult = {
  rawAsset: LibraryAsset | null;
  calibratedAsset: LibraryAsset | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

// Shared by LibraryPage's model preview modal and both ViewerStagePage
// entry points (single-view and multiview) so all three query calibration
// state the same way instead of each re-implementing it -- see the Phase 6
// dev log for why ModelViewer itself stays props-driven instead of fetching
// on its own.
export function useAssetCalibration(assetId: string | undefined): UseAssetCalibrationResult {
  const [rawAsset, setRawAsset] = useState<LibraryAsset | null>(null);
  const [calibratedAsset, setCalibratedAsset] = useState<LibraryAsset | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!assetId) {
        setRawAsset(null);
        setCalibratedAsset(null);
        setError(null);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const asset = await getLibraryAsset(assetId, signal);
        const calibratedId = asset.calibrated_asset_ids[0];
        const calibrated = calibratedId ? await getLibraryAsset(calibratedId, signal) : null;
        setRawAsset(asset);
        setCalibratedAsset(calibrated);
      } catch (requestError) {
        const message = getErrorMessage(requestError);
        if (message) {
          // A real failure (not an aborted in-flight request) -- surface it
          // rather than silently leaving rawAsset/calibratedAsset at their
          // previous (possibly still-null) values, which would otherwise
          // read as "this asset was never calibrated" instead of "the
          // calibration lookup failed".
          setError(message);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [assetId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  return { rawAsset, calibratedAsset, isLoading, error, refresh: () => refresh() };
}
