import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: process.cwd(),
  base: '/qingbei-webgl-campaign/',
  resolve: { preserveSymlinks: true },
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
});
