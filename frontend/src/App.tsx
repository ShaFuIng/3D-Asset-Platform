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
import { SingleImageWorkspace } from './pages/SingleImageWorkspace';
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
          <Route path="/" element={<SingleImageWorkspace openai={openai} comfy={comfy} />} />
          <Route path="/three-view" element={<Navigate to="/?mode=multiview" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </WorkspaceProvider>
    </main>
  );
}
