import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const releaseVersion =
  process.env.VITE_RELEASE_VERSION ||
  readFileSync(resolve(process.cwd(), 'VERSION'), 'utf8').trim();

export default defineConfig({
  root: process.cwd(),
  base: '/qingbei-webgl-campaign/',
  define: {
    'import.meta.env.VITE_RELEASE_VERSION': JSON.stringify(releaseVersion),
  },
  resolve: { preserveSymlinks: true },
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:17890',
      '/ws': {
        target: 'ws://127.0.0.1:17890',
        ws: true,
      },
    },
  },
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
