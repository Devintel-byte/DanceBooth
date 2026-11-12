import { describe, expect, it } from 'vitest';
import { RestartPolicy } from './restart-policy';

describe('RestartPolicy', () => {
  it('allows a bounded number of restarts per window and then escalates', () => {
    const p = new RestartPolicy(3, 60_000);
    expect(p.tryRestart(0)).toBe(true);
    expect(p.tryRestart(1000)).toBe(true);
    expect(p.tryRestart(2000)).toBe(true);
    expect(p.tryRestart(3000)).toBe(false);
    expect(p.tryRestart(61_000)).toBe(true); // first attempt aged out
  });
});
