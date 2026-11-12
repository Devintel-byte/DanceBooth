import { emptyTrackingStats, type TrackingStats } from '@booth/contracts';

export interface FrameGateConfig {
  /** Maximum frames submitted to inference but not yet completed. */
  maxInFlight: number;
  /** Minimum spacing between submissions, derived from the target tracking rate. */
  minIntervalMs: number;
  /** Results older than this (capture -> result) are discarded as stale. */
  maxResultAgeMs: number;
  /** In-flight work older than this is presumed lost (e.g. worker hang) and its slot reclaimed. */
  inFlightTimeoutMs: number;
}

export interface FrameTicket {
  frameId: number;
  generation: number;
  captureTimestampMs: number;
}

/**
 * Bounded in-flight limiter and statistics for an inference pipeline.
 *
 * Frames are submitted only when fewer than `maxInFlight` are outstanding;
 * otherwise the frame is dropped (counted as busy) instead of queued, so
 * latency cannot grow. Results from an older generation (after a restart)
 * or older than `maxResultAgeMs` are discarded as stale.
 */
export class FrameGate {
  private generation = 0;
  private nextFrameId = 0;
  private lastSubmitMs = -Infinity;
  private inFlight = new Map<number, FrameTicket>();
  private stats: TrackingStats = emptyTrackingStats();
  private completions: number[] = [];

  constructor(private config: FrameGateConfig) {}

  configure(config: Partial<FrameGateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Starts a new generation: all outstanding work becomes stale. */
  restart(): number {
    this.generation++;
    this.inFlight.clear();
    this.lastSubmitMs = -Infinity;
    this.stats.inFlight = 0;
    return this.generation;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  /** Returns a ticket if the frame may be submitted now; otherwise counts a drop. */
  tryAcquire(nowMs: number): FrameTicket | null {
    this.reclaimHung(nowMs);
    if (nowMs - this.lastSubmitMs < this.config.minIntervalMs) return null; // pacing, not a drop
    if (this.inFlight.size >= this.config.maxInFlight) {
      this.stats.framesDroppedBusy++;
      return null;
    }
    const ticket: FrameTicket = { frameId: this.nextFrameId++, generation: this.generation, captureTimestampMs: nowMs };
    this.inFlight.set(ticket.frameId, ticket);
    this.lastSubmitMs = nowMs;
    this.stats.framesSubmitted++;
    this.stats.inFlight = this.inFlight.size;
    return ticket;
  }

  /** Releases a ticket whose submission failed before reaching inference. */
  abandon(frameId: number): void {
    this.inFlight.delete(frameId);
    this.stats.inFlight = this.inFlight.size;
  }

  /**
   * Records a completed result. Returns the frame's ticket (with its capture
   * time) when the result is fresh and should be delivered, or null when it
   * must be discarded.
   */
  complete(generation: number, frameId: number, resultTimestampMs: number, inferenceMs: number | null): FrameTicket | null {
    const ticket = this.inFlight.get(frameId);
    if (generation !== this.generation || !ticket) {
      this.stats.framesDroppedStale++;
      return null;
    }
    this.inFlight.delete(frameId);
    this.stats.inFlight = this.inFlight.size;
    this.stats.lastInferenceMs = inferenceMs;
    const age = resultTimestampMs - ticket.captureTimestampMs;
    if (age > this.config.maxResultAgeMs) {
      this.stats.framesDroppedStale++;
      return null;
    }
    this.stats.framesCompleted++;
    this.stats.latestResultAgeMs = age;
    this.completions.push(resultTimestampMs);
    while (this.completions.length > 0 && resultTimestampMs - this.completions[0]! > 1000) this.completions.shift();
    this.stats.updateRateHz = this.completions.length;
    return ticket;
  }

  snapshot(nowMs?: number): TrackingStats {
    if (nowMs !== undefined) {
      while (this.completions.length > 0 && nowMs - this.completions[0]! > 1000) this.completions.shift();
      this.stats.updateRateHz = this.completions.length;
    }
    return { ...this.stats };
  }

  resetStats(): void {
    const delegate = this.stats.delegate;
    this.stats = { ...emptyTrackingStats(), delegate, inFlight: this.inFlight.size };
    this.completions = [];
  }

  setDelegate(delegate: TrackingStats['delegate']): void {
    this.stats.delegate = delegate;
  }

  private reclaimHung(nowMs: number): void {
    for (const [id, t] of this.inFlight) {
      if (nowMs - t.captureTimestampMs > this.config.inFlightTimeoutMs) {
        this.inFlight.delete(id);
        this.stats.framesDroppedStale++;
      }
    }
    this.stats.inFlight = this.inFlight.size;
  }
}
