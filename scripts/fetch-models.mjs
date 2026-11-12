// Downloads the MediaPipe Pose Landmarker models (Apache-2.0) into
// assets/tracking-models/ so the app can run fully offline. This is a
// build-time step only; the app never downloads anything at runtime.
//
// The first successful download records SHA-256 hashes in models.lock.json.
// Later runs verify existing files against the lock and refuse mismatches.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets', 'tracking-models');
const lockFile = path.join(dir, 'models.lock.json');

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf-8')) : { models: {} };
mkdirSync(dir, { recursive: true });

let failed = false;
for (const [name, url] of Object.entries(MODELS)) {
  const file = path.join(dir, name);
  const expected = lock.models[name]?.sha256;
  if (existsSync(file)) {
    const actual = sha(readFileSync(file));
    if (expected && actual !== expected) {
      console.error(`${name}: hash mismatch (have ${actual}, lock ${expected}). Delete it and re-run.`);
      failed = true;
    } else {
      lock.models[name] = { url, sha256: actual };
      console.info(`${name}: present (${actual.slice(0, 12)}...)`);
    }
    continue;
  }
  console.info(`${name}: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`${name}: HTTP ${res.status}`);
    failed = true;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha(buf);
  if (expected && actual !== expected) {
    console.error(`${name}: downloaded hash ${actual} does not match lock ${expected}; not saved.`);
    failed = true;
    continue;
  }
  writeFileSync(file, buf);
  lock.models[name] = { url, sha256: actual };
  console.info(`${name}: saved ${(buf.length / 1e6).toFixed(1)} MB (${actual.slice(0, 12)}...)`);
}
writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
process.exit(failed ? 1 : 0);
