// Copies the MediaPipe Tasks Vision WASM runtime from the installed npm
// package into assets/tracking-models/wasm so it is served locally and
// bundled with the packaged app. Run after installing or upgrading
// @mediapipe/tasks-vision (also run automatically before dev/package).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps', 'desktop', 'package.json'));
// The package's "exports" hide package.json; resolve a public entry and walk up.
const pkgDir = path.dirname(require.resolve('@mediapipe/tasks-vision'));
const pkgJson = path.join(pkgDir, 'package.json');
const { version } = JSON.parse(readFileSync(pkgJson, 'utf-8'));
const src = path.join(pkgDir, 'wasm');
const dest = path.join(root, 'assets', 'tracking-models', 'wasm');
mkdirSync(dest, { recursive: true });

// The module worker uses the ES-module loader variant; the classic and
// no-SIMD variants are copied as a fallback for diagnostics.
const files = [
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];
for (const f of files) {
  const from = path.join(src, f);
  if (!existsSync(from)) {
    console.error(`missing ${from}`);
    process.exit(1);
  }
  copyFileSync(from, path.join(dest, f));
}
writeFileSync(path.join(dest, 'VERSION'), `@mediapipe/tasks-vision ${version}\n`);
console.info(`synced ${files.length} files from @mediapipe/tasks-vision ${version}`);
