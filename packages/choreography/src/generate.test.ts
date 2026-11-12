import { describe, expect, it } from 'vitest';
import { beatMatchedTimeScale, generateClipTimeline, seededRandom, type DanceClip } from './generate';
import { sampleClipTimeline } from './clip-timeline';

const pool: DanceClip[] = [
  { name: 'a', durationSec: 8, beatSec: 0.5, downbeatSec: 0.1, beats: 15, loops: false },
  { name: 'b', durationSec: 6, beatSec: 0.6, downbeatSec: 0.2, beats: 9, loops: true },
  { name: 'c', durationSec: 20, beatSec: 0.45, downbeatSec: 0.05, beats: 44, loops: false },
  { name: 'd', durationSec: 4, beatSec: 0.55, downbeatSec: 0, beats: 7, loops: false },
  { name: 'e', durationSec: 12, beatSec: 0.25, downbeatSec: 0.1, beats: 47, loops: false },
  { name: 'slow', durationSec: 12, beatSec: 2.9, downbeatSec: 0, beats: 4, loops: false },
];
const song = { bpm: 113, firstBeatSec: 0.16, durationSec: 45.6, beats: 84 };
const opts = { idleClip: 'idle', countInBeats: 4 };
const durations = Object.fromEntries([...pool.map((c) => [c.name, c.durationSec] as const), ['idle', 2] as const]);

describe('generateClipTimeline', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = generateClipTimeline(song, pool, opts, seededRandom(1));
    expect(generateClipTimeline(song, pool, opts, seededRandom(1))).toEqual(a);
    expect(generateClipTimeline(song, pool, opts, seededRandom(2)).map((s) => s.clip)).not.toEqual(a.map((s) => s.clip));
  });

  it('starts every phrase on a song beat and puts the clip steps on the song beats', () => {
    const beat = 60 / song.bpm;
    for (let seed = 0; seed < 20; seed++) {
      const segs = generateClipTimeline(song, pool, opts, seededRandom(seed));
      for (const s of segs.slice(1, -1)) {
        const clip = pool.find((c) => c.name === s.clip)!;
        const sb = (s.startSec - song.firstBeatSec) / beat;
        expect(Math.abs(sb - Math.round(sb))).toBeLessThan(1e-3);
        // Song beats inside the phrase map to clip steps (downbeat + k * clip beat).
        for (let t = s.startSec; t < s.endSec - 1e-6; t += beat) {
          const raw = s.clipOffsetSec + (t - s.startSec) * s.timeScale;
          const k = (raw - clip.downbeatSec) / (clip.beatSec * beatMatchedTimeScale(clip, beat)!.clipBeatsPerSongBeat);
          expect(Math.abs(k - Math.round(k))).toBeLessThan(0.01);
          // Non-looping clips never run past their end inside a phrase.
          if (!clip.loops) expect(raw).toBeLessThanOrEqual(clip.durationSec + 1e-6);
        }
        expect(s.timeScale).toBeGreaterThanOrEqual(0.72);
        expect(s.timeScale).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('never uses a clip that cannot match the tempo, and does not repeat a clip back to back', () => {
    for (let seed = 0; seed < 20; seed++) {
      const segs = generateClipTimeline(song, pool, opts, seededRandom(seed));
      expect(segs.some((s) => s.clip === 'slow')).toBe(false);
      for (let i = 2; i < segs.length - 1; i++) expect(segs[i]!.clip).not.toBe(segs[i - 1]!.clip);
      expect(segs[0]!.clip).toBe('idle');
      expect(segs[segs.length - 1]!.clip).toBe('idle');
      // Contiguous, and samples cleanly.
      for (let i = 1; i < segs.length; i++) expect(segs[i]!.startSec).toBeCloseTo(segs[i - 1]!.endSec, 3);
      expect(sampleClipTimeline(segs, 20, durations).length).toBeGreaterThan(0);
    }
  });

  it('plays a fast clip at half its own beat (two clip beats per song beat)', () => {
    const fit = beatMatchedTimeScale({ beatSec: 0.25 }, 60 / 113)!;
    expect(fit.clipBeatsPerSongBeat).toBe(2);
    expect(fit.timeScale).toBeCloseTo((0.5 * 113) / 60, 9);
    expect(beatMatchedTimeScale({ beatSec: 2.9 }, 60 / 113)).toBeNull();
  });
});

describe('session dances', () => {
  it('never picks the same dance twice in a row and reaches every dance', async () => {
    const { pickDance } = await import('./variations');
    const rnd = seededRandom(9);
    const seen = new Set<number>();
    let last: number | undefined;
    for (let i = 0; i < 400; i++) {
      const d = pickDance(16, last, rnd);
      expect(d).not.toBe(last);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(16);
      seen.add(d);
      last = d;
    }
    expect(seen.size).toBe(16);
    expect(pickDance(1, 0, rnd)).toBe(0);
  });
});
