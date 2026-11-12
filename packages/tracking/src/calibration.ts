import { LANDMARK, type DetectedBody, type JointGroup, type LandmarkName, type PlayerSlotState } from '@booth/contracts';

export type CalibrationIssue =
  | 'not-detected'
  | 'step-back'
  | 'come-closer'
  | 'move-left'
  | 'move-right'
  | 'show-arms'
  | 'show-legs'
  | 'low-confidence'
  /** Duo: this player is standing in the other player's half. */
  | 'wrong-side'
  /** Duo: players are so close their identities could swap. */
  | 'too-close';

export interface SlotCalibration {
  slot: 1 | 2;
  ready: boolean;
  issues: CalibrationIssue[];
}

export interface CalibrationConfig {
  minVisibility: number;
  /** Required landmarks must stay this far inside the frame edges (normalised). */
  edgeMargin: number;
  /** Torso length (normalised height) bounds: too small = too far, too big = too close. */
  minTorso: number;
  maxTorso: number;
  /** Continuous readiness needed before calibration completes. */
  holdMs: number;
  /** Not-ready blips shorter than this pause the hold instead of restarting it. */
  dropoutToleranceMs: number;
  /** Duo: minimum horizontal gap between the two players' hip centres (normalised width). */
  minPlayerGap: number;
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  minVisibility: 0.5,
  edgeMargin: 0.02,
  minTorso: 0.12,
  maxTorso: 0.42,
  holdMs: 1500,
  dropoutToleranceMs: 400,
  minPlayerGap: 0.18,
};

function hipX(body: DetectedBody, mirrorDisplay: boolean): number | null {
  const l = body.imageLandmarks[LANDMARK.leftHip];
  const r = body.imageLandmarks[LANDMARK.rightHip];
  if (!l || !r) return null;
  const x = (l.x + r.x) / 2;
  return mirrorDisplay ? 1 - x : x;
}

