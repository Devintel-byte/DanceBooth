// Validates all content under assets/ (or the directory given as argument)
// with the same loader the app uses at startup. Exit code 1 on any issue.
// Usage: pnpm content:validate [assetsDir]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent, loadReplayFixture } from '@booth/content';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.resolve(process.argv[2] ?? path.join(root, 'assets'));
const content = loadContent(assets, { verifyIntegrity: true });
const issues = [...content.issues];

for (const f of ['tracking-models/pose_landmarker_lite.task', 'tracking-models/wasm/vision_wasm_module_internal.wasm']) {
  if (!existsSync(path.join(assets, f))) issues.push({ file: f, message: 'missing runtime asset (run pnpm setup:assets)' });
}
try {
  loadReplayFixture(assets, 'fixtures/dev-groove-synthetic.json');
} catch (e) {
  issues.push({ file: 'fixtures/dev-groove-synthetic.json', message: (e as Error).message });
}

console.info(`profiles: ${content.profiles.map((p) => p.id).join(', ') || 'none'}`);
console.info(`routines: ${content.routines.map((r) => `${r.id}${r.license.choreography.placeholder ? ' (placeholder)' : ''}`).join(', ') || 'none'}`);
console.info(`characters: ${content.characters?.characters.map((c) => c.id).join(', ') ?? 'none'}`);
for (const n of content.notices) console.info(`NOTE ${n.file}: ${n.message}`);
if (issues.length) {
  for (const i of issues) console.error(`ISSUE ${i.file}: ${i.message}`);
  process.exit(1);
}
console.info('content OK');
