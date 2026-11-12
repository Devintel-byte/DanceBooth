import { JOINT_GROUPS, type Difficulty, type JointGroup, type SegmentName } from '@booth/contracts';
import { angleBetweenDeg, normalizeDirection, type ExtractedPose } from './features';

export interface ScoringConfig {
  /** Angle error at or below which a segment scores 1. */
  perfectAngleDeg: number;
  /** Angle error at or above which a segment scores 0. */
  zeroAngleDeg: number;
  /** How early (seconds before the move) a pose may be taken for it. */
  timingToleranceSec: number;
  /**
   * How late (seconds after the move) a pose may be taken for it. People copy
   * an on-screen dancer with a reaction delay, so this is wider than the early side.
   */
  lateToleranceSec: number;
  /**
   * Offsets within this many seconds of the player's own steady reaction delay
   * count as perfectly on time.
   */
  perfectTimingSec: number;
  /** Delay beyond the player's steady delay at which timing quality reaches 0. */
  timingSpreadSec: number;
  /**
   * The pose must be held: a move's quality is the average over samples within
   * this many seconds of the chosen moment, so passing through the pose while
   * waving does not score.
   */
  sustainSec: number;
  /**
   * Moves whose reference pose is matched at least this well by someone just
   * standing (arms down, hands on hips) are not judged: they cannot tell
   * dancing from standing still.
   */
  maxRestMatch: number;
  /**
   * How much timing can take off a move's score (0..1). The rest of the score
   * is pose accuracy: points mainly reward how closely the move is matched.
   */
  timingWeight: number;
  /** Minimum fraction of required segment weight that must be observed to judge a move. */
  minEvidence: number;
  /** Per-segment weights; distal segments carry slightly less weight because they are noisier. */
  segmentWeights: Record<SegmentName, number>;
  /** Most points one move can earn (a match). */
  pointsPerMove: number;
  /** Points for a close match. Anything less than close earns nothing. */
  pointsClose: number;
  /** Held-pose accuracy (0..1, relative to standing still, timing applied) that counts as a match. */
  matchAt: number;
  /** Accuracy that counts as a close match. */
  closeAt: number;
}

/**
 * Match / close thresholds (decision 0007). v3 raised them from 0.7 / 0.4 so
 * moving about without following the dancer no longer collects close matches;
 * eased slightly on 2026-11-04 (0.72 / 0.58 -> 0.68 / 0.52) so it is not frustrating.
 */
const MATCH_AT = 0.68;
const CLOSE_AT = 0.52;
/**
 * The pose must be held about this long either side of the moment judged (all
 * difficulties). Longer holds shut out more random movement but cost real
 * dancers points, because the Mixamo dances flow rather than stop on poses:
 * a perfect copy of the 3D dancer scored 92-100 % (easy) at 0.15 s against
 * 70-97 % at 0.24 s. The builder judges each move where the dancer is most
 * still (scripts/build-routines.ts, HOLD_SEC).
 */
const SUSTAIN_SEC = 0.15;

const BASE_WEIGHTS: Record<SegmentName, number> = {
  leftUpperArm: 1,
  rightUpperArm: 1,
  leftForearm: 0.8,
  rightForearm: 0.8,
  leftThigh: 0.8,
  rightThigh: 0.8,
  leftShin: 0.6,
  rightShin: 0.6,
  torso: 0.6,
};

