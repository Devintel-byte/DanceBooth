/**
 * Bounded automatic restarts: at most `maxRestarts` within `windowMs`.
 * Beyond that the caller must escalate to maintenance instead of looping.
 */
export class RestartPolicy {
  private history: number[] = [];

  constructor(
    private readonly maxRestarts: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt at `nowMs` and returns whether it is allowed. */
  tryRestart(nowMs: number): boolean {
    this.history = this.history.filter((t) => nowMs - t < this.windowMs);
    if (this.history.length >= this.maxRestarts) return false;
    this.history.push(nowMs);
    return true;
  }

  reset(): void {
    this.history = [];
  }
}
