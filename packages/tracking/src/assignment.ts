import { LANDMARK, type DetectedBody, type PlayerSlotId, type PlayerSlotState } from '@booth/contracts';
import { appearanceDistance, blendAppearance } from './appearance';

export interface AssignmentConfig {
  /** Number of player slots (1 or 2). */
  slots: 1 | 2;
  /** Whether the participant display is mirrored; slot zones are defined in display space. */
  mirrorDisplay: boolean;
  /** Bodies with core-joint confidence below this cannot claim or keep a slot. */
  minConfidence: number;
  /** Maximum plausible hip-centre movement per second (normalised width units). */
  maxSpeedPerSec: number;
  /** Extra distance allowed regardless of elapsed time (detector jitter). */
  jitterAllowance: number;
  /** A lost slot becomes empty after this long and must be re-calibrated by zone. */
  forgetAfterMs: number;
  /**
   * Solo only: after this long without a match, a lost slot is reacquired by
   * whichever body is visible, wherever it is. There is only one dancer, and
   * at low tracking rates a fast step can exceed the speed gate.
   */
  soloReacquireAfterMs: number;
  /**
   * Duo: extra cost for an assignment that puts Player 1 to the right of
   * Player 2. Players keep to their own side at a booth, so when two bodies
   * are close this keeps identities from swapping back and forth.
   */
  crossingPenalty: number;
  /**
   * Duo, after the players are locked in at calibration: cost per unit of
   * appearance distance (clothing colours, 0..1). Strong enough to override
   * the crossing penalty when the outfits clearly differ, so identities
   * survive collisions and real side swaps.
   */
  appearanceWeight: number;
  /** A locked player whose outfit matches this well is re-identified anywhere in the frame (after occlusion or a collision). */
  reidentifyBelow: number;
}

export const DEFAULT_ASSIGNMENT: AssignmentConfig = {
  slots: 1,
  mirrorDisplay: true,
  minConfidence: 0.35,
  maxSpeedPerSec: 3,
  jitterAllowance: 0.15,
  forgetAfterMs: 4000,
  soloReacquireAfterMs: 300,
  crossingPenalty: 0.25,
  appearanceWeight: 1,
  reidentifyBelow: 0.3,
};

interface SlotMemory {
  status: PlayerSlotState['status'];
  x: number | null;
  lastSeenMs: number;
  confidence: number;
  /** Clothing signature locked at calibration (duo); null until locked. */
  appearance: number[] | null;
}

interface Candidate {
  bodyIndex: number;
  x: number;
  confidence: number;
  appearance: number[] | null;
}

const SHOULDERS = [LANDMARK.leftShoulder, LANDMARK.rightShoulder] as const;
const HIPS = [LANDMARK.leftHip, LANDMARK.rightHip] as const;

function pairVisibility(body: DetectedBody, pair: readonly [number, number]): number {
  return ((body.imageLandmarks[pair[0]]?.visibility ?? 1) + (body.imageLandmarks[pair[1]]?.visibility ?? 1)) / 2;
}

/**
 * How sure we are this is a person: the better of the shoulder pair and the
 * hip pair. Averaging all four (the old rule) dropped dancers whose hips were
 * cropped, hidden by clothing or blurred by movement while the upper body was
 * perfectly clear.
 */
export function coreConfidence(body: DetectedBody): number {
  return Math.max(pairVisibility(body, SHOULDERS), pairVisibility(body, HIPS));
}

/**
 * Body-centre x in display space (mirrored when the display is mirrored):
 * the hip centre when the hips are seen well, otherwise the shoulder centre.
 */
export function displayX(body: DetectedBody, mirrorDisplay: boolean): number | null {
  const pair = pairVisibility(body, HIPS) >= 0.5 || pairVisibility(body, HIPS) >= pairVisibility(body, SHOULDERS) ? HIPS : SHOULDERS;
  const l = body.imageLandmarks[pair[0]];
  const r = body.imageLandmarks[pair[1]];
  if (!l || !r) return null;
  const x = (l.x + r.x) / 2;
  if (!Number.isFinite(x)) return null;
  return mirrorDisplay ? 1 - x : x;
}

interface Torso {
  cx: number;
  cy: number;
  width: number;
}