export const DIFFICULTY_PRESETS: Record<Difficulty, ScoringConfig> = {
  easy: {
    perfectAngleDeg: 24,
    zeroAngleDeg: 76,
    timingToleranceSec: 0.3,
    lateToleranceSec: 0.8,
    perfectTimingSec: 0.2,
    timingSpreadSec: 0.6,
    sustainSec: SUSTAIN_SEC,
    maxRestMatch: 0.75,
    timingWeight: 0.1,
    minEvidence: 0.5,
    segmentWeights: BASE_WEIGHTS,
    pointsPerMove: 10,
    pointsClose: 4,
    matchAt: MATCH_AT,
    closeAt: CLOSE_AT,
  },
  normal: {
    perfectAngleDeg: 18,
    zeroAngleDeg: 65,
    timingToleranceSec: 0.25,
    lateToleranceSec: 0.7,
    perfectTimingSec: 0.15,
    timingSpreadSec: 0.45,
    sustainSec: SUSTAIN_SEC,
    maxRestMatch: 0.75,
    timingWeight: 0.15,
    minEvidence: 0.6,
    segmentWeights: BASE_WEIGHTS,
    pointsPerMove: 10,
    pointsClose: 4,
    matchAt: MATCH_AT,
    closeAt: CLOSE_AT,
  },
  hard: {
    perfectAngleDeg: 12,
    zeroAngleDeg: 50,
    timingToleranceSec: 0.2,
    lateToleranceSec: 0.6,
    perfectTimingSec: 0.1,
    timingSpreadSec: 0.3,
    sustainSec: SUSTAIN_SEC,
    maxRestMatch: 0.75,
    timingWeight: 0.25,
    minEvidence: 0.7,
    segmentWeights: BASE_WEIGHTS,
    pointsPerMove: 10,
    pointsClose: 4,
    matchAt: MATCH_AT,
    closeAt: CLOSE_AT,
  },
};

export type FeedbackCategory = 'perfect' | 'great' | 'good' | 'miss' | 'no-read';

export interface SegmentBreakdown {
  segment: SegmentName;
  weight: number;
  /** null when the segment was not observed (excluded, not penalised). */
  angleErrorDeg: number | null;
  score: number | null;
}

export interface PoseMatch {
  /** False when there was not enough evidence to judge. */
  valid: boolean;
  quality: number;
  evidence: number;
  breakdown: SegmentBreakdown[];
}

export function requiredSegments(groups: readonly JointGroup[], reference: Partial<Record<SegmentName, unknown>>): SegmentName[] {
  const set = new Set<SegmentName>();
  for (const g of groups) for (const s of JOINT_GROUPS[g]) if (reference[s] !== undefined) set.add(s);
  return [...set];
}

function segmentScore(errDeg: number, c: ScoringConfig): number {
  if (errDeg <= c.perfectAngleDeg) return 1;
  if (errDeg >= c.zeroAngleDeg) return 0;
  return 1 - (errDeg - c.perfectAngleDeg) / (c.zeroAngleDeg - c.perfectAngleDeg);
}

/**
 * Poses of someone not dancing (instructor frame). A move is only worth
 * judging by how much better the player matches it than these do.
 */
const REST_POSES: Partial<Record<SegmentName, readonly [number, number]>>[] = [
  // arms hanging
  { leftUpperArm: [0.12, -1], leftForearm: [0.06, -1], rightUpperArm: [-0.12, -1], rightForearm: [-0.06, -1], torso: [0, 1], leftThigh: [0.03, -1], leftShin: [0, -1], rightThigh: [-0.03, -1], rightShin: [0, -1] },
  // hands on hips
  { leftUpperArm: [0.55, -0.83], leftForearm: [-0.7, -0.7], rightUpperArm: [-0.55, -0.83], rightForearm: [0.7, -0.7], torso: [0, 1], leftThigh: [0.03, -1], leftShin: [0, -1], rightThigh: [-0.03, -1], rightShin: [0, -1] },
];

/**
 * How much each segment of a reference pose says about whether someone is
 * dancing it: 0 when the segment is where it would be at rest anyway, 1 when
 * it is far from every rest position.
 */
export function segmentDistinctiveness(seg: SegmentName, ref: readonly [number, number], config: ScoringConfig): number {
  const r = normalizeDirection(ref);
  if (!r) return 0;
  let best = 0;
  for (const rest of REST_POSES) {
    const d = rest[seg] ? normalizeDirection(rest[seg]!) : null;
    if (d) best = Math.max(best, segmentScore(angleBetweenDeg(d, r), config));
  }
  return 1 - best;
}

/**
 * Segment weights for one move: the base weight, scaled up for segments that
 * actually move away from rest. A limb that stays by the side still counts a
 * little, so waving it about is not free.
 */
