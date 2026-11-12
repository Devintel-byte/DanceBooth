import {
  emptyTrackingStats,
  type DetectedBody,
  type ReplayFixture,
  type TrackingFrame,
  type TrackingProviderStatus,
  type TrackingStats,
} from '@booth/contracts';
import { Emitter, type TrackingProvider } from './provider';

export function fixtureBodies(frame: ReplayFixture['frames'][number]): DetectedBody[] {
  return frame.bodies.map((lms, detectionIndex) => ({
    detectionIndex,
    imageLandmarks: lms.map(([x, y, z, v]) => ({ x, y, z, visibility: v, presence: v })),
  }));
}

/**
 * Deterministic replay of a landmark fixture.
 *
 * The caller drives it with `advanceTo(mediaTimeSec, nowMs)`, normally with the
 * current song time, so replay stays aligned with the music. Every fixture
 * frame up to that time is emitted exactly once and in order, which makes
 * scoring reproducible regardless of render frame rate.
 */
export class ReplayTrackingProvider implements TrackingProvider {
  readonly kind = 'replay' as const;
  private readonly frames = new Emitter<TrackingFrame>();
  private readonly statuses = new Emitter<TrackingProviderStatus>();
  private cursor = 0;
  private running = false;
  private generation = 0;
  private stat: TrackingStats = emptyTrackingStats();
  private emittedAt: number[] = [];

  constructor(private readonly fixture: ReplayFixture) {}

  async start(): Promise<void> {
    this.generation++;
    this.cursor = 0;
    this.running = true;
    this.stat = emptyTrackingStats();
    this.statuses.emit({ kind: 'running', detail: `REPLAY ${this.fixture.id} (${this.fixture.provenance.kind})` });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.statuses.emit({ kind: 'stopped' });
  }

  /** Rewinds to the start (e.g. at the beginning of each song). */
  rewind(): void {
    this.cursor = 0;
  }

  get finished(): boolean {
    return this.cursor >= this.fixture.frames.length;
  }

  advanceTo(mediaTimeSec: number, nowMs: number): number {
    if (!this.running) return 0;
    let emitted = 0;
    const frames = this.fixture.frames;
    while (this.cursor < frames.length && frames[this.cursor]!.t <= mediaTimeSec) {
      const f = frames[this.cursor]!;
      const frame: TrackingFrame = {
        generation: this.generation,
        frameId: this.cursor,
        source: 'replay',
        captureTimestampMs: nowMs,
        resultTimestampMs: nowMs,
        inferenceMs: null,
        mediaTimeSec: f.t,
        sourceWidth: this.fixture.sourceWidth,
        sourceHeight: this.fixture.sourceHeight,
        coordinateSpace: 'image-normalized',
        bodies: fixtureBodies(f),
        players: [],
      };
      this.cursor++;
      emitted++;
      this.stat.framesSubmitted++;
      this.stat.framesCompleted++;
      this.emittedAt.push(nowMs);
      this.frames.emit(frame);
    }
    while (this.emittedAt.length > 0 && nowMs - this.emittedAt[0]! > 1000) this.emittedAt.shift();
    this.stat.updateRateHz = this.emittedAt.length;
    return emitted;
  }

  onFrame(listener: (frame: TrackingFrame) => void): () => void {
    return this.frames.on(listener);
  }

  onStatus(listener: (status: TrackingProviderStatus) => void): () => void {
    return this.statuses.on(listener);
  }

  stats(): TrackingStats {
    return { ...this.stat, latestResultAgeMs: 0 };
  }
}
