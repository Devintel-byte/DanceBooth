import type { Direction2, SegmentName } from '@booth/contracts';
import type { ExtractedPose } from './features';
import type { ScorableRoutine } from './scorer';

/**
 * Simulated performers for fairness tests. Each produces a stream of
 * instructor-frame poses (as the tracker would deliver after extraction) at a
 * fixed rate. The reference trajectory is the routine's judged poses joined by
 * shortest-angle interpolation, which is how the on-screen dancer moves
 * between key poses. Deterministic (seeded).
 *
 * These are models of behaviour, not real tracking data.
 */

export type PerformerKind =
  | 'expert' // follows closely, normal reaction delay
  | 'good' // follows, later and looser
  | 'late' // follows well but reacts slowly (0.7 s)
  | 'sloppy' // half-hearted: small versions of the moves
  | 'still' // stands with arms down, slight sway
  | 'bobber' // dances to the beat with generic arm pumps, ignores the moves
  | 'flailer' // waves arms everywhere, fast
  | 'wrong' // dances well, but a different routine
  | 'sameside'; // follows closely but uses the same arm as the dancer (not mirror-wise)

export const SEGS: SegmentName[] = ['leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm', 'torso', 'leftThigh', 'leftShin', 'rightThigh', 'rightShin'];

export const REST_ANGLES: Record<SegmentName, number> = {
  leftUpperArm: deg(Math.atan2(-1, 0.12)),
  leftForearm: deg(Math.atan2(-1, 0.06)),
  rightUpperArm: deg(Math.atan2(-1, -0.12)),
  rightForearm: deg(Math.atan2(-1, -0.06)),
  torso: 90,
  leftThigh: -88,
  leftShin: -90,
  rightThigh: -92,
  rightShin: -90,
};

