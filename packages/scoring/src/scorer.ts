import type { JointGroup, RoutineMove, SegmentName } from '@booth/contracts';
import type { ExtractedPose } from './features';
import {
  feedbackFor,
  matchPose,
  pointsFor,
  moveWeights,
  restMatch,
  timingQuality,
  type FeedbackCategory,
  type ScoringConfig,
  type SegmentBreakdown,
} from './judge';

export interface ScorableRoutine {
  moves: readonly Pick<RoutineMove, 'timeSec' | 'judged' | 'pose'>[];
  requiredGroups: readonly JointGroup[];
}

export interface MoveResult {
  moveIndex: number;
  moveTimeSec: number;
  valid: boolean;
  /** How much better than standing still the held pose matched (0..1). */
  poseQuality: number;
  timingQuality: number;
  /** Sample time minus move time for the chosen moment; null when nothing was judged. */
  timingOffsetSec: number | null;
  combined: number;
  points: number;
  feedback: FeedbackCategory;
  evidence: number;
  breakdown: SegmentBreakdown[];
}

export interface ScoreSummary {
  points: number;
  /** Moves judged with sufficient evidence. */
  judgedMoves: number;
  /** Moves skipped because of insufficient tracking evidence (not counted as failures). */
  insufficientEvidence: number;
  /** Average move accuracy (0..100) over judged moves, or 0 when nothing was judged. Internal only (tiers). */
  percent: number;
  feedbackCounts: Record<FeedbackCategory, number>;
  bestStreak: number;
}

type Convention = 'primary' | 'alt';

interface Sample {
  frameId: number;
  songTimeSec: number;
  pose: ExtractedPose;
  /** The same body read in the other mirroring convention, when available. */
  alt: ExtractedPose | null;
}

interface PreparedMove {
  index: number;
  move: ScorableRoutine['moves'][number];
  weights: Partial<Record<SegmentName, number>>;
  rest: number;
}

const MAX_SAMPLES = 512;
/** Typical reaction delay when copying a dancer on screen; refined per player. */
const INITIAL_LAG_SEC = 0.3;
const LAG_HISTORY = 8;
/** A steady delay beyond this is not excused (it is simply late). */
const MAX_LAG_SEC = 0.5;
/** Lead (in moves' worth of quality) the other convention needs before it is used. */
const CONVENTION_MARGIN = 1.5;

/**
 * Deterministic per-player scorer.
 *
 * Feed it samples tagged with the song time of the *captured* frame (not the
 * time inference completed) and call `advance()` with the current song time.
 * A move is judged once its timing window has closed. Re-delivered frames are
 * ignored by frame id, so a frame rendered several times is only counted once.
 *
 * Fairness rules (docs/decisions/0007-fair-scoring.md):
 * - A move scores by how much better the player matches it than someone
 *   standing still would; moves that look like standing still are not judged.
 * - Segments that move away from rest count most.
 * - The pose must be held for a moment (average over `sustainSec`), so
 *   passing through it while waving about does not score.
 * - Timing is judged against the player's own steady reaction delay.
 * - Copying mirror-wise or same-side is accepted, per player, whichever they
 *   consistently do.
 */
export class PlayerScorer {
  private readonly judgeable: PreparedMove[];
  private nextMove = 0;
  private samples: Sample[] = [];
  private lastFrameId = -Infinity;
  private readonly results: MoveResult[] = [];
  private streak = 0;
  private bestStreak = 0;
  private lags: number[] = [];
  private conventionScore: Record<Convention, number> = { primary: 0, alt: 0 };

  constructor(
    private readonly routine: ScorableRoutine,
    private readonly config: ScoringConfig,
  ) {
    this.judgeable = routine.moves
      .map((move, index) => ({ index, move }))
      .filter(({ move }) => move.judged !== false)
      .map(({ index, move }) => {
        const weights = moveWeights(move.pose, routine.requiredGroups, config);
        return { index, move, weights, rest: restMatch(move.pose, routine.requiredGroups, config, weights) };
      })
      .filter((m) => m.rest < config.maxRestMatch);
  }

  /** Number of moves that will be judged (moves resembling standing still are excluded). */
  get judgeableMoves(): number {
    return this.judgeable.length;
  }

  /**
   * Returns false when the sample was rejected as a duplicate or out-of-order
   * frame. `alt` is the same frame extracted in the other mirroring convention.
   */
  addSample(frameId: number, songTimeSec: number, pose: ExtractedPose | null, alt: ExtractedPose | null = null): boolean {
    if (frameId <= this.lastFrameId) return false;
    this.lastFrameId = frameId;
    if (!pose || !Number.isFinite(songTimeSec)) return true;
    this.samples.push({ frameId, songTimeSec, pose, alt });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    return true;
  }

  /** Judges every move whose timing window has closed. Returns newly judged moves. */
  advance(songTimeSec: number): MoveResult[] {
    const out: MoveResult[] = [];
    while (this.nextMove < this.judgeable.length) {
      const entry = this.judgeable[this.nextMove]!;
      if (songTimeSec < entry.move.timeSec + this.config.lateToleranceSec + this.config.sustainSec) break;
      out.push(this.judge(entry));
      this.nextMove++;
    }
    this.pruneSamples();
    return out;
  }

  /** Judges all remaining moves (end of song). */
  finish(): MoveResult[] {
    return this.advance(Number.POSITIVE_INFINITY);
  }

