/**
 * Fixed-capacity sample window with percentiles. Allocation-free after
 * construction so it can be updated every render frame.
 */
export class RollingStats {
  private readonly buf: Float64Array;
  private readonly scratch: Float64Array;
  private count = 0;
  private head = 0;

  constructor(capacity = 240) {
    this.buf = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  push(v: number): void {
    if (!Number.isFinite(v)) return;
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  mean(): number | null {
    if (this.count === 0) return null;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.buf[i]!;
    return s / this.count;
  }

  /** Nearest-rank percentile, p in [0, 100]. */
  percentile(p: number): number | null {
    if (this.count === 0) return null;
    const view = this.scratch.subarray(0, this.count);
    view.set(this.buf.subarray(0, this.count));
    view.sort();
    const rank = Math.min(this.count - 1, Math.max(0, Math.ceil((p / 100) * this.count) - 1));
    return view[rank]!;
  }
}

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  modifiedMs: number;
}

/**
 * Decides which rotated log files to delete: anything older than the
 * retention period, then the oldest files until the total is under budget.
 * The active file is never deleted.
 */
export function planLogRetention(
  files: readonly LogFileInfo[],
  opts: { nowMs: number; maxAgeDays: number; maxTotalBytes: number; activeFile: string },
): string[] {
  const maxAgeMs = opts.maxAgeDays * 86_400_000;
  const sorted = [...files].sort((a, b) => a.modifiedMs - b.modifiedMs);
  const remove = new Set<string>();
  for (const f of sorted) {
    if (f.name !== opts.activeFile && opts.nowMs - f.modifiedMs > maxAgeMs) remove.add(f.name);
  }
  let total = sorted.filter((f) => !remove.has(f.name)).reduce((s, f) => s + f.sizeBytes, 0);
  for (const f of sorted) {
    if (total <= opts.maxTotalBytes) break;
    if (f.name === opts.activeFile || remove.has(f.name)) continue;
    remove.add(f.name);
    total -= f.sizeBytes;
  }
  return [...remove];
}
