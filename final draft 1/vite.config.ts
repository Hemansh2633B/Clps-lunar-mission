import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = `http://127.0.0.1:${process.env.SELENE_API_PORT || '8000'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0', port: 5173, strictPort: false, allowedHosts: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  preview: {
    host: '0.0.0.0', port: 4173, allowedHosts: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          three: ['three'],
          ephemeris: ['astronomy-engine'],
        },
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
