// Builds booth routines from licensed animation clips and prepared music.
//
// It first measures each dance clip's own beat (scripts/clip-beats.ts). Then,
// for each track in assets/audio/tracks.json, it builds `variations` random
// dances from the clip pool in assets/choreography/plan.json: every phrase
// starts on a song beat, on one of the clip's steps, played at the speed that
// puts the clip's steps on the song's beats. The booth plays a different
// variation each session. For each dance the scoring reference is extracted
// by playing that exact timeline on the character skeleton and measuring
// segment directions at each judged beat, so what the instructor does and
// what is judged come from the same data.
//
// Usage: pnpm assets:routines [--plan <file>] [--dry-run]
// Works with GLB or FBX characters and GLB/FBX clip files (Mixamo exports).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { characterCatalogSchema, routineManifestSchema, type AnimationSegment, type SegmentName } from '@booth/contracts';
import { generateClipTimeline, sampleClipTimeline, seededRandom, type DanceClip } from '@booth/choreography';
import { DIFFICULTY_PRESETS, moveWeights, restMatch } from '@booth/scoring';
import { measureClipBeat } from './clip-beats';
import {
  ClipPlayer,
  extractSegmentPose,
  fitHipsToCharacter,
  retargetClips,
  parseModel,
  validateBoneMap,
} from '../apps/desktop/src/renderer/participant/scene/glb';

// FBX characters with embedded textures (e.g. Mixamo "Michelle") make three's
// TextureLoader create an <img>. Node has no DOM; textures are irrelevant for
// pose extraction, so a stub element lets the loader skip them.
const g = globalThis as { document?: unknown };
g.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }) };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const args = process.argv.slice(2);
const planFile = args.includes('--plan') ? path.resolve(args[args.indexOf('--plan') + 1]!) : path.join(assets, 'choreography/plan.json');
const dryRun = args.includes('--dry-run');

const planSchema = z.object({
  character: z.string(),
  clipFiles: z.array(z.string()).default([]),
  countInBeats: z.number().int().min(0).default(4),
  judgeEveryBeats: z.number().int().min(1).default(2),
  /** Clips the random dances are made from: a clip name, or { clip, weight } (default weight 1). */
  pool: z.array(z.string().or(z.object({ clip: z.string(), weight: z.number().positive().default(1) }))).min(2),
  /** Different dances per song; the booth picks one per session. */
  variations: z.number().int().min(1).max(32).default(16),
  /** Phrase lengths in beats to pick from. */
  phraseBeats: z.array(z.number().int().min(2)).min(1).default([8, 8, 16]),
  /** Manual beat for clips the measurement gets wrong: { clip: { beatSec, downbeatSec } }. */
  beatOverrides: z.record(z.string(), z.object({ beatSec: z.number().positive(), downbeatSec: z.number().nonnegative(), loops: z.boolean().default(false) })).default({}),
  difficulty: z.record(z.string(), z.enum(['easy', 'normal', 'hard'])).default({}),
  /** Moves closer than this (mean angle, degrees) to the previous judged move are animation-only. */
  minMoveChangeDeg: z.number().nonnegative().default(12),
});

interface TrackMeta {
  id: string;
  title: string;
  artist?: string;
  file: string;
  bpm: number;
  firstBeatSec: number;
  durationSec: number;
  beats: number;
  license: { source: string; license: string; attribution: string; placeholder: boolean };
}

