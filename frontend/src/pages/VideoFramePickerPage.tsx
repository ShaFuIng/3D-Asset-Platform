import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiClientError, resolveApiUrl, uploadImage } from '../api/client';

type AddedFrame = {
  imageId: string;
  filename: string;
  url: string;
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

// Standalone tool, not part of the reference/mode/views pipeline: pick any
// frame out of a local video in the browser and add it to the asset library
// through the existing image upload endpoint. The video itself never leaves
// the browser or gets stored — only frames the user explicitly adds do.
export function VideoFramePickerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const frameCounterRef = useRef(0);

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    setDuration(video.duration);
  }

  function drawCurrentFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
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
    const video = videoRef.current;
    if (video) {
      video.currentTime = value;
    }
  }

  function handleVideoError() {
    setVideoError('無法播放這個影片，可能是瀏覽器不支援的格式或編碼。請換一個檔案。');
    setIsFrameReady(false);
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
        { imageId: uploaded.image_id, filename: uploaded.filename, url: uploaded.url },
      ]);
    } catch (error) {
      setUploadError(getErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  }

  function handleRemoveFrame(imageId: string) {
    setAddedFrames((current) => current.filter((frame) => frame.imageId !== imageId));
  }

  return (
    <div className="video-picker-page">
      <Link className="back-button" to="/">
        ← 返回首頁
      </Link>

      <header className="stage-header">
        <p className="eyebrow">VIDEO · FRAME PICKER</p>
        <h2>從影片擷取畫面</h2>
      </header>

      <div className="video-picker-layout">
        <section className="panel video-picker-source-panel">
          <div className="section-header">
            <h2>影片</h2>
            <span>{videoSrc ? (isFrameReady ? '畫面已就緒' : '載入中…') : 'idle'}</span>
          </div>
          <p className="hint">
            上傳一段影片，拖曳下方進度條選擇任意畫面，按下「加入此畫面」即可把該畫面存入資產庫。
            影片本身不會上傳或儲存，只有你確認加入的畫面才會送出。
          </p>

          <label className="upload-control">
            <span>選擇影片檔案</span>
            <input type="file" accept="video/*" onChange={handleFileChange} />
          </label>

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
                onError={handleVideoError}
                playsInline
                muted
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
            <h2>已加入的畫面</h2>
            <span>{addedFrames.length} 張</span>
          </div>
          {addedFrames.length === 0 ? (
            <div className="empty-state">尚未加入任何畫面。選好影片畫面後按「加入此畫面」即可加進這裡。</div>
          ) : (
            <div className="gallery-grid">
              {addedFrames.map((frame) => (
                <article className="image-card" key={frame.imageId}>
                  <img src={resolveApiUrl(frame.url)} alt={frame.filename} />
                  <span>{frame.filename}</span>
                  <button
                    type="button"
                    className="image-archive-button"
                    onClick={() => handleRemoveFrame(frame.imageId)}
                  >
                    移除
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