/** Torso centre and shoulder width (image-normalised), from whichever of shoulders/hips are present. */
export function torsoOf(body: DetectedBody): Torso | null {
  const pts = [...SHOULDERS, ...HIPS].map((i) => body.imageLandmarks[i]).filter((l): l is NonNullable<typeof l> => !!l && Number.isFinite(l.x) && Number.isFinite(l.y));
  if (pts.length < 2) return null;
  const ls = body.imageLandmarks[LANDMARK.leftShoulder];
  const rs = body.imageLandmarks[LANDMARK.rightShoulder];
  const width = ls && rs ? Math.abs(ls.x - rs.x) : 0.1;
  return { cx: pts.reduce((a, l) => a + l.x, 0) / pts.length, cy: pts.reduce((a, l) => a + l.y, 0) / pts.length, width: Math.max(0.03, width) };
}

/**
 * Indices of bodies that are the same person detected twice (e.g. by both
 * halves in duo split mode, or a ghost skeleton from the detector): torso
 * centres closer than about half a shoulder width. The less confident copy is dropped.
 */
export function duplicateBodies(bodies: readonly DetectedBody[]): Set<number> {
  const drop = new Set<number>();
  const torsos = bodies.map(torsoOf);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = torsos[i];
      const b = torsos[j];
      if (!a || !b || drop.has(i) || drop.has(j)) continue;
      const w = Math.max(a.width, b.width);
      if (Math.abs(a.cx - b.cx) < 0.45 * w && Math.abs(a.cy - b.cy) < 0.6 * w) {
        drop.add(coreConfidence(bodies[i]!) >= coreConfidence(bodies[j]!) ? j : i);
      }
    }
  }
  return drop;
}

/**
 * Maintains stable Player 1 / Player 2 slots across frames.
 *
 * Detector result order is not identity. Slots are first claimed by starting
 * zone (Player 1 on the left half of the display, Player 2 on the right),
 * then kept by nearest plausible position. Low-confidence detections never
 * steal or move a slot, so identities do not swap when tracking is poor. A
 * briefly occluded player stays `lost` (keeping its position) until
 * `forgetAfterMs`, and is reacquired by proximity.
 */
export class PlayerAssigner {
  private memory = new Map<PlayerSlotId, SlotMemory>();

  constructor(private config: AssignmentConfig = DEFAULT_ASSIGNMENT) {
    this.reset();
  }

  configure(config: Partial<AssignmentConfig>): void {
    this.config = { ...this.config, ...config };
    this.reset();
  }

  reset(): void {
    this.memory.clear();
    for (const slot of this.slotIds()) {
      this.memory.set(slot, { status: 'empty', x: null, lastSeenMs: 0, confidence: 0, appearance: null });
    }
  }

  /**
   * Locks a player's identity to their clothing signature (call when
   * calibration completes, with a signature averaged over the hold).
   */
  lockAppearance(slot: PlayerSlotId, signature: readonly number[]): void {
    const mem = this.memory.get(slot);
    if (mem) mem.appearance = [...signature];
  }

  isLocked(slot: PlayerSlotId): boolean {
    return !!this.memory.get(slot)?.appearance;
  }

  /** Signature distance between a locked slot and a body (null if either is unknown). */
  private appearanceCost(slot: PlayerSlotId, cand: Candidate): number | null {
    const sig = this.memory.get(slot)?.appearance;
    return sig && cand.appearance ? appearanceDistance(sig, cand.appearance) : null;
  }

  private slotIds(): PlayerSlotId[] {
    return this.config.slots === 2 ? [1, 2] : [1];
  }

  /** Zone centre for an empty slot, in display space. */
  private zoneCentre(slot: PlayerSlotId): number {
    if (this.config.slots === 1) return 0.5;
    return slot === 1 ? 0.25 : 0.75;
  }

  private inZone(slot: PlayerSlotId, x: number): boolean {
    if (this.config.slots === 1) return true;
    return slot === 1 ? x < 0.5 : x >= 0.5;
  }