export function moveWeights(
  reference: Partial<Record<SegmentName, readonly [number, number]>>,
  groups: readonly JointGroup[],
  config: ScoringConfig,
): Partial<Record<SegmentName, number>> {
  const out: Partial<Record<SegmentName, number>> = {};
  for (const seg of requiredSegments(groups, reference)) {
    out[seg] = config.segmentWeights[seg] * (0.2 + 0.8 * segmentDistinctiveness(seg, reference[seg]!, config));
  }
  return out;
}

/** How well the best rest pose matches a reference with the given weights (0..1). */
export function restMatch(
  reference: Partial<Record<SegmentName, readonly [number, number]>>,
  groups: readonly JointGroup[],
  config: ScoringConfig,
  weights?: Partial<Record<SegmentName, number>>,
): number {
  let best = 0;
  for (const rest of REST_POSES) {
    const segments: ExtractedPose['segments'] = {};
    for (const [k, v] of Object.entries(rest) as [SegmentName, readonly [number, number]][]) segments[k] = { direction: normalizeDirection(v)!, confidence: 1 };
    best = Math.max(best, matchPose({ segments, bodyScale: 1, coreConfidence: 1 }, reference, groups, config, weights).quality);
  }
  return best;
}

/**
 * Compares one extracted participant pose with one reference pose.
 * Missing segments reduce evidence, never quality. `weights` overrides the
 * per-segment weights (see moveWeights).
 */
export function matchPose(
  pose: ExtractedPose,
  reference: Partial<Record<SegmentName, readonly [number, number]>>,
  groups: readonly JointGroup[],
  config: ScoringConfig,
  weights?: Partial<Record<SegmentName, number>>,
): PoseMatch {
  const segments = requiredSegments(groups, reference);
  let totalWeight = 0;
  let observedWeight = 0;
  let weightedScore = 0;
  const breakdown: SegmentBreakdown[] = [];
  for (const seg of segments) {
    const ref = reference[seg];
    const refDir = ref ? normalizeDirection(ref) : null;
    const weight = weights?.[seg] ?? config.segmentWeights[seg];
    if (!refDir) continue;
    totalWeight += weight;
    const observed = pose.segments[seg];
    if (!observed) {
      breakdown.push({ segment: seg, weight, angleErrorDeg: null, score: null });
      continue;
    }
    const err = angleBetweenDeg(observed.direction, refDir);
    const s = segmentScore(err, config);
    observedWeight += weight;
    weightedScore += s * weight;
    breakdown.push({ segment: seg, weight, angleErrorDeg: err, score: s });
  }
  const evidence = totalWeight > 0 ? observedWeight / totalWeight : 0;
  const valid = evidence >= config.minEvidence && observedWeight > 0;
  return { valid, quality: valid ? weightedScore / observedWeight : 0, evidence, breakdown };
}

/** Timing quality of a pose taken `offsetSec` away from where the player's own steady delay predicts. */
export function timingQuality(offsetSec: number, config: ScoringConfig): number {
  const a = Math.abs(offsetSec);
  if (a <= config.perfectTimingSec) return 1;
  if (a >= config.perfectTimingSec + config.timingSpreadSec) return 0;
  return 1 - (a - config.perfectTimingSec) / config.timingSpreadSec;
}

/**
 * Points ladder: a match earns pointsPerMove (10), a close match pointsClose
 * (4), anything else 0: moving without matching the move, standing still and
 * being out of view earn nothing. Feedback names: perfect = match,
 * good = close, miss = no match, no-read = not seen.
 */
export function feedbackFor(combined: number, valid: boolean, config?: Pick<ScoringConfig, 'matchAt' | 'closeAt'>): FeedbackCategory {
  if (!valid) return 'no-read';
  const c = config ?? { matchAt: MATCH_AT, closeAt: CLOSE_AT };
  if (combined >= c.matchAt) return 'perfect';
  if (combined >= c.closeAt) return 'good';
  return 'miss';
}

export function pointsFor(feedback: FeedbackCategory, config: Pick<ScoringConfig, 'pointsPerMove' | 'pointsClose'>): number {
  if (feedback === 'perfect' || feedback === 'great') return config.pointsPerMove;
  if (feedback === 'good') return config.pointsClose;
  return 0;
}
