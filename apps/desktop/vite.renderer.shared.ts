import path from 'node:path';
import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

/** Shared renderer config; each window has its own HTML root and output dir. */
export function rendererConfig(name: 'participant' | 'operator' | 'leaderboard'): UserConfig {
  return {
    root: path.resolve(__dirname, 'src/renderer', name),
    plugins: [react()],
    // Workspace packages are TypeScript sources; resolve them to real paths so
    // they are transformed like app code rather than treated as prebuilt deps.
    resolve: { preserveSymlinks: false },
    optimizeDeps: { exclude: ['@booth/contracts', '@booth/scoring', '@booth/tracking', '@booth/choreography', '@booth/session', '@booth/diagnostics'] },
    build: {
      outDir: path.resolve(__dirname, '.vite/renderer', name),
      emptyOutDir: true,
      target: 'chrome140',
      sourcemap: true,
    },
    worker: { format: 'es' },
    server: { strictPort: false },
  };
}