function bytesOf(rel: string): ArrayBuffer {
  const b = readFileSync(path.join(assets, rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function meanAngleDiffDeg(a: Partial<Record<SegmentName, [number, number]>>, b: Partial<Record<SegmentName, [number, number]>>): number {
  const keys = (Object.keys(a) as SegmentName[]).filter((k) => b[k]);
  if (keys.length === 0) return 180;
  let sum = 0;
  for (const k of keys) {
    const [ax, ay] = a[k]!;
    const [bx, by] = b[k]!;
    sum += (Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) * 180) / Math.PI;
  }
  return sum / keys.length;
}

const plan = planSchema.parse(JSON.parse(readFileSync(planFile, 'utf-8')));
const catalog = characterCatalogSchema.parse(JSON.parse(readFileSync(path.join(assets, 'characters/catalog.json'), 'utf-8')));
const character = catalog.characters.find((c) => c.id === plan.character);
if (!character || character.kind !== 'glb' || !character.rig || !character.file) {
  throw new Error(`plan character "${plan.character}" is not a rigged glb/fbx character in the catalog`);
}
const rig = character.rig;
const model = await parseModel(bytesOf(character.file), character.file);
const missing = validateBoneMap(model.scene, rig.boneMap);
if (missing.length) throw new Error(`bone map refers to missing bones: ${missing.join(', ')}`);
const extraClips = [];
for (const f of plan.clipFiles) extraClips.push(...(await parseModel(bytesOf(f), f)).animations);
const player = new ClipPlayer(model.scene, fitHipsToCharacter(model.scene, retargetClips(model.scene, [...model.animations, ...extraClips]), rig.clips.idle));

const poolEntries = plan.pool.map((p) => (typeof p === 'string' ? { clip: p, weight: 1 } : p));
const needed = new Set([rig.clips.idle, ...poolEntries.map((p) => p.clip)]);
const absent = [...needed].filter((c) => !player.has(c));
if (absent.length) {
  throw new Error(`clips not found: ${absent.join(', ')}. Available: ${Object.keys(player.durations).join(', ')}`);
}

// Each clip's own beat, measured from the dancer's bounce (or overridden in the plan).
const pool: DanceClip[] = poolEntries.map(({ clip, weight }) => {
  const durationSec = player.durations[clip]!;
  const o = plan.beatOverrides[clip];
  const m = o
    ? { ...o, beats: Math.floor((durationSec - o.downbeatSec) / o.beatSec + 1e-6), confidence: Infinity }
    : measureClipBeat(player, model.scene, clip);
  console.info(`  ${clip.padEnd(20)} ${(60 / m.beatSec).toFixed(1)} bpm, step at ${m.downbeatSec.toFixed(2)} s, ${m.beats} beats${m.loops ? ', loops' : ''}${o ? ' (override)' : ''}`);
  return { name: clip, durationSec, beatSec: m.beatSec, downbeatSec: m.downbeatSec, beats: m.beats, loops: m.loops, weight };
});

/** Judged moves for one dance: every N beats, off the cross-fade instants; near-duplicate poses are animation-only. */
function extractMoves(timeline: AnimationSegment[], at: (b: number) => number, beat: number, lastBeat: number) {
  const moves = [];
  let lastJudged: Partial<Record<SegmentName, [number, number]>> | null = null;
  const poseAt = (t: number) => {
    player.apply(sampleClipTimeline(timeline, t, player.durations));
    return extractSegmentPose(model.scene, rig.boneMap);
  };
  for (let jb = plan.countInBeats + 2; jb < lastBeat; jb += plan.judgeEveryBeats) {
    // Judge the move where the dancer is most still inside its slot (the pose
    // a player sees and copies), not mid-swing: the scorer asks players to
    // hold the pose for a moment, so the reference has to be held too.
    // Offsets stay clear of the cross-fade at the start of a phrase.
    let t = at(jb) + beat * 0.5;
    let stillest = Infinity;
    for (let off = 0.5; off <= plan.judgeEveryBeats - 0.5 + 1e-9; off += 0.25) {
      const c = at(jb) + beat * off;
      const motion = meanAngleDiffDeg(poseAt(c - HOLD_SEC), poseAt(c + HOLD_SEC));
      if (motion < stillest) {
        stillest = motion;
        t = c;
      }
    }
    const samples = sampleClipTimeline(timeline, t, player.durations);
    player.apply(samples);
    const pose = extractSegmentPose(model.scene, rig.boneMap);
    const arms = (['leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm'] as const).filter((s) => s in pose).length;
    const change = lastJudged ? meanAngleDiffDeg(pose, lastJudged) : 180;
    // Poses that look like standing still are never judged (the scorer skips them
    // too); checked at every difficulty so the count is the same whichever is chosen.
    const restLike = Object.values(DIFFICULTY_PRESETS).some((c) => restMatch(pose, REQUIRED_GROUPS, c, moveWeights(pose, REQUIRED_GROUPS, c)) >= c.maxRestMatch);
    const judged = arms >= 3 && change >= plan.minMoveChangeDeg && !restLike;
    if (judged) lastJudged = pose;
    moves.push({ timeSec: +t.toFixed(4), label: samples[samples.length - 1]!.clip, judged, pose, change });
  }
  return moves;
}

/**
 * Every dance of a song judges the same number of moves, so points from
 * different sessions compare fairly on the leaderboard: the least distinct
 * judged moves (smallest change from the previous one) become animation-only
 * until the count matches.
 */
function trimJudged(moves: ReturnType<typeof extractMoves>, target: number) {
  const judged = moves.filter((m) => m.judged).sort((a, b) => a.change - b.change);
  for (const m of judged.slice(0, Math.max(0, judged.length - target))) m.judged = false;
  return moves.map(({ change: _change, ...m }) => m);
}

const REQUIRED_GROUPS = ['arms', 'torso'] as const;
/** Half the window over which a judged pose must be held (matches the scorer's sustainSec). */
const HOLD_SEC = 0.15;
const tracks = JSON.parse(readFileSync(path.join(assets, 'audio/tracks.json'), 'utf-8')) as TrackMeta[];
const usedClipFiles = plan.clipFiles;
for (const track of tracks) {
  const beat = 60 / track.bpm;
  const at = (b: number) => track.firstBeatSec + b * beat;
  const lastBeat = track.beats - 2;
  // Seeds depend on the song id only, so rebuilding gives the same dances.
  const songSeed = [...track.id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  // Make twice as many dances as needed and keep the ones with the most judged
  // moves, then trim them all to the same count.
  const candidates = [];
  for (let v = 0; v < plan.variations * 2; v++) {
    const segments = generateClipTimeline(
      { bpm: track.bpm, firstBeatSec: track.firstBeatSec, durationSec: track.durationSec, beats: track.beats },
      pool,
      { idleClip: rig.clips.idle, countInBeats: plan.countInBeats, phraseBeats: plan.phraseBeats, outroBeats: 2 },
      seededRandom(songSeed + v * 7919),
    );
    const moves = extractMoves(segments, at, beat, lastBeat);
    candidates.push({ segments, moves, judged: moves.filter((m) => m.judged).length });
  }
  const kept = candidates.sort((a, b) => b.judged - a.judged).slice(0, plan.variations);
  const target = Math.min(...kept.map((d) => d.judged));
  const dances = kept.map((d) => ({ segments: d.segments, moves: trimJudged(d.moves, target) }));
  const timeline = dances[0]!.segments;
  const moves = dances[0]!.moves;

  const draft = {
    schemaVersion: 1,
    id: track.id,
    contentVersion: '1.1.0',
    title: track.title,
    subtitle: track.artist,
    audio: { file: track.file, offsetMs: 0 },
    animation: { kind: 'glb-timeline', character: character.id, clipFiles: usedClipFiles, segments: timeline },
    durationSec: track.durationSec,
    bpm: track.bpm,
    firstBeatSec: track.firstBeatSec,
    sections: [
      { name: 'Count-in', startSec: 0 },
      { name: 'Groove', startSec: +at(plan.countInBeats).toFixed(3) },
    ],
    difficulty: plan.difficulty[track.id] ?? 'normal',
    mirroring: 'mirror',
    requiredGroups: [...REQUIRED_GROUPS],
    moves,
    variations: dances.slice(1),
    license: {
      audio: track.license,
      choreography: {
        source: `Generated by scripts/build-routines.ts from ${character.license?.source ?? character.id}${plan.clipFiles.length ? ` and ${plan.clipFiles.join(', ')}` : ''}`,
        license: character.license?.license ?? 'see asset-licenses.md',
        placeholder: character.placeholder,
      },
    },
    integrity: {
      [track.file]: createHash('sha256').update(readFileSync(path.join(assets, track.file))).digest('hex'),
    },
  };
  routineManifestSchema.parse(draft);
  const judged = dances.map((d) => d.moves.filter((m) => m.judged).length);
  console.info(`${track.id}: ${dances.length} dances, ${Math.min(...judged)}-${Math.max(...judged)} judged moves each${dryRun ? ' (dry run)' : ''}`);
  if (!dryRun) writeFileSync(path.join(assets, 'routines', `${track.id}.json`), JSON.stringify(draft, null, 1) + '\n');
}
player.dispose();
