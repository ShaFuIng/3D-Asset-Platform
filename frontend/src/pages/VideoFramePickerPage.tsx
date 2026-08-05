import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClientError, resolveApiUrl, uploadImage } from '../api/client';
import { useWorkspace } from '../context/WorkspaceContext';
import type { ImageAsset } from '../types/api';

const MAX_FRAME_EXPORT_SIDE = 2048;

type AddedFrame = ImageAsset & {
  capturedAt: number;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '操作失敗。';
}

function getScaledCanvasSize(width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longestSide = Math.max(width, height);
  const scale = longestSide > MAX_FRAME_EXPORT_SIDE ? MAX_FRAME_EXPORT_SIDE / longestSide : 1;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

// Standalone tool, not part of the reference/mode/views pipeline: pick any
// frame out of a local video in the browser and add it to the asset library
// through the existing image upload endpoint. The video itself never leaves
// the browser or gets stored; only frames the user explicitly adds do.
export function VideoFramePickerPage() {
  const navigate = useNavigate();
  const { importLibraryImageAsReference } = useWorkspace();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const frameCounterRef = useRef(0);

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isFrameReady, setIsFrameReady] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [addedFrames, setAddedFrames] = useState<AddedFrame[]>([]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;
    setVideoSrc(nextUrl);
    setVideoName(file.name);
    setVideoError(null);
    setUploadError(null);
    setDuration(0);
    setCurrentTime(0);
    setIsFrameReady(false);
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return;
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setVideoError('無法讀取這個影片的長度，請換一個檔案。');
      return;
    }
    const size = getScaledCanvasSize(video.videoWidth, video.videoHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    setDuration(video.duration);
  }

  function drawCurrentFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return;
    }
    if (canvas.width <= 0 || canvas.height <= 0) {
      const size = getScaledCanvasSize(video.videoWidth, video.videoHeight);
      canvas.width = size.width;
      canvas.height = size.height;
    }
    if (canvas.width <= 0 || canvas.height <= 0) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setIsFrameReady(true);
  }

  function handleScrub(event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setCurrentTime(value);
    setIsFrameReady(false);
    const video = videoRef.current;
    if (video) {
      video.currentTime = value;
    }
  }

  function handleVideoError() {
    setVideoError('無法播放這個影片，可能是瀏覽器不支援的格式或編碼。請換一個檔案。');
    setIsFrameReady(false);
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    setCurrentTime(video.currentTime);
    drawCurrentFrame();
  }

  async function handleAddFrame() {
    const canvas = canvasRef.current;
    if (!canvas || !isFrameReady || isUploading) {
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        throw new Error('無法從目前畫面產生圖片。');
      }
      frameCounterRef.current += 1;
      const filename = `video-frame-${Date.now()}-${frameCounterRef.current}.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      const uploaded = await uploadImage(file);
      setAddedFrames((current) => [
        ...current,
        { ...uploaded, source: 'uploaded', capturedAt: currentTime },
      ]);
    } catch (error) {
      setUploadError(getErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  }

  function handleRemoveFrame(imageId: string) {
    setAddedFrames((current) => current.filter((frame) => frame.image_id !== imageId));
  }

  function handleUseFrame(frame: AddedFrame) {
    importLibraryImageAsReference(frame);
    void navigate('/reference');
  }

  return (
    <div className="video-picker-page">
      <Link className="back-button" to="/">
        ← 回到首頁
      </Link>

      <header className="stage-header">
        <p className="eyebrow">VIDEO FRAME PICKER</p>
        <h2>影片擷取</h2>
      </header>

      <div className="video-picker-layout">
        <section className="panel video-picker-source-panel">
          <div className="section-header">
            <h2>畫面截取</h2>
            <span>{videoSrc ? (isFrameReady ? '畫面已就緒' : '載入中...') : 'IDLE'}</span>
          </div>
          <p className="hint">
            可選擇常見影片格式，實際支援依瀏覽器與影片編碼而定。完整影片不會上傳，只有按下「加入此畫面」的單張影格會上傳。
          </p>

          <label className="upload-control">
            <span>選擇影片檔案</span>
            <input type="file" accept="video/*" onChange={handleFileChange} />
          </label>
          {videoName && <p className="hint video-picker-filename">目前影片：{videoName}</p>}

          {videoError && <p className="hint error">{videoError}</p>}

          {videoSrc && (
            <div className="video-picker-stage">
              <video
                ref={videoRef}
                src={videoSrc}
                className="video-picker-source"
                onLoadedMetadata={handleLoadedMetadata}
                onLoadedData={drawCurrentFrame}
                onSeeked={drawCurrentFrame}
                onTimeUpdate={handleTimeUpdate}
                onError={handleVideoError}
                controls
                playsInline
                muted
                preload="metadata"
              />
              <canvas ref={canvasRef} className="video-picker-canvas" />
            </div>
          )}

          {videoSrc && duration > 0 && (
            <div className="video-picker-controls">
              <input
                type="range"
                min={0}
                max={duration}
                step={1 / 30}
                value={currentTime}
                onChange={handleScrub}
                aria-label="選擇畫面時間點"
              />
              <span className="hint">
                {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
              </span>
              <button
                type="button"
                className="primary-action"
                disabled={!isFrameReady || isUploading}
                onClick={() => void handleAddFrame()}
              >
                {isUploading ? '加入中...' : '加入此畫面'}
              </button>
            </div>
          )}

          {uploadError && <p className="hint error">{uploadError}</p>}
        </section>

        <section className="panel video-picker-frames-panel">
          <div className="section-header">
            <h2>已加入資產庫的影格</h2>
            <span>{addedFrames.length} 張</span>
          </div>
          <p className="hint">
            這裡只列出本次從影片擷取並成功上傳的圖片。按「設為 Reference 並前往工作區」會使用既有 Workspace
            狀態選中該圖片，不會建立 Single 或 Multiview Job。「從清單移除」只會移除此頁暫存項目，已加入資產庫的圖片仍會保留。
          </p>
          {addedFrames.length === 0 ? (
            <div className="empty-state">尚未加入任何畫面。選好影片畫面後按「加入此畫面」即可加進這裡。</div>
          ) : (
            <div className="gallery-grid video-picker-frame-grid">
              {addedFrames.map((frame) => (
                <article className="image-card" key={frame.image_id}>
                  <img src={resolveApiUrl(frame.url)} alt={frame.filename} />
                  <span>{frame.filename}</span>
                  <small className="hint">擷取時間：{frame.capturedAt.toFixed(2)}s</small>
                  <button type="button" className="primary-action" onClick={() => handleUseFrame(frame)}>
                    設為 Reference 並前往工作區
                  </button>
                  <button
                    type="button"
                    className="image-archive-button"
                    onClick={() => handleRemoveFrame(frame.image_id)}
                  >
                    從清單移除
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
