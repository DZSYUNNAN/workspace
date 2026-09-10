import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    fs: { allow: [path.resolve(__dirname, '../..')] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  optimizeDeps: {
    include: ['sql.js'],
  },
});
