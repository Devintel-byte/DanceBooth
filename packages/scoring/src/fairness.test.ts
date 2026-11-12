import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_PRESETS } from './judge';
import { PlayerScorer, type ScorableRoutine } from './scorer';
import { perform, type PerformerKind } from './fairness';

/**
 * Fairness over the real bundled routines with simulated performers: people
 * who follow the dancer must clearly beat people who do not, whatever they do
 * instead. Share of the maximum points, averaged over routines and seeds.
 */
const dir = path.resolve(__dirname, '../../../assets/routines');
const routines = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as ScorableRoutine & { id: string; durationSec: number; bpm?: number; difficulty: 'easy' | 'normal' | 'hard' });

function share(kind: PerformerKind, difficulty: 'easy' | 'normal' | 'hard'): number {
  const v: number[] = [];
  routines.forEach((r, ri) => {
    for (let seed = 1; seed <= 2; seed++) {
      const p = perform(kind, r, { seed: seed * 131 + ri, durationSec: r.durationSec, bpm: r.bpm, other: routines[(ri + 3) % routines.length] });
      const sc = new PlayerScorer(r, DIFFICULTY_PRESETS[difficulty]);
      p.frames.forEach((f, i) => {
        sc.addSample(i, f.songTimeSec, f.pose, f.alt);
        sc.advance(f.songTimeSec);
      });
      sc.finish();
      v.push(sc.summary().points / (sc.judgeableMoves * DIFFICULTY_PRESETS[difficulty].pointsPerMove));
    }
  });
  return (v.reduce((a, b) => a + b, 0) / v.length) * 100;
}

describe.each(['easy', 'normal', 'hard'] as const)('fair scoring (%s)', (difficulty) => {
  const kinds = ['expert', 'good', 'late', 'sameside', 'sloppy', 'wrong', 'bobber', 'flailer', 'still'] as const;
  const s = Object.fromEntries(kinds.map((k) => [k, share(k, difficulty)])) as Record<(typeof kinds)[number], number>;

  it('rewards following the dancer', () => {
    expect(s.expert).toBeGreaterThan(85);
    expect(s.good).toBeGreaterThan(75);
    expect(s.late).toBeGreaterThan(80); // a steady reaction delay is not punished
    expect(s.sameside).toBeGreaterThan(80); // copying same-side is accepted
  });

  it('gives (almost) nothing for not following', () => {
    // No points for taking part: standing still scores 0, and moving about
    // without copying the moves only scores on the rare move it lands on by chance.
    expect(s.still).toBe(0);
    expect(s.bobber).toBeLessThan(4);
    expect(s.flailer).toBeLessThan(12);
    expect(s.sloppy).toBeLessThan(15);
    // A different dance shares some poses with this one (same move pool).
    expect(s.wrong).toBeLessThan(25);
  });

  it('keeps the order: better following, more points', () => {
    expect(s.expert).toBeGreaterThanOrEqual(s.good);
    expect(s.good).toBeGreaterThan(s.sloppy + 60);
    expect(s.sloppy).toBeGreaterThan(s.still);
  });
});

it('gives standing still nothing on any move', () => {
  for (const r of routines) {
    const sc = new PlayerScorer(r, DIFFICULTY_PRESETS.normal);
    const p = perform('still', r, { seed: 7, durationSec: r.durationSec });
    p.frames.forEach((f, i) => {
      sc.addSample(i, f.songTimeSec, f.pose, f.alt);
      sc.advance(f.songTimeSec);
    });
    sc.finish();
    for (const m of sc.moveResults) expect(m.points, `${r.id} move at ${m.moveTimeSec}s`).toBe(0);
  }
});
