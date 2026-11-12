// Deletes character models and portraits under assets/characters/ that the
// catalog no longer uses (e.g. after replacing characters).
// Usage: pnpm assets:prune-characters            (deletes)
//        pnpm assets:prune-characters --dry-run  (lists only)
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const dir = path.join(assets, 'characters');
const dry = process.argv.includes('--dry-run');
const catalog = JSON.parse(readFileSync(path.join(dir, 'catalog.json'), 'utf-8'));
const used = new Set();
for (const c of catalog.characters) {
  used.add(path.normalize(c.file).toLowerCase());
  if (c.thumbnail) used.add(path.normalize(c.thumbnail).toLowerCase());
  used.add(path.normalize(`characters/thumbs/${c.id}.png`).toLowerCase());
}
const candidates = [];
for (const name of readdirSync(dir)) {
  const full = path.join(dir, name);
  if (statSync(full).isFile() && /\.(fbx|glb|gltf)$/i.test(name)) candidates.push(`characters/${name}`);
}
for (const name of readdirSync(path.join(dir, 'thumbs'))) if (/\.png$/i.test(name)) candidates.push(`characters/thumbs/${name}`);
const unused = candidates.filter((f) => !used.has(path.normalize(f).toLowerCase()));
if (!unused.length) console.info('Nothing to remove: every character file is in the catalog.');
for (const f of unused) {
  if (!dry) rmSync(path.join(assets, f));
  console.info(`${dry ? 'would remove' : 'removed'} assets/${f}`);
}
