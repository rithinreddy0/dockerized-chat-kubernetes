import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = `http://127.0.0.1:${env.PORT || 3000}`;

  return {
    root: 'client',
    plugins: [react()],
    build: { outDir: '../dist', emptyOutDir: true },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': backend,
        '/socket.io': { target: backend, ws: true }
      }
    }
  };
});
