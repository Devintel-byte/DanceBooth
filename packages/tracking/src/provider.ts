import type { TrackingFrame, TrackingProviderStatus, TrackingSourceKind, TrackingStats } from '@booth/contracts';

/**
 * A source of canonical tracking frames.
 *
 * Implementations: the MediaPipe webcam provider (participant renderer +
 * worker), deterministic replay, and future device adapters. Providers emit
 * frames with `players` empty; player assignment happens downstream so it is
 * identical for every source.
 */
export interface TrackingProvider {
  readonly kind: TrackingSourceKind;
  start(): Promise<void>;
  /** Idempotent. After stop, no further frames are emitted. */
  stop(): Promise<void>;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
  onStatus(listener: (status: TrackingProviderStatus) => void): () => void;
  stats(nowMs: number): TrackingStats;
}

/** Tiny typed listener set with safe unsubscription. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const l of [...this.listeners]) l(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
