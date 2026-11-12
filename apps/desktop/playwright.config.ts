import { defineConfig } from '@playwright/test';

// Electron E2E. Requires a production bundle in .vite/ (run `pnpm --filter @booth/desktop package` first).
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
});
