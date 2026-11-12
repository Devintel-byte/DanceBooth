import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  characterCatalogSchema,
  eventProfileSchema,
  replayFixtureSchema,
  routineManifestSchema,
  type CharacterCatalog,
  type EventProfile,
  type ReplayFixture,
  type RoutineManifest,
} from '@booth/contracts';
import type { z } from 'zod';
import { resolveAssetPath } from './paths';

export interface ContentIssue {
  file: string;
  message: string;
}

export interface LoadedContent {
  profiles: EventProfile[];
  routines: RoutineManifest[];
  characters: CharacterCatalog | null;
  issues: ContentIssue[];
  /** Non-fatal: e.g. optional characters hidden because their model is not installed yet. */
  notices: ContentIssue[];
}

function formatZod(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function loadDir<T>(
  dir: string,
  schema: z.ZodType<T>,
  label: string,
  issues: ContentIssue[],
): T[] {
  const out: T[] = [];
  if (!existsSync(dir)) {
    issues.push({ file: label, message: 'directory missing' });
    return out;
  }
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    try {
      const parsed = schema.safeParse(readJson(file));
      if (parsed.success) out.push(parsed.data);
      else issues.push({ file: `${label}/${name}`, message: formatZod(parsed.error) });
    } catch (e) {
      issues.push({ file: `${label}/${name}`, message: `unreadable: ${(e as Error).message}` });
    }
  }
  return out;
}

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Loads and validates all content under `assetsRoot`. Never throws for bad
 * content: problems are returned as issues and invalid items are excluded.
 */
export function loadContent(assetsRoot: string, opts: { verifyIntegrity?: boolean } = {}): LoadedContent {
  const issues: ContentIssue[] = [];
  const profiles = loadDir(path.join(assetsRoot, 'profiles'), eventProfileSchema, 'profiles', issues);
  const loadedRoutines = loadDir(path.join(assetsRoot, 'routines'), routineManifestSchema, 'routines', issues);

  let characters: CharacterCatalog | null = null;
  const charFile = path.join(assetsRoot, 'characters', 'catalog.json');
  try {
    const parsed = characterCatalogSchema.safeParse(readJson(charFile));
    if (parsed.success) characters = parsed.data;
    else issues.push({ file: 'characters/catalog.json', message: formatZod(parsed.error) });
  } catch (e) {
    issues.push({ file: 'characters/catalog.json', message: `unreadable: ${(e as Error).message}` });
  }

  // Referenced files must exist (and match integrity hashes when requested).
  const routines: RoutineManifest[] = [];
  const seen = new Set<string>();
  for (const r of loadedRoutines) {
    const label = `routines/${r.id}`;
    if (seen.has(r.id)) {
      issues.push({ file: label, message: 'duplicate routine id' });
      continue;
    }
    seen.add(r.id);
    const refs = [r.audio.file, ...(r.animation.kind === 'glb-timeline' ? r.animation.clipFiles : [])];
    if (r.animation.kind === 'glb-timeline') {
      const animation = r.animation;
      const ch = characters?.characters.find((c) => c.id === animation.character);
      if (!ch || ch.kind !== 'glb') {
        issues.push({ file: label, message: `animation character unavailable: ${animation.character}` });
        continue;
      }
    }
    let ok = true;
    for (const ref of refs) {
      const abs = resolveAssetPath(assetsRoot, ref);
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
        issues.push({ file: label, message: `missing asset: ${ref}` });
        ok = false;
        continue;
      }
      const expected = r.integrity[ref];
      if (opts.verifyIntegrity && expected && sha256File(abs) !== expected) {
        issues.push({ file: label, message: `integrity mismatch: ${ref}` });
        ok = false;
      }
    }
    if (ok) routines.push(r);
  }

  const notices: ContentIssue[] = [];
  if (characters) {
    const installed = characters.characters.filter((c) => {
      const abs = resolveAssetPath(assetsRoot, c.file);
      const present = !!abs && existsSync(abs);
      if (!present && c.optional) notices.push({ file: `characters/${c.id}`, message: `not installed yet (${c.file}); hidden until the file is added` });
      return present || !c.optional;
    });
    const hidden = new Set(characters.characters.filter((c) => !installed.includes(c)).map((c) => c.id));
    // A portrait rendered by `pnpm assets:portraits` is picked up without editing the catalog.
    for (const c of installed) {
      if (c.thumbnail) continue;
      const guess = `characters/thumbs/${c.id}.png`;
      const abs = resolveAssetPath(assetsRoot, guess);
      if (abs && existsSync(abs)) c.thumbnail = guess;
    }
    characters = { ...characters, characters: installed };
    for (const p of profiles) p.enabledCharacters = p.enabledCharacters.filter((id) => !hidden.has(id));
  }

  for (const c of characters?.characters ?? []) {
    for (const ref of [c.file, ...(c.thumbnail ? [c.thumbnail] : []), ...c.rig.clipFiles]) {
      const abs = resolveAssetPath(assetsRoot, ref);
      if (!abs || !existsSync(abs)) issues.push({ file: `characters/${c.id}`, message: `missing asset: ${ref}` });
    }
  }

  for (const p of profiles) {
    for (const id of p.enabledRoutines) {
      if (!routines.some((r) => r.id === id)) {
        issues.push({ file: `profiles/${p.id}`, message: `enabled routine unavailable: ${id}` });
      }
    }
    for (const id of p.enabledCharacters) {
      if (!characters?.characters.some((c) => c.id === id)) {
        issues.push({ file: `profiles/${p.id}`, message: `enabled character unavailable: ${id}` });
      }
    }
    for (const ref of [p.logo, p.fonts.display.file, p.fonts.body.file]) {
      if (!ref) continue;
      const abs = resolveAssetPath(assetsRoot, ref);
      if (!abs || !existsSync(abs)) issues.push({ file: `profiles/${p.id}`, message: `missing asset: ${ref}` });
    }
  }
  if (profiles.length === 0) issues.push({ file: 'profiles', message: 'no valid event profiles' });

  for (const p of profiles) if (p.enabledCharacters.length === 0) issues.push({ file: `profiles/${p.id}`, message: 'no characters installed' });
  return { profiles, routines, characters, issues, notices };
}

export function loadReplayFixture(assetsRoot: string, rel: string): ReplayFixture {
  const abs = resolveAssetPath(assetsRoot, rel);
  if (!abs) throw new Error(`invalid fixture path: ${rel}`);
  const parsed = replayFixtureSchema.safeParse(readJson(abs));
  if (!parsed.success) throw new Error(`invalid fixture ${rel}: ${formatZod(parsed.error)}`);
  return parsed.data;
}
