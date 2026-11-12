import {
  SEGMENT_NAMES,
  type Direction2,
  type RoutineManifest,
  type RoutineMove,
  type SegmentName,
} from '@booth/contracts';

function unit(x: number, y: number): Direction2 {
  const l = Math.hypot(x, y);
  return { x: x / l, y: y / l };
}

/** Neutral standing pose in instructor display space (x right, y up), unit directions. */
export const REST_POSE: Readonly<Record<SegmentName, Direction2>> = Object.freeze({
  leftUpperArm: unit(0.18, -1),
  leftForearm: unit(0.1, -1),
  rightUpperArm: unit(-0.18, -1),
  rightForearm: unit(-0.1, -1),
  leftThigh: unit(0.05, -1),
  leftShin: unit(0, -1),
  rightThigh: unit(-0.05, -1),
  rightShin: unit(0, -1),
  torso: unit(0, 1),
});

export type FullPose = Record<SegmentName, Direction2>;

function angleOf(d: Direction2): number {
  return Math.atan2(d.y, d.x);
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Fills unspecified segments from the previous full pose (or rest). */
export function resolveMoves(moves: readonly RoutineMove[]): { timeSec: number; pose: FullPose }[] {
  let prev: FullPose = { ...REST_POSE };
  return moves.map((m) => {
    const pose = { ...prev };
    for (const seg of SEGMENT_NAMES) {
      const d = m.pose[seg];
      if (d) {
        const len = Math.hypot(d[0], d[1]);
        pose[seg] = { x: d[0] / len, y: d[1] / len };
      }
    }
    prev = pose;
    return { timeSec: m.timeSec, pose };
  });
}

export interface PoseSamplerOptions {
  /** Fraction of the gap between keyframes spent holding the keyframe pose. */
  holdFraction: number;
}

/**
 * Samples the instructor pose at a song time. Pure and deterministic, so the
 * instructor animation and the scoring reference are the same data.
 */
export class RoutinePoseSampler {
  private readonly keys: { timeSec: number; pose: FullPose }[];

  constructor(
    routine: Pick<RoutineManifest, 'moves'>,
    private readonly opts: PoseSamplerOptions = { holdFraction: 0.25 },
  ) {
    this.keys = [{ timeSec: 0, pose: { ...REST_POSE } }, ...resolveMoves(routine.moves)];
  }

  sample(songTimeSec: number, out: FullPose = { ...REST_POSE }): FullPose {
    const keys = this.keys;
    if (songTimeSec <= keys[0]!.timeSec) return Object.assign(out, keys[0]!.pose);
    let i = 0;
    // Linear scan is fine for short routines; keys are sorted.
    while (i + 1 < keys.length && keys[i + 1]!.timeSec <= songTimeSec) i++;
    const a = keys[i]!;
    const b = keys[i + 1];
    if (!b) return Object.assign(out, a.pose);
    const span = b.timeSec - a.timeSec;
    const hold = span * this.opts.holdFraction;
    const raw = span - hold > 0 ? (songTimeSec - a.timeSec - hold) / (span - hold) : 1;
    const t = easeInOut(Math.max(0, Math.min(1, raw)));
    for (const seg of SEGMENT_NAMES) {
      const ang = lerpAngle(angleOf(a.pose[seg]), angleOf(b.pose[seg]), t);
      out[seg] = { x: Math.cos(ang), y: Math.sin(ang) };
    }
    return out;
  }
}

export interface SmoothingOptions {
  /** Fraction of the remaining angle covered per 60 Hz frame (0..1). */
  alphaPer60Hz: number;
  /** Maximum torso tilt from vertical, degrees (anatomical constraint for avatars). */
  maxTorsoTiltDeg: number;
}

export const DEFAULT_SMOOTHING: SmoothingOptions = { alphaPer60Hz: 0.35, maxTorsoTiltDeg: 35 };

/**
 * Frame-rate independent exponential smoothing of a pose toward a target
 * (live avatar retargeting). Operates on angles so directions stay unit length.
 */
export function smoothPoseToward(
  current: FullPose,
  target: Readonly<FullPose>,
  dtSec: number,
  opts: SmoothingOptions = DEFAULT_SMOOTHING,
): FullPose {
  const alpha = 1 - Math.pow(1 - opts.alphaPer60Hz, Math.max(0, dtSec) * 60);
  for (const seg of SEGMENT_NAMES) {
    let goal = angleOf(target[seg]);
    if (seg === 'torso') {
      const max = (opts.maxTorsoTiltDeg * Math.PI) / 180;
      goal = Math.max(Math.PI / 2 - max, Math.min(Math.PI / 2 + max, goal));
    }
    const a = lerpAngle(angleOf(current[seg]), goal, alpha);
    current[seg] = { x: Math.cos(a), y: Math.sin(a) };
  }
  return current;
}

/** Beat helpers for cues and stage effects. */
export function beatAt(songTimeSec: number, bpm: number | undefined, firstBeatSec: number) {
  if (!bpm) return null;
  const beatLen = 60 / bpm;
  const rel = (songTimeSec - firstBeatSec) / beatLen;
  const index = Math.floor(rel);
  return { index, phase: rel - index, beatLengthSec: beatLen };
}

/** Index of the next judged move at or after `songTimeSec`, or -1. */
export function nextMoveIndex(moves: readonly RoutineMove[], songTimeSec: number): number {
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!;
    if (m.judged !== false && m.timeSec >= songTimeSec) return i;
  }
  return -1;
}
