// Deletes content under assets/ that nothing uses any more, so the installer
// only ships what the booth plays:
//   * character models and portraits not in characters/catalog.json
//   * animation clips not listed in choreography/plan.json (clipFiles) or by a
//     character / routine
//   * routines whose song is no longer in audio/tracks.json (development
//     routine dev-groove is kept: the tests use it)
//   * song WAVs no routine plays, and replay fixtures nothing uses
//   * retired files (the old development profile and placeholder logo)
// Song sources (audio/source) are never touched.
//
// Usage: pnpm assets:prune            (deletes)
//        pnpm assets:prune --dry-run  (lists only)
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const dry = process.argv.includes('--dry-run');
const json = (rel) => JSON.parse(readFileSync(path.join(assets, rel), 'utf-8'));
const norm = (rel) => path.normalize(rel).toLowerCase();
const list = (dir, re) =>
  existsSync(path.join(assets, dir))
    ? readdirSync(path.join(assets, dir))
        .filter((n) => re.test(n) && statSync(path.join(assets, dir, n)).isFile())
        .map((n) => `${dir}/${n}`)
    : [];

const KEEP_ROUTINES = new Set(['dev-groove']);
const used = new Set();

// Characters.
const catalog = json('characters/catalog.json');
for (const c of catalog.characters) {
  if (c.file) used.add(norm(c.file));
  if (c.thumbnail) used.add(norm(c.thumbnail));
  used.add(norm(`characters/thumbs/${c.id}.png`));
  for (const f of [...(c.clipFiles ?? []), ...(c.rig?.clipFiles ?? [])]) used.add(norm(f));
}

// Choreography plan.
const plan = json('choreography/plan.json');
for (const f of plan.clipFiles ?? []) used.add(norm(f));

// Routines: keep those whose song is still prepared.
const songs = new Set(json('audio/tracks.json').map((t) => t.id));
const unusedRoutines = [];
for (const f of list('routines', /\.json$/i)) {
  const r = json(f);
  if (!songs.has(r.id) && !KEEP_ROUTINES.has(r.id)) {
    unusedRoutines.push(f);
    continue;
  }
  used.add(norm(r.audio.file));
  if (r.animation?.kind === 'glb-timeline') for (const c of r.animation.clipFiles ?? []) used.add(norm(c));
}
used.add(norm('audio/dev-groove-120bpm.wav'));
// Replay fixtures: the demo fixture and the dev routine's (tests).
used.add(norm('fixtures/demo-synthetic.json'));
used.add(norm('fixtures/dev-groove-synthetic.json'));

const candidates = [
  ...list('characters', /\.(fbx|glb|gltf)$/i),
  ...list('characters/thumbs', /\.png$/i),
  ...list('animations/mixamo', /\.(fbx|glb|gltf)$/i),
  ...list('audio', /\.wav$/i),
  ...list('fixtures', /\.json$/i),
];
const RETIRED = ['profiles/dev-showcase.json', 'branding/danceoff-logo.svg'].filter((f) => existsSync(path.join(assets, f)));
const unused = [...RETIRED, ...unusedRoutines, ...candidates.filter((f) => !used.has(norm(f)))];
// Folders of removed GLB characters (e.g. characters/robot-expressive/).
for (const name of existsSync(path.join(assets, 'characters')) ? readdirSync(path.join(assets, 'characters')) : []) {
  const rel = `characters/${name}`;
  if (name === 'thumbs' || !statSync(path.join(assets, rel)).isDirectory()) continue;
  if (![...used].some((u) => u.startsWith(norm(rel) + path.sep))) unused.push(rel);
}

if (!unused.length) console.info('Nothing to remove: every file under assets/ is in use.');
for (const f of unused) {
  if (!dry) rmSync(path.join(assets, f), { recursive: true, force: true });
  console.info(`${dry ? 'would remove' : 'removed'} assets/${f}`);
}
