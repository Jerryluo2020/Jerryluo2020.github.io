import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: {alias: {'@': fileURLToPath(new URL('..', import.meta.url))}},
  build: {
    outDir: fileURLToPath(new URL('../../github-pages-dist', import.meta.url)),
    emptyOutDir: true,
  },
});