  assign(bodies: readonly DetectedBody[], timestampMs: number): PlayerSlotState[] {
    const c = this.config;
    const candidates: Candidate[] = [];
    const duplicates = duplicateBodies(bodies);
    bodies.forEach((b, bodyIndex) => {
      if (duplicates.has(bodyIndex)) return;
      const x = displayX(b, c.mirrorDisplay);
      const confidence = coreConfidence(b);
      if (x !== null && confidence >= c.minConfidence) candidates.push({ bodyIndex, x, confidence, appearance: b.appearance ?? null });
    });

    const slots = this.slotIds();
    // Evaluate every one-to-one assignment (at most 2 slots x few bodies) and pick the cheapest.
    let best: { cost: number; pairs: Map<PlayerSlotId, Candidate> } = { cost: Infinity, pairs: new Map() };
    const recurse = (i: number, used: Set<number>, pairs: Map<PlayerSlotId, Candidate>, cost: number) => {
      if (i === slots.length) {
        // Prefer assignments that track more players, then lower cost; discourage P1/P2 crossing sides.
        const p1 = pairs.get(1);
        const p2 = pairs.get(2);
        const crossed = p1 && p2 && p1.x > p2.x ? c.crossingPenalty : 0;
        const score = cost + crossed - pairs.size * 10;
        if (score < best.cost) best = { cost: score, pairs: new Map(pairs) };
        return;
      }
      const slot = slots[i]!;
      recurse(i + 1, used, pairs, cost); // leave slot unassigned
      for (const cand of candidates) {
        if (used.has(cand.bodyIndex)) continue;
        const d = this.distanceIfPlausible(slot, cand, timestampMs);
        if (d === null) continue;
        const look = this.appearanceCost(slot, cand);
        used.add(cand.bodyIndex);
        pairs.set(slot, cand);
        recurse(i + 1, used, pairs, cost + d + (look === null ? 0 : look * c.appearanceWeight));
        pairs.delete(slot);
        used.delete(cand.bodyIndex);
      }
    };
    recurse(0, new Set(), new Map(), 0);

    return slots.map((slot) => {
      const mem = this.memory.get(slot)!;
      const cand = best.pairs.get(slot);
      if (cand) {
        mem.status = 'tracked';
        mem.x = cand.x;
        mem.lastSeenMs = timestampMs;
        mem.confidence = cand.confidence;
        // Follow slow lighting changes, only when this is clearly the same outfit.
        if (mem.appearance && cand.appearance && appearanceDistance(mem.appearance, cand.appearance) < c.reidentifyBelow * 0.7) {
          mem.appearance = blendAppearance(mem.appearance, cand.appearance, 0.02);
        }
        return { slot, status: 'tracked', bodyIndex: cand.bodyIndex, confidence: cand.confidence, lostForMs: 0, lastX: cand.x };
      }
      if (mem.status === 'tracked' || mem.status === 'lost') {
        const lostFor = timestampMs - mem.lastSeenMs;
        if (lostFor > c.forgetAfterMs) {
          mem.status = 'empty';
          mem.x = null;
          mem.confidence = 0;
        } else {
          mem.status = 'lost';
          return { slot, status: 'lost', bodyIndex: null, confidence: 0, lostForMs: lostFor, lastX: mem.x };
        }
      }
      return { slot, status: 'empty', bodyIndex: null, confidence: 0, lostForMs: 0, lastX: null };
    });
  }

  private distanceIfPlausible(slot: PlayerSlotId, cand: Candidate, now: number): number | null {
    const mem = this.memory.get(slot)!;
    if (mem.status === 'empty' || mem.x === null) {
      // A locked player coming back is recognised by outfit anywhere; otherwise claim only from the slot's starting zone.
      const back = this.appearanceCost(slot, cand);
      if (back !== null && back < this.config.reidentifyBelow) return Math.abs(cand.x - this.zoneCentre(slot));
      return this.inZone(slot, cand.x) ? Math.abs(cand.x - this.zoneCentre(slot)) : null;
    }
    if (this.config.slots === 1 && now - mem.lastSeenMs >= this.config.soloReacquireAfterMs) return Math.abs(cand.x - mem.x);
    // A locked duo player whose outfit clearly matches is re-identified wherever they are.
    const look = this.appearanceCost(slot, cand);
    if (look !== null && look < this.config.reidentifyBelow) return Math.min(1, Math.abs(cand.x - mem.x));
    const dt = Math.max(0, now - mem.lastSeenMs) / 1000;
    const allowed = this.config.jitterAllowance + this.config.maxSpeedPerSec * dt;
    const d = Math.abs(cand.x - mem.x);
    return d <= allowed ? d : null;
  }
}
