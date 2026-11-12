import type { AnimationSegment } from '@booth/contracts';

export interface ClipSample {
  clip: string;
  /** Time within the clip, seconds (looped). */
  time: number;
  /** Blend weight 0..1; weights of all samples sum to 1. */
  weight: number;
}

function clipTime(seg: AnimationSegment, songTimeSec: number, clipDuration: number): number {
  const raw = seg.clipOffsetSec + (songTimeSec - seg.startSec) * seg.timeScale;
  if (!(clipDuration > 0)) return 0;
  return ((raw % clipDuration) + clipDuration) % clipDuration;
}

/**
 * Which clips play at a song time, at what clip time and weight. Pure and
 * deterministic: the 3D instructor and the scoring-reference extractor both
 * use it, so what the participant sees is exactly what is judged.
 * Before the first segment the first segment's clip is held at its offset;
 * after the last, the last segment continues.
 */
export function sampleClipTimeline(
  segments: readonly AnimationSegment[],
  songTimeSec: number,
  clipDurations: Readonly<Record<string, number>>,
): ClipSample[] {
  if (segments.length === 0) return [];
  const t = Math.max(segments[0]!.startSec, songTimeSec);
  let idx = segments.findIndex((s) => t >= s.startSec && t < s.endSec);
  if (idx < 0) idx = t < segments[0]!.startSec ? 0 : segments.length - 1;
  const seg = segments[idx]!;
  const cur: ClipSample = { clip: seg.clip, time: clipTime(seg, t, clipDurations[seg.clip] ?? 0), weight: 1 };
  const prev = segments[idx - 1];
  const into = t - seg.startSec;
  if (prev && seg.blendSec > 0 && into < seg.blendSec && prev.clip !== seg.clip) {
    const w = into / seg.blendSec;
    return [
      { clip: prev.clip, time: clipTime(prev, t, clipDurations[prev.clip] ?? 0), weight: 1 - w },
      { ...cur, weight: w },
    ];
  }
  return [cur];
}
