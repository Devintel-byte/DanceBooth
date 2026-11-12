import { describe, expect, it } from 'vitest';
import { RollingStats, planLogRetention } from './index';

describe('RollingStats', () => {
  it('computes percentiles over a bounded window', () => {
    const s = new RollingStats(100);
    for (let i = 1; i <= 100; i++) s.push(i);
    expect(s.percentile(50)).toBe(50);
    expect(s.percentile(95)).toBe(95);
    expect(s.percentile(99)).toBe(99);
    for (let i = 0; i < 100; i++) s.push(1000);
    expect(s.percentile(50)).toBe(1000);
    expect(s.size).toBe(100);
  });

  it('ignores non-finite samples and handles empty windows', () => {
    const s = new RollingStats(4);
    expect(s.percentile(50)).toBeNull();
    s.push(Number.NaN);
    expect(s.size).toBe(0);
  });
});

describe('planLogRetention', () => {
  const day = 86_400_000;
  const now = 100 * day;
  it('removes expired files and then oldest files over budget, never the active file', () => {
    const files = [
      { name: 'a.log', sizeBytes: 10, modifiedMs: now - 30 * day },
      { name: 'b.log', sizeBytes: 50, modifiedMs: now - 3 * day },
      { name: 'c.log', sizeBytes: 50, modifiedMs: now - 2 * day },
      { name: 'active.log', sizeBytes: 50, modifiedMs: now - 40 * day },
    ];
    const removed = planLogRetention(files, { nowMs: now, maxAgeDays: 14, maxTotalBytes: 110, activeFile: 'active.log' });
    expect(removed.sort()).toEqual(['a.log', 'b.log']);
  });
});
