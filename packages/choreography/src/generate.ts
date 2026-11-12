import type { AnimationSegment } from '@booth/contracts';

/** A dance clip and its own measured beat (see scripts/clip-beats.ts). */
export interface DanceClip {
  name: string;
  durationSec: number;
  /** Seconds per beat in the clip as authored. */
  beatSec: number;
  /** Clip time of a step on the clip's beat grid. */
  downbeatSec: number;
  /** Whole beats from the downbeat to the end of the clip. */
  beats: number;
  /** Seamless loop of whole beats: may play past its end and stay on the beat. */
  loops: boolean;
  /** Relative chance of being picked (default 1). */
  weight?: number;
}

export interface SongGrid {
  bpm: number;
  firstBeatSec: number;
  durationSec: number;
  /** Beats in the song from firstBeatSec. */
  beats: number;
}

export interface GenerateOptions {
  idleClip: string;
  countInBeats: number;
  /** Phrase lengths in song beats to choose from (default [8, 8, 16]: mostly two bars). */
  phraseBeats?: readonly number[];
  /** Stop dancing this many beats before the song's last beat (default 2). */
  outroBeats?: number;
  /** Slowest / fastest a clip may be played (default 0.72 .. 1.4). */
  minTimeScale?: number;
  maxTimeScale?: number;
  /** A clip is not reused until this many other clips have played (default 4, or fewer if the pool is small). */
  noRepeatWithin?: number;
}

/** Small deterministic PRNG (mulberry32), so a seed always gives the same routine. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How fast to play a clip so its beat matches the song's: clip seconds per
 * song second. A clip far slower or faster than the song is played at half or
 * double its own beat (two clip beats per song beat, or one per two). Returns
 * null when no such speed is within range.
 */
export function beatMatchedTimeScale(clip: Pick<DanceClip, 'beatSec'>, songBeatSec: number, min = 0.72, max = 1.4): { timeScale: number; clipBeatsPerSongBeat: number } | null {
  for (const k of [1, 2, 0.5]) {
    const timeScale = (clip.beatSec * k) / songBeatSec;
    if (timeScale >= min && timeScale <= max) return { timeScale, clipBeatsPerSongBeat: k };
  }
  return null;
}

/**
 * Builds a random dance for a song from a pool of clips. Every phrase starts
 * on a song beat with the clip positioned on one of its own steps and played
 * at the speed that puts its steps on the song's beats, so the dancer stays on
 * the beat through the whole song. Deterministic for a given `random`.
 */
export function generateClipTimeline(song: SongGrid, pool: readonly DanceClip[], opts: GenerateOptions, random: () => number): AnimationSegment[] {
  const beat = 60 / song.bpm;
  const at = (b: number) => song.firstBeatSec + b * beat;
  const phraseBeats = opts.phraseBeats ?? [8, 8, 16];
  const outro = opts.outroBeats ?? 2;
  const min = opts.minTimeScale ?? 0.72;
  const max = opts.maxTimeScale ?? 1.4;
  const blendSec = Math.min(0.25, beat / 2);

  const usable = pool
    .map((clip) => ({ clip, fit: beatMatchedTimeScale(clip, beat, min, max) }))
    .filter((c): c is { clip: DanceClip; fit: NonNullable<typeof c.fit> } => c.fit !== null && c.clip.name !== opts.idleClip);
  if (usable.length === 0) throw new Error('no dance clip can be matched to this song\'s tempo');
  const noRepeat = Math.min(opts.noRepeatWithin ?? 4, usable.length - 1);

  const segments: AnimationSegment[] = [
    { clip: opts.idleClip, startSec: 0, endSec: at(opts.countInBeats), timeScale: 1, clipOffsetSec: 0, blendSec: 0 },
  ];
  const recent: string[] = [];
  const lastBeat = song.beats - outro;
  let b = opts.countInBeats;
  while (b < lastBeat) {
    const want = phraseBeats[Math.floor(random() * phraseBeats.length)]!;
    const len = Math.min(want, lastBeat - b);
    // Clips that can hold this phrase (or a shorter one of at least 4 beats) and were not just used.
    const fits = (c: (typeof usable)[number], n: number) => c.clip.loops || c.clip.beats >= Math.ceil(n * c.fit.clipBeatsPerSongBeat);
    let n = len;
    let candidates = usable.filter((c) => !recent.includes(c.clip.name) && fits(c, n));
    if (candidates.length === 0 && len > 4) {
      n = 4;
      candidates = usable.filter((c) => !recent.includes(c.clip.name) && fits(c, n));
    }
    if (candidates.length === 0) candidates = usable.filter((c) => fits(c, (n = Math.min(len, 4))));
    if (candidates.length === 0) candidates = usable.filter((c) => c.clip.loops);
    if (candidates.length === 0) break;
    const total = candidates.reduce((s, c) => s + (c.clip.weight ?? 1), 0);
    let pick = random() * total;
    const chosen = candidates.find((c) => (pick -= c.clip.weight ?? 1) < 0) ?? candidates[candidates.length - 1]!;
    const { clip, fit } = chosen;
    const clipBeatsNeeded = Math.ceil(n * fit.clipBeatsPerSongBeat);
    // Start on a random step of the clip that falls on a song beat (every
    // clipBeatsPerSongBeat clip beats), leaving room for the phrase; a loop can start anywhere.
    const step = Math.max(1, fit.clipBeatsPerSongBeat);
    const room = clip.loops ? clip.beats - 1 : Math.max(0, clip.beats - clipBeatsNeeded);
    const startBeat = step * Math.floor(random() * (Math.floor(room / step) + 1));
    const clipOffsetSec = clip.downbeatSec + startBeat * clip.beatSec;
    segments.push({
      clip: clip.name,
      startSec: at(b),
      endSec: at(b + n),
      timeScale: fit.timeScale,
      clipOffsetSec: clipOffsetSec % clip.durationSec,
      blendSec,
    });
    recent.push(clip.name);
    if (recent.length > noRepeat) recent.shift();
    b += n;
  }
  segments.push({ clip: opts.idleClip, startSec: at(b), endSec: song.durationSec, timeScale: 1, clipOffsetSec: 0, blendSec: 0.3 });
  return segments.map((s) => ({ ...s, startSec: +s.startSec.toFixed(4), endSec: +s.endSec.toFixed(4), timeScale: +s.timeScale.toFixed(5), clipOffsetSec: +s.clipOffsetSec.toFixed(4) }));
}
