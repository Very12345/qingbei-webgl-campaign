import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: process.cwd(),
  base: '/qingbei-webgl-campaign/',
  resolve: { preserveSymlinks: true },
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        server: resolve(process.cwd(), 'server.html'),
      },
    },
  },
});
