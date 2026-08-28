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
      // Vite's default (non-strict) port picker probes 0.0.0.0/:: for
      // availability *before* it ever tries the configured host, and treats
      // a failure there as "port taken" without attempting 127.0.0.1 at all
      // (see node_modules/vite/dist/node/chunks/node.js: isPortAvailable /
      // httpServerStart). `tailscale serve` permanently holds a listener on
      // the tailnet interface for :5173 (see `tailscale serve status`), which
      // blocks that wildcard probe on this machine even though 127.0.0.1:5173
      // itself is free -- causing silent drift to 5174/5175. strictPort
      // makes Vite bind 127.0.0.1:5173 directly and fail loudly instead of
      // drifting. See docs/development-log/kila606 entry dated 2026-08-28.
      strictPort: true,
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
