import type { BoothRuntime } from '../runtime/runtime';

export type UiCue = 'select' | 'confirm' | 'tick' | 'results';

/** Short synthesised UI cues, mixed under the music at the operator-set volume (0 disables). */
export function uiCue(runtime: BoothRuntime, cue: UiCue): void {
  runtime.playUiCue(cue);
}

/** Frequency/duration recipes per cue (no audio files needed). */
export const CUE_NOTES: Record<UiCue, [number, number][]> = {
  select: [[880, 0.05]],
  confirm: [
    [660, 0.06],
    [990, 0.09],
  ],
  tick: [[740, 0.08]],
  results: [
    [523.25, 0.1],
    [659.25, 0.1],
    [783.99, 0.18],
  ],
};
