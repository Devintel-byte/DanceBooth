import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { routineManifestSchema } from '@booth/contracts';
import { loadContent, mimeTypeFor, resolveAssetPath } from './index';

const repoAssets = path.resolve(__dirname, '../../../assets');

describe('resolveAssetPath', () => {
  const root = path.resolve('/booth/assets');

  it('resolves ordinary relative paths inside the root', () => {
    expect(resolveAssetPath(root, 'audio/song.wav')).toBe(path.join(root, 'audio', 'song.wav'));
  });

  it.each([
    '../secret.txt',
    'audio/../../secret',
    '%2e%2e/secret',
    'audio/%2e%2e/%2e%2e/x',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'C:\\Windows\\win.ini',
    '\\\\server\\share\\x',
    'audio\\..\\x',
    'audio/song.wav::$DATA',
    'audio//song.wav',
    './audio/song.wav',
    'audio/song.wav\0.png',
    '',
    '%E0%A4%A',
  ])('rejects %j', (p) => {
    expect(resolveAssetPath(root, p)).toBeNull();
  });

  it('maps MIME types needed by the runtime', () => {
    expect(mimeTypeFor('x.wasm')).toBe('application/wasm');
    expect(mimeTypeFor('x.glb')).toBe('model/gltf-binary');
    expect(mimeTypeFor('Michelle.FBX')).toBe('application/octet-stream');
    expect(mimeTypeFor('x.task')).toBe('application/octet-stream');
    expect(mimeTypeFor('x.exe')).toBeNull();
  });
});

describe('routine manifest validation', () => {
  const base = {
    schemaVersion: 1,
    id: 'r1',
    contentVersion: '1.0.0',
    title: 'T',
    audio: { file: 'audio/a.wav' },
    animation: { kind: 'procedural-keyframes' },
    durationSec: 10,
    difficulty: 'easy',
    mirroring: 'mirror',
    requiredGroups: ['arms'],
    moves: [{ timeSec: 1, pose: { leftUpperArm: [1, 0] } }],
    license: {
      audio: { source: 's', license: 'l', placeholder: true },
      choreography: { source: 's', license: 'l', placeholder: true },
    },
  };

  it('accepts a minimal manifest', () => {
    expect(routineManifestSchema.safeParse(base).success).toBe(true);
  });

  it('rejects unordered moves, moves past the end, zero directions and traversal paths', () => {
    const bad = [
      { ...base, moves: [{ timeSec: 2, pose: {} }, { timeSec: 1, pose: {} }] },
      { ...base, moves: [{ timeSec: 11, pose: {} }] },
      { ...base, moves: [{ timeSec: 1, pose: { leftUpperArm: [0, 0] } }] },
      { ...base, audio: { file: '../a.wav' } },
      { ...base, moves: [{ timeSec: 1, pose: { leftEar: [1, 0] } }] },
    ];
    for (const b of bad) expect(routineManifestSchema.safeParse(b).success).toBe(false);
  });
});

describe('loadContent', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'booth-content-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('loads the bundled development content without issues', () => {
    const c = loadContent(repoAssets, { verifyIntegrity: true });
    expect(c.issues).toEqual([]);
    expect(c.routines.length).toBeGreaterThan(0);
    expect(c.profiles.length).toBeGreaterThan(0);
  });

  it('reports invalid and missing content instead of throwing', () => {
    mkdirSync(path.join(tmp, 'profiles'));
    mkdirSync(path.join(tmp, 'routines'));
    writeFileSync(path.join(tmp, 'routines', 'broken.json'), '{ not json');
    writeFileSync(path.join(tmp, 'routines', 'bad.json'), JSON.stringify({ schemaVersion: 1 }));
    const c = loadContent(tmp);
    expect(c.routines).toEqual([]);
    const files = c.issues.map((i) => i.file);
    expect(files).toContain('routines/broken.json');
    expect(files).toContain('routines/bad.json');
    expect(files).toContain('characters/catalog.json');
    expect(files).toContain('profiles');
  });

  it('hides optional characters whose model is not installed, without an issue', () => {
    const c = loadContent(repoAssets, { verifyIntegrity: true });
    const ids = c.characters!.characters.map((x) => x.id);
    for (const n of c.notices) {
      const id = n.file.replace('characters/', '');
      expect(ids).not.toContain(id);
      for (const p of c.profiles) expect(p.enabledCharacters).not.toContain(id);
    }
    for (const p of c.profiles) expect(p.enabledCharacters.length).toBeGreaterThan(0);
  });
});
