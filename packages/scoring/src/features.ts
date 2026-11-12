import {
  LANDMARK,
  SEGMENTS,
  SEGMENT_NAMES,
  mirrorSegmentName,
  type Direction2,
  type JointName,
  type Landmark,
  type SegmentName,
} from '@booth/contracts';

export interface FeatureConfig {
  /** Landmarks with visibility below this are treated as missing, not wrong. */
  minVisibility: number;
  /** Segments shorter than this fraction of body scale are degenerate (too foreshortened to judge). */
  minSegmentFraction: number;
}

export const DEFAULT_FEATURE_CONFIG: FeatureConfig = {
  minVisibility: 0.5,
  minSegmentFraction: 0.12,
};

export interface SegmentFeature {
  /** Unit display-space direction in the instructor's frame of reference. */
  direction: Direction2;
  /** min(visibility) of the two endpoints, or 1 when the provider has no visibility. */
  confidence: number;
}

/**
 * A participant pose re-expressed in the instructor's frame of reference so it
 * can be compared directly with routine reference poses. Segments that could
 * not be measured are absent (missing evidence), never zero.
 */
export interface ExtractedPose {
  segments: Partial<Record<SegmentName, SegmentFeature>>;
  /** Torso length in normalised image units, or null when it could not be measured. */
  bodyScale: number | null;
  /** Mean visibility of the core joints (shoulders, hips). */
  coreConfidence: number;
}

type Mirroring = 'mirror' | 'same-side';

interface Point {
  x: number;
  y: number;
  v: number;
}

function vis(l: Landmark | undefined): number {
  if (!l) return 0;
  // Providers that omit visibility are treated as fully visible.
  return l.visibility ?? 1;
}

function joint(lms: readonly Landmark[], name: JointName): Point | null {
  if (name === 'hipCenter' || name === 'shoulderCenter') {
    const [a, b] =
      name === 'hipCenter'
        ? [lms[LANDMARK.leftHip], lms[LANDMARK.rightHip]]
        : [lms[LANDMARK.leftShoulder], lms[LANDMARK.rightShoulder]];
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(vis(a), vis(b)) };
  }
  const l = lms[LANDMARK[name]];
  if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
  return { x: l.x, y: l.y, v: vis(l) };
}

/**
 * Body scale = torso length (shoulder centre to hip centre). It is the most
 * stable length under arm/leg motion and normalises for body size and distance.
 */
export function measureBodyScale(lms: readonly Landmark[], minVisibility: number): number | null {
  const s = joint(lms, 'shoulderCenter');
  const h = joint(lms, 'hipCenter');
  if (!s || !h || s.v < minVisibility || h.v < minVisibility) return null;
  const len = Math.hypot(s.x - h.x, s.y - h.y);
  return len > 1e-4 ? len : null;
}

/**
 * Converts raw `image-normalized` landmarks (unmirrored camera image, y down)
 * into instructor-frame display directions.
 *
 * Conventions (see docs/decisions/0004-scoring-conventions.md):
 * - Reference poses describe the instructor as rendered facing the viewer,
 *   x to the viewer's right, y up, named by the instructor's anatomical side.
 * - `same-side`: the participant moves the same anatomical limb. A person facing
 *   the camera appears in the raw image the way the instructor appears on screen,
 *   so directions are used as captured (only y is flipped) and names are kept.
 * - `mirror`: the participant copies the instructor like a mirror. Directions are
 *   flipped horizontally and the participant's left limb is compared with the
 *   instructor's right limb.
 */
export function extractPose(
  lms: readonly Landmark[],
  mirroring: Mirroring,
  config: FeatureConfig = DEFAULT_FEATURE_CONFIG,
): ExtractedPose {
  const bodyScale = measureBodyScale(lms, config.minVisibility);
  const core = [LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftHip, LANDMARK.rightHip];
  const coreConfidence = core.reduce((sum, i) => sum + vis(lms[i]), 0) / core.length;
  const segments: Partial<Record<SegmentName, SegmentFeature>> = {};

  for (const name of SEGMENT_NAMES) {
    const [fromName, toName] = SEGMENTS[name];
    const a = joint(lms, fromName);
    const b = joint(lms, toName);
    if (!a || !b) continue;
    const confidence = Math.min(a.v, b.v);
    if (confidence < config.minVisibility) continue;
    let dx = b.x - a.x;
    const dy = -(b.y - a.y); // image y is down; display y is up
    const len = Math.hypot(dx, dy);
    // Without a body scale we cannot tell foreshortening from a short limb; require a tiny floor.
    const minLen = bodyScale !== null ? bodyScale * config.minSegmentFraction : 1e-3;
    if (len < minLen) continue;
    if (mirroring === 'mirror') dx = -dx;
    const target = mirroring === 'mirror' ? mirrorSegmentName(name) : name;
    segments[target] = { direction: { x: dx / len, y: dy / len }, confidence };
  }
  return { segments, bodyScale, coreConfidence };
}

export function normalizeDirection(d: readonly [number, number] | Direction2): Direction2 | null {
  const x = Array.isArray(d) ? d[0] : (d as Direction2).x;
  const y = Array.isArray(d) ? d[1] : (d as Direction2).y;
  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len < 1e-9) return null;
  return { x: x / len, y: y / len };
}

/** Angle between two unit directions, in degrees, robust to rounding. */
export function angleBetweenDeg(a: Direction2, b: Direction2): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return (Math.acos(dot) * 180) / Math.PI;
}
