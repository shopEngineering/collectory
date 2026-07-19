import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy targets the embedded Express server on 7117.
const API_TARGET = 'http://127.0.0.1:7117';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/images': { target: API_TARGET, changeOrigin: true },
      '/attachments': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