const ARM_JOINTS: LandmarkName[] = ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'];
const LEG_JOINTS: LandmarkName[] = ['leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];
const CORE_JOINTS: LandmarkName[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip', 'nose'];

/**
 * Checks framing for each player slot and explains what to fix.
 * Positions are evaluated in display space (mirrored when the display is).
 */
export function evaluateFraming(
  bodies: readonly DetectedBody[],
  players: readonly PlayerSlotState[],
  required: readonly JointGroup[],
  mirrorDisplay: boolean,
  config: CalibrationConfig = DEFAULT_CALIBRATION,
): SlotCalibration[] {
  const duo = players.length === 2;
  const xs = new Map<1 | 2, number>();
  if (duo) {
    for (const p of players) {
      const body = p.status === 'tracked' && p.bodyIndex !== null ? bodies[p.bodyIndex] : undefined;
      const x = body ? hipX(body, mirrorDisplay) : null;
      if (x !== null) xs.set(p.slot, x);
    }
  }
  const tooClose = xs.size === 2 && Math.abs(xs.get(1)! - xs.get(2)!) < config.minPlayerGap;
  return players.map((p) => {
    const body = p.bodyIndex !== null ? bodies[p.bodyIndex] : undefined;
    if (p.status !== 'tracked' || !body) return { slot: p.slot, ready: false, issues: ['not-detected'] };
    const lm = (n: LandmarkName) => body.imageLandmarks[LANDMARK[n]];
    const visible = (n: LandmarkName) => (lm(n)?.visibility ?? 1) >= config.minVisibility;
    const issues: CalibrationIssue[] = [];

    if (!CORE_JOINTS.every(visible)) issues.push('low-confidence');
    const needLegs = required.includes('legs');
    const check = [...CORE_JOINTS, ...ARM_JOINTS, ...(needLegs ? LEG_JOINTS : [])];
    if (!ARM_JOINTS.every(visible)) issues.push('show-arms');
    if (needLegs && !LEG_JOINTS.every(visible)) issues.push('show-legs');

    const ls = lm('leftShoulder');
    const rs = lm('rightShoulder');
    const lh = lm('leftHip');
    const rh = lm('rightHip');
    if (ls && rs && lh && rh) {
      const torso = Math.hypot((ls.x + rs.x - lh.x - rh.x) / 2, (ls.y + rs.y - lh.y - rh.y) / 2);
      if (torso > config.maxTorso) issues.push('step-back');
      else if (torso < config.minTorso) issues.push('come-closer');
    }

    // Any visible required joint near an edge means part of the body is cut off.
    let minX = 1;
    let maxX = 0;
    let cutTopBottom = false;
    for (const n of check) {
      const l = lm(n);
      if (!l || !visible(n)) continue;
      const x = mirrorDisplay ? 1 - l.x : l.x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      if (l.y < config.edgeMargin || l.y > 1 - config.edgeMargin) cutTopBottom = true;
    }
    if (cutTopBottom && !issues.includes('step-back')) issues.push('step-back');
    // Display-space directions: participants see a mirrored view, so "move left" is screen-left.
    if (minX < config.edgeMargin) issues.push('move-right');
    else if (maxX > 1 - config.edgeMargin) issues.push('move-left');

    if (duo) {
      const x = xs.get(p.slot);
      // Player 1 belongs on the display's left half, Player 2 on the right.
      if (x !== undefined && (p.slot === 1 ? x > 0.55 : x < 0.45)) issues.push('wrong-side');
      if (tooClose) issues.push('too-close');
    }

    return { slot: p.slot, ready: issues.length === 0, issues };
  });
}

/** Tracks how long all slots have been continuously ready. */
export class CalibrationHold {
  private readyMs = 0;
  private lastMs: number | null = null;
  private lastReadyMs: number | null = null;

  constructor(
    private readonly holdMs: number = DEFAULT_CALIBRATION.holdMs,
    private readonly dropoutToleranceMs: number = DEFAULT_CALIBRATION.dropoutToleranceMs,
  ) {}

  /**
   * Accumulates ready time. A wrist or ankle flickering below the visibility
   * threshold for a frame or two pauses progress; only a longer drop restarts
   * it. (Restarting on every blip made calibration time out at low tracking rates.)
   */
  update(allReady: boolean, nowMs: number): { complete: boolean; progress: number } {
    const dt = this.lastMs === null ? 0 : Math.max(0, nowMs - this.lastMs);
    this.lastMs = nowMs;
    if (allReady) {
      if (this.lastReadyMs !== null) this.readyMs += dt;
      this.lastReadyMs = nowMs;
    } else if (this.lastReadyMs === null || nowMs - this.lastReadyMs > this.dropoutToleranceMs) {
      this.readyMs = 0;
      this.lastReadyMs = null;
    }
    const progress = Math.min(1, this.readyMs / this.holdMs);
    return { complete: progress >= 1, progress };
  }

  reset(): void {
    this.readyMs = 0;
    this.lastMs = null;
    this.lastReadyMs = null;
  }
}

/**
 * Applies the tracking-loss rules during play: a player missing longer than
 * the grace period is prompted; if every player is missing longer than the
 * pause threshold, the session should pause. Missing players are never scored.
 */
export class TrackingLossMonitor {
  constructor(
    private graceMs: number,
    private pauseMs: number,
  ) {}

  configure(graceMs: number, pauseMs: number): void {
    this.graceMs = graceMs;
    this.pauseMs = pauseMs;
  }

  evaluate(players: readonly PlayerSlotState[], allMissingForMs: number): { prompt: (1 | 2)[]; shouldPause: boolean } {
    const prompt = players
      .filter((p) => p.status !== 'tracked' && (p.status === 'empty' || p.lostForMs >= this.graceMs))
      .map((p) => p.slot);
    return { prompt, shouldPause: players.length > 0 && allMissingForMs >= this.pauseMs };
  }
}
