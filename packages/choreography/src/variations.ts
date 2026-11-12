import type { RoutineManifest } from '@booth/contracts';

/** Number of different dances a routine offers (the default plus its variations). */
export function danceCount(routine: Pick<RoutineManifest, 'variations'>): number {
  return 1 + (routine.variations?.length ?? 0);
}

/**
 * The routine with dance `index` in place (0 = the default dance). Everything
 * else (song, timing, difficulty, id) is unchanged, so results and the
 * leaderboard still belong to the same routine.
 */
export function withDance(routine: RoutineManifest, index: number): RoutineManifest {
  const v = index > 0 ? routine.variations?.[index - 1] : undefined;
  if (!v || routine.animation.kind !== 'glb-timeline') return routine;
  return { ...routine, animation: { ...routine.animation, segments: v.segments }, moves: v.moves };
}

/** A random dance index, never the one played last time when there is a choice. */
export function pickDance(count: number, last: number | undefined, random: () => number = Math.random): number {
  if (count <= 1) return 0;
  if (last === undefined || last < 0 || last >= count) return Math.floor(random() * count);
  // Pick among the other count-1 dances.
  const i = Math.floor(random() * (count - 1));
  return i >= last ? i + 1 : i;
}
