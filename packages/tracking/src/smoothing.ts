import type { Landmark } from '@booth/contracts';

/**
 * One Euro filter (Casiez et al., CHI 2012): strong smoothing when a point is
 * nearly still (removes detector jitter on hands, feet and head), little lag
 * when it moves fast (dance moves stay sharp). Frame-rate independent, so it
 * behaves the same at 7 Hz and 30 Hz tracking.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private lastMs = 0;

  constructor(
    private minCutoffHz: number,
    private beta: number,
    private dCutoffHz = 1,
  ) {}

  private static alpha(cutoffHz: number, dtSec: number): number {
    const tau = 1 / (2 * Math.PI * cutoffHz);
    return 1 / (1 + tau / dtSec);
  }

  filter(value: number, timeMs: number): number {
    if (this.x === null || !Number.isFinite(this.x)) {
      this.x = value;
      this.dx = 0;
      this.lastMs = timeMs;
      return value;
    }
    const dt = Math.max(1e-3, (timeMs - this.lastMs) / 1000);
    this.lastMs = timeMs;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoffHz, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoffHz + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

export interface SmoothingConfig {
  /** One Euro minimum cutoff (Hz) for image-normalised coordinates. */
  minCutoffHz: number;
  /** One Euro speed coefficient (per normalised unit per second). */
  beta: number;
  /** Visibility rises this fast toward a higher reading (0..1 per frame). */
  visibilityAttack: number;
  /** Visibility falls this fast toward a lower reading, so one bad frame does not hide a joint. */
  visibilityRelease: number;
  /** A gap longer than this restarts the filters (new person or long occlusion). */
  resetAfterMs: number;
}

export const DEFAULT_SMOOTHING: SmoothingConfig = {
  minCutoffHz: 1.2,
  beta: 3,
  visibilityAttack: 0.7,
  visibilityRelease: 0.3,
  resetAfterMs: 1000,
};

/** Smooths one tracked body's 33 landmarks over time. One instance per player slot. */
export class LandmarkSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];
  private fz: OneEuro[] = [];
  private vis: number[] = [];
  private lastMs: number | null = null;

  constructor(private config: SmoothingConfig = DEFAULT_SMOOTHING) {}

  private ensure(n: number): void {
    const { minCutoffHz: c, beta: b } = this.config;
    while (this.fx.length < n) {
      this.fx.push(new OneEuro(c, b));
      this.fy.push(new OneEuro(c, b));
      this.fz.push(new OneEuro(c, b));
      this.vis.push(-1);
    }
  }

  filter(landmarks: readonly Landmark[], timeMs: number): Landmark[] {
    if (this.lastMs !== null && (timeMs - this.lastMs > this.config.resetAfterMs || timeMs < this.lastMs)) this.reset();
    this.lastMs = timeMs;
    this.ensure(landmarks.length);
    return landmarks.map((l, i) => {
      if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) return { ...l };
      const raw = l.visibility ?? 1;
      const prev = this.vis[i]!;
      const v = prev < 0 ? raw : prev + (raw > prev ? this.config.visibilityAttack : this.config.visibilityRelease) * (raw - prev);
      this.vis[i] = v;
      return {
        ...l,
        x: this.fx[i]!.filter(l.x, timeMs),
        y: this.fy[i]!.filter(l.y, timeMs),
        z: Number.isFinite(l.z) ? this.fz[i]!.filter(l.z, timeMs) : l.z,
        visibility: v,
      };
    });
  }

  reset(): void {
    for (const f of [...this.fx, ...this.fy, ...this.fz]) f.reset();
    this.vis = this.vis.map(() => -1);
    this.lastMs = null;
  }
}
