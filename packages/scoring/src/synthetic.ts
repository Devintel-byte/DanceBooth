import {
  LANDMARK,
  LANDMARK_COUNT,
  mirrorSegmentName,
  type Direction2,
  type Landmark,
  type LandmarkName,
  type SegmentName,
} from '@booth/contracts';

/**
 * Synthetic landmark generation for tests and replay fixtures.
 *
 * This produces geometrically consistent BlazePose-topology landmarks for a
 * participant performing an instructor-frame pose. It is NOT real tracking data
 * and must never be presented as such; fixtures built from it are labelled
 * `synthetic` in their provenance record.
 */
export interface SynthOptions {
  mirroring: 'mirror' | 'same-side';
  /** Hip-centre position in raw normalised image coordinates. */
  hipX?: number;
  hipY?: number;
  /** Torso length in normalised image units (controls apparent body size). */
  torso?: number;
  /** Proportions relative to torso length, to simulate different bodies. */
  proportions?: Partial<typeof DEFAULT_PROPORTIONS>;
  visibility?: number;
  /** Landmarks to report with zero visibility (simulated occlusion). */
  hidden?: readonly LandmarkName[];
}

export const DEFAULT_PROPORTIONS = {
  upperArm: 0.55,
  forearm: 0.5,
  thigh: 0.75,
  shin: 0.7,
  shoulderWidth: 0.7,
  hipWidth: 0.45,
  neck: 0.35,
};

const DEFAULT_DIRS: Record<SegmentName, Direction2> = {
  leftUpperArm: { x: 0.15, y: -1 },
  leftForearm: { x: 0.1, y: -1 },
  rightUpperArm: { x: -0.15, y: -1 },
  rightForearm: { x: -0.1, y: -1 },
  leftThigh: { x: 0.05, y: -1 },
  leftShin: { x: 0, y: -1 },
  rightThigh: { x: -0.05, y: -1 },
  rightShin: { x: 0, y: -1 },
  torso: { x: 0, y: 1 },
};

function unit(d: Direction2): Direction2 {
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
}

export function synthesizeLandmarks(
  instructorPose: Partial<Record<SegmentName, Direction2 | readonly [number, number]>>,
  opts: SynthOptions,
): Landmark[] {
  const p = { ...DEFAULT_PROPORTIONS, ...opts.proportions };
  const T = opts.torso ?? 0.28;
  const hip = { x: opts.hipX ?? 0.5, y: opts.hipY ?? 0.6 };
  const v = opts.visibility ?? 0.95;

  /** Display-space direction for a participant (anatomical) segment, converted to raw image space. */
  const rawDir = (participantSeg: SegmentName): Direction2 => {
    const instructorSeg = opts.mirroring === 'mirror' ? mirrorSegmentName(participantSeg) : participantSeg;
    const given = instructorPose[instructorSeg];
    const d = unit(
      given === undefined
        ? DEFAULT_DIRS[instructorSeg]
        : Array.isArray(given)
          ? { x: given[0] as number, y: given[1] as number }
          : (given as Direction2),
    );
    // Display -> raw image: flip y always; flip x in mirror mode.
    return { x: opts.mirroring === 'mirror' ? -d.x : d.x, y: -d.y };
  };

  const add = (a: { x: number; y: number }, d: Direction2, len: number) => ({
    x: a.x + d.x * len * T,
    y: a.y + d.y * len * T,
  });

  const torsoDir = rawDir('torso');
  const shoulderC = add(hip, torsoDir, 1);
  // Perpendicular to the torso pointing toward image +x (participant's left when facing camera).
  const across = { x: -torsoDir.y, y: torsoDir.x };
  const acrossSign = across.x >= 0 ? 1 : -1;
  const side = { x: across.x * acrossSign, y: across.y * acrossSign };

  const pts = new Map<LandmarkName, { x: number; y: number }>();
  pts.set('leftShoulder', add(shoulderC, side, p.shoulderWidth / 2));
  pts.set('rightShoulder', add(shoulderC, side, -p.shoulderWidth / 2));
  pts.set('leftHip', add(hip, side, p.hipWidth / 2));
  pts.set('rightHip', add(hip, side, -p.hipWidth / 2));
  pts.set('leftElbow', add(pts.get('leftShoulder')!, rawDir('leftUpperArm'), p.upperArm));
  pts.set('leftWrist', add(pts.get('leftElbow')!, rawDir('leftForearm'), p.forearm));
  pts.set('rightElbow', add(pts.get('rightShoulder')!, rawDir('rightUpperArm'), p.upperArm));
  pts.set('rightWrist', add(pts.get('rightElbow')!, rawDir('rightForearm'), p.forearm));
  pts.set('leftKnee', add(pts.get('leftHip')!, rawDir('leftThigh'), p.thigh));
  pts.set('leftAnkle', add(pts.get('leftKnee')!, rawDir('leftShin'), p.shin));
  pts.set('rightKnee', add(pts.get('rightHip')!, rawDir('rightThigh'), p.thigh));
  pts.set('rightAnkle', add(pts.get('rightKnee')!, rawDir('rightShin'), p.shin));

  const head = add(shoulderC, torsoDir, p.neck);
  for (const n of ['nose', 'leftEyeInner', 'leftEye', 'leftEyeOuter', 'rightEyeInner', 'rightEye', 'rightEyeOuter', 'leftEar', 'rightEar', 'mouthLeft', 'mouthRight'] as const) {
    const s = n.startsWith('left') || n === 'mouthLeft' ? 1 : n.startsWith('right') || n === 'mouthRight' ? -1 : 0;
    pts.set(n, add(head, side, s * 0.08));
  }
  for (const s of ['left', 'right'] as const) {
    const wrist = pts.get(`${s}Wrist`)!;
    const ankle = pts.get(`${s}Ankle`)!;
    pts.set(`${s}Pinky`, wrist);
    pts.set(`${s}Index`, wrist);
    pts.set(`${s}Thumb`, wrist);
    pts.set(`${s}Heel`, ankle);
    pts.set(`${s}FootIndex`, ankle);
  }

  const hidden = new Set(opts.hidden ?? []);
  const out: Landmark[] = new Array(LANDMARK_COUNT);
  for (const [name, idx] of Object.entries(LANDMARK) as [LandmarkName, number][]) {
    const pt = pts.get(name) ?? hip;
    const visibility = hidden.has(name) ? 0.02 : v;
    out[idx] = { x: pt.x, y: pt.y, z: 0, visibility, presence: visibility };
  }
  return out;
}