function deg(r: number): number {
  return (r * 180) / Math.PI;
}
function wrap(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}
function dirOf(a: number): Direction2 {
  const r = (a * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Smooth noise: sum of a few sinusoids with random phase, amplitude in degrees. */
function smoothNoise(rand: () => number, ampDeg: number): (t: number) => number {
  const parts = [0.35, 0.9, 2.1].map((f) => ({ f: f * (0.7 + rand() * 0.6), p: rand() * Math.PI * 2 }));
  return (t) => (ampDeg / Math.sqrt(1.5)) * parts.reduce((s, { f, p }) => s + Math.sin(2 * Math.PI * f * t + p), 0) / Math.sqrt(parts.length / 2) / Math.sqrt(2);
}

function poseAngles(pose: Partial<Record<SegmentName, readonly [number, number]>>): Partial<Record<SegmentName, number>> {
  const out: Partial<Record<SegmentName, number>> = {};
  for (const s of SEGS) {
    const v = pose[s];
    if (v) out[s] = deg(Math.atan2(v[1], v[0]));
  }
  return out;
}

/** Reference angle of each segment at song time t (interpolated between judged poses, rest before the first). */
export function referenceAt(routine: ScorableRoutine, t: number): Record<SegmentName, number> {
  const moves = routine.moves.filter((m) => m.judged !== false);
  const out = { ...REST_ANGLES };
  let i = moves.findIndex((m) => m.timeSec > t);
  if (i === -1) i = moves.length;
  const prev = i > 0 ? moves[i - 1]! : null;
  const next = i < moves.length ? moves[i]! : null;
  const pa = prev ? poseAngles(prev.pose) : {};
  const na = next ? poseAngles(next.pose) : {};
  const t0 = prev ? prev.timeSec : (next?.timeSec ?? 0) - 1;
  const t1 = next ? next.timeSec : t0 + 1;
  // ease in-out so the dancer dwells near key poses
  const u0 = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
  const u = u0 * u0 * (3 - 2 * u0);
  for (const s of SEGS) {
    const a = pa[s] ?? REST_ANGLES[s];
    const b = na[s] ?? (prev ? a : REST_ANGLES[s]);
    out[s] = a + wrap(b - a) * (prev ? u : u0 > 0.5 ? 1 : 0);
  }
  return out;
}

const SWAP: Record<SegmentName, SegmentName> = {
  leftUpperArm: 'rightUpperArm',
  rightUpperArm: 'leftUpperArm',
  leftForearm: 'rightForearm',
  rightForearm: 'leftForearm',
  leftThigh: 'rightThigh',
  rightThigh: 'leftThigh',
  leftShin: 'rightShin',
  rightShin: 'leftShin',
  torso: 'torso',
};

/** The same body seen in the other mirroring convention: swap sides, flip x. */
export function flipAngles(a: Record<SegmentName, number>): Record<SegmentName, number> {
  const out = { ...a };
  for (const s of SEGS) out[SWAP[s]] = wrap(180 - a[s]);
  return out;
}

function toPose(angles: Record<SegmentName, number>): ExtractedPose {
  const segments: ExtractedPose['segments'] = {};
  for (const s of SEGS) segments[s] = { direction: dirOf(angles[s]), confidence: 0.95 };
  return { segments, bodyScale: 0.25, coreConfidence: 0.95 };
}

export interface Performance {
  /** `pose`: extracted in the routine's convention (mirror); `alt`: the same body in the other convention. */
  frames: { songTimeSec: number; pose: ExtractedPose; alt: ExtractedPose }[];
}

export function perform(kind: PerformerKind, routine: ScorableRoutine, opts: { seed: number; durationSec: number; hz?: number; bpm?: number; other?: ScorableRoutine }): Performance {
  const rand = rng(opts.seed);
  const hz = opts.hz ?? 15;
  const beat = 60 / (opts.bpm ?? 110);
  const noises = Object.fromEntries(SEGS.map((s) => [s, smoothNoise(rand, 1)])) as Record<SegmentName, (t: number) => number>;
  const tracker = () => (rand() - 0.5) * 2 * 4; // ±4° per-frame tracker jitter
  const lag = { expert: 0.3, good: 0.45, late: 0.7, sloppy: 0.4, wrong: 0.3, sameside: 0.3 }[kind as 'expert'] ?? 0;
  const noiseDeg = { expert: 14, good: 22, late: 14, sloppy: 16, wrong: 14, still: 6, bobber: 10, flailer: 0, sameside: 14 }[kind];
  // Personal style: a constant offset per segment (nobody matches the model exactly).
  const styleDeg = { expert: 10, good: 15, late: 10, sloppy: 12, wrong: 10, still: 4, bobber: 8, flailer: 0, sameside: 10 }[kind];
  const style = Object.fromEntries(SEGS.map((s) => [s, (rand() - 0.5) * 2 * styleDeg])) as Record<SegmentName, number>;
  // flailer: fast random walk per arm segment
  const walk = Object.fromEntries(SEGS.map((s) => [s, REST_ANGLES[s]])) as Record<SegmentName, number>;
  const vel = Object.fromEntries(SEGS.map((s) => [s, 0])) as Record<SegmentName, number>;
  const frames: Performance['frames'] = [];
  for (let k = 0; k * (1 / hz) <= opts.durationSec; k++) {
    const t = k / hz;
    let a: Record<SegmentName, number>;
    if (kind === 'expert' || kind === 'good' || kind === 'late') a = referenceAt(routine, t - lag);
    else if (kind === 'sameside') a = flipAngles(referenceAt(routine, t - lag));
    else if (kind === 'wrong') a = referenceAt(opts.other!, t - lag);
    else if (kind === 'sloppy') {
      const r = referenceAt(routine, t - lag);
      a = { ...r };
      for (const s of SEGS) a[s] = REST_ANGLES[s] + wrap(r[s] - REST_ANGLES[s]) * 0.4;
    } else if (kind === 'still') a = { ...REST_ANGLES };
    else if (kind === 'bobber') {
      a = { ...REST_ANGLES };
      const ph = Math.sin((2 * Math.PI * t) / (beat * 2));
      // elbows pump: forearms swing forward/up on the beat, upper arms open a little
      a.leftForearm = -90 + 70 * Math.max(0, ph);
      a.rightForearm = -90 - 70 * Math.max(0, ph);
      a.leftUpperArm = REST_ANGLES.leftUpperArm + 20 * Math.abs(ph);
      a.rightUpperArm = REST_ANGLES.rightUpperArm - 20 * Math.abs(ph);
      a.torso = 90 + 6 * Math.sin((2 * Math.PI * t) / (beat * 4));
    } else {
      for (const s of ['leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm'] as SegmentName[]) {
        vel[s] = vel[s] * 0.85 + (rand() - 0.5) * 220;
        walk[s] = wrap(walk[s] + vel[s] / hz);
      }
      walk.torso = 90 + 12 * Math.sin(t * 3);
      a = { ...walk };
    }
    const out = { ...a };
    for (const s of SEGS) out[s] = a[s] + style[s] + noises[s](t) * noiseDeg + tracker();
    frames.push({ songTimeSec: t, pose: toPose(out), alt: toPose(flipAngles(out)) });
  }
  return { frames };
}
