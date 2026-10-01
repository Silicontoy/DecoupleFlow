import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true, rollupOptions: { output: { manualChunks: { canvas: ['@xyflow/react'], markdown: ['react-markdown', 'remark-gfm'] } } } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
