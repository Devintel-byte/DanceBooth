// Removes Vite's dev caches and the last dev build so `pnpm dev` starts from
// the current source. Use it when the app does not show recent changes, shows
// a blank participant screen, or logs "Cannot read properties of null (reading 'useMemo')".
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['apps/desktop/.vite', 'node_modules/.vite', 'apps/desktop/node_modules/.vite']) {
  rmSync(path.join(root, dir), { recursive: true, force: true });
  console.info(`removed ${dir}`);
}
