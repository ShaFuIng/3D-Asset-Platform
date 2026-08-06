import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ApiClientError,
  getBackendHealth,
  getComfyHealth,
  getOpenAIHealth,
} from './api/client';
import { ServiceStatusPanel } from './components/ServiceStatusPanel';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { ARStudioPage } from './pages/ARStudioPage';
import { DevARPreviewPage } from './pages/DevARPreviewPage';
import { GenerateConfirmPage } from './pages/GenerateConfirmPage';
import { HomePage } from './pages/HomePage';
import { JobProgressPage } from './pages/JobProgressPage';
import { LibraryPage } from './pages/LibraryPage';
import { ModeSelectPage } from './pages/ModeSelectPage';
import { MultiviewStagePage } from './pages/MultiviewStagePage';
import { ReferenceStagePage } from './pages/ReferenceStagePage';
import { VideoFramePickerPage } from './pages/VideoFramePickerPage';
import { ViewerStagePage } from './pages/ViewerStagePage';
import type { ServiceHealthState } from './types/api';

const checkingState: ServiceHealthState = { status: 'checking' };

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '發生未知錯誤。';
}

export default function App() {
  const [backend, setBackend] = useState<ServiceHealthState>(checkingState);
  const [openai, setOpenai] = useState<ServiceHealthState>(checkingState);
  const [comfy, setComfy] = useState<ServiceHealthState>(checkingState);

  useEffect(() => {
    const controller = new AbortController();

    void getBackendHealth(controller.signal)
      .then((data) => setBackend({ status: data.status, message: data.message }))
      .catch((error) => {
        const message = getErrorMessage(error);
        if (message) setBackend({ status: 'disconnected', message });
      });

    void getOpenAIHealth(controller.signal)
      .then((data) => setOpenai({ status: data.status, message: data.message }))
      .catch((error) => {
        const message = getErrorMessage(error);
        if (message) setOpenai({ status: 'disconnected', message });
      });

    void getComfyHealth(controller.signal)
      .then((data) => setComfy({ status: data.status, message: data.message }))
      .catch((error) => {
        const message = getErrorMessage(error);
        if (message) setComfy({ status: 'disconnected', message });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="app">
      <ServiceStatusPanel backend={backend} openai={openai} comfy={comfy} />

      <WorkspaceProvider>
        <Routes>
          <Route path="/" element={<HomePage backend={backend} openai={openai} comfy={comfy} />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/reference" element={<ReferenceStagePage openai={openai} />} />
          <Route path="/video-upload" element={<VideoFramePickerPage />} />
          <Route path="/ar-studio" element={<ARStudioPage />} />
          <Route path="/mode" element={<ModeSelectPage />} />
          <Route path="/views" element={<MultiviewStagePage comfy={comfy} openai={openai} />} />
          <Route path="/views/:imageId" element={<MultiviewStagePage comfy={comfy} openai={openai} />} />
          <Route path="/generate" element={<GenerateConfirmPage comfy={comfy} />} />
          <Route path="/jobs/:pipeline/:jobId" element={<JobProgressPage />} />
          <Route path="/viewer/:pipeline/:jobId" element={<ViewerStagePage />} />
          {import.meta.env.DEV && (
            <Route path="/dev/ar-preview" element={<DevARPreviewPage />} />
          )}
          <Route path="/three-view" element={<Navigate to="/views" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </WorkspaceProvider>
    </main>
  );
}