  get moveResults(): readonly MoveResult[] {
    return this.results;
  }

  summary(): ScoreSummary {
    const feedbackCounts: Record<FeedbackCategory, number> = {
      perfect: 0,
      great: 0,
      good: 0,
      miss: 0,
      'no-read': 0,
    };
    let points = 0;
    let judged = 0;
    for (const r of this.results) {
      feedbackCounts[r.feedback]++;
      if (r.valid) {
        judged++;
        points += r.points;
      }
    }
    const max = judged * this.config.pointsPerMove;
    return {
      points,
      judgedMoves: judged,
      insufficientEvidence: feedbackCounts['no-read'],
      percent: max > 0 ? (points / max) * 100 : 0,
      feedbackCounts,
      bestStreak: this.bestStreak,
    };
  }

  /** The player's steady reaction delay (median of recent well-matched moves). */
  private lag(): number {
    if (this.lags.length < 2) return INITIAL_LAG_SEC;
    const s = [...this.lags].sort((a, b) => a - b);
    return Math.min(MAX_LAG_SEC, Math.max(0, s[Math.floor(s.length / 2)]!));
  }

  /** Best held-pose match for one move in one convention. */
  private bestFor(entry: PreparedMove, convention: Convention): MoveResult | null {
    const c = this.config;
    const { move, weights, rest } = entry;
    const groups = this.routine.requiredGroups;
    // Per-sample adjusted quality inside the window (plus the sustain margin).
    const scored: { t: number; offset: number; q: number; evidence: number; valid: boolean; breakdown: SegmentBreakdown[] }[] = [];
    for (const s of this.samples) {
      const offset = s.songTimeSec - move.timeSec;
      if (offset < -c.timingToleranceSec - c.sustainSec || offset > c.lateToleranceSec + c.sustainSec) continue;
      const pose = convention === 'primary' ? s.pose : s.alt;
      if (!pose) continue;
      const m = matchPose(pose, move.pose, groups, c, weights);
      const q = m.valid ? Math.max(0, (m.quality - rest) / (1 - rest)) : 0;
      scored.push({ t: s.songTimeSec, offset, q, evidence: m.evidence, valid: m.valid, breakdown: m.breakdown });
    }
    const lag = this.lag();
    let best: MoveResult | null = null;
    for (const centre of scored) {
      if (!centre.valid || centre.offset < -c.timingToleranceSec || centre.offset > c.lateToleranceSec) continue;
      // Held pose: mean over every sample within sustainSec (unreadable ones count as 0).
      let sum = 0;
      let n = 0;
      for (const o of scored) {
        if (Math.abs(o.t - centre.t) > c.sustainSec) continue;
        sum += o.valid ? o.q : 0;
        n++;
      }
      const held = n > 0 ? sum / n : 0;
      // On the beat, or anywhere up to the player's usual delay, is on time; only
      // anticipating the move or falling further behind than usual costs points.
      const err = centre.offset < 0 ? centre.offset : Math.max(0, centre.offset - lag);
      const t = timingQuality(err, c);
      const combined = held * (1 - c.timingWeight * (1 - t));
      if (!best || combined > best.combined) {
        best = {
          moveIndex: entry.index,
          moveTimeSec: move.timeSec,
          valid: true,
          poseQuality: held,
          timingQuality: t,
          timingOffsetSec: centre.offset,
          combined,
          points: 0, // set by judge()
          feedback: feedbackFor(combined, true, c),
          evidence: centre.evidence,
          breakdown: centre.breakdown,
        };
      }
    }
    return best;
  }

  private judge(entry: PreparedMove): MoveResult {
    const primary = this.bestFor(entry, 'primary');
    const alt = this.bestFor(entry, 'alt');
    // Keep score of which convention this player follows; use the leader.
    this.conventionScore.primary += primary?.combined ?? 0;
    this.conventionScore.alt += alt?.combined ?? 0;
    const useAlt = this.conventionScore.alt > this.conventionScore.primary + CONVENTION_MARGIN;
    const best = (useAlt ? alt : primary) ?? null;
    if (best) {
      best.feedback = feedbackFor(best.combined, true, this.config);
      best.points = pointsFor(best.feedback, this.config);
    }
    if (best && best.poseQuality >= 0.5 && best.timingOffsetSec !== null) {
      this.lags.push(best.timingOffsetSec);
      if (this.lags.length > LAG_HISTORY) this.lags.shift();
    }
    const result: MoveResult = best ?? {
      moveIndex: entry.index,
      moveTimeSec: entry.move.timeSec,
      valid: false,
      poseQuality: 0,
      timingQuality: 0,
      timingOffsetSec: null,
      combined: 0,
      points: 0,
      feedback: 'no-read',
      evidence: 0,
      breakdown: [],
    };
    this.results.push(result);
    if (result.valid) {
      if (result.feedback === 'perfect' || result.feedback === 'great' || result.feedback === 'good') {
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
      } else {
        this.streak = 0;
      }
    }
    // An unreadable move neither extends nor breaks the streak.
    return result;
  }

  private pruneSamples(): void {
    const next = this.judgeable[this.nextMove];
    if (!next) {
      this.samples = [];
      return;
    }
    const earliest = next.move.timeSec - this.config.timingToleranceSec - this.config.sustainSec;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop]!.songTimeSec < earliest) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }
}
