import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const defaultAllowedHosts = ['laptop-m64bf4qf.tailff1aa2.ts.net'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const envAllowedHosts = (env.VITE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    envDir: '..',
    server: {
      host: '127.0.0.1',
      port: 5173,
      allowedHosts: [...new Set([...defaultAllowedHosts, ...envAllowedHosts])],
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
