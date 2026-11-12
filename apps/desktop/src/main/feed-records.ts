import type { StoredRecord } from './leaderboard';

/** One player of a completed session as the main leaderboard receives it. */
export interface FeedPlayer {
  /** `<boothId>:<eventId>:<playerId>`: stable even if the name is later cleared. */
  uid: string;
  playerId: string;
  /** Registered name for a recognised player number, otherwise the name as entered. Left out only when names were cleared for privacy. */
  name?: string;
  /** The 4-digit player number as text (leading zeros kept); only for players who gave one. */
  code?: string;
  slot: 1 | 2;
  /** Whole, non-negative points; higher is better. */
  points: number;
  // Informational (ignored by the main leaderboard).
  matchPercent: number;
  judgedMoves: number;
  unreadableMoves: number;
}

export interface FeedRecord {
  recordId: string;
  at: string;
  sessionId: number;
  players: FeedPlayer[];
  // Informational.
  routineId: string;
  routineTitle: string;
  mode: string;
  difficulty: string;
  durationSec: number;
}

export interface FeedContext {
  boothId: string;
  routineTitle: (routineId: string) => string;
  nameOf: (playerId: string) => string | null;
}

/** Same rule as the booth's own leaderboard: completed, live (camera) sessions only, never demo/replay, aborted or errored runs. */
export function isFeedable(r: StoredRecord): boolean {
  return r.endedReason === 'completed' && r.inputSource === 'webcam' && !!r.recordId;
}

/**
 * The feed record for a stored session, or null when it has nothing to send
 * (no player was readable). Built only from what is stored, so the same
 * session always yields the same recordId, uid, points and code, live or in
 * a snapshot, before or after a restart.
 */
export function toFeedRecord(r: StoredRecord, ctx: FeedContext): FeedRecord | null {
  if (!isFeedable(r)) return null;
  const players: FeedPlayer[] = [];
  for (const s of r.scores) {
    // Unreadable run for this player (nothing judged), or no registered id: not a result.
    if (!s.playerId || s.judgedMoves <= 0) continue;
    const name = ctx.nameOf(s.playerId);
    players.push({
      uid: `${ctx.boothId}:${r.eventId}:${s.playerId}`,
      playerId: s.playerId,
      ...(name ? { name } : {}),
      ...(s.code ? { code: s.code } : {}),
      slot: s.slot,
      points: Math.max(0, Math.round(Number.isFinite(s.points) ? (s.points as number) : 0)),
      matchPercent: Math.round(s.score),
      judgedMoves: s.judgedMoves,
      unreadableMoves: s.insufficientEvidence,
    });
  }
  if (players.length === 0) return null;
  return {
    recordId: r.recordId!,
    at: r.at,
    sessionId: r.sessionId,
    players,
    routineId: r.routineId,
    routineTitle: ctx.routineTitle(r.routineId),
    mode: r.mode,
    difficulty: r.difficulty,
    durationSec: r.durationSec,
  };
}

/** "Sent session 12: Kemi 2060, Ada 1840" (names only: never player numbers). */
export function describeSentRecord(f: FeedRecord): string {
  return `Sent session ${f.sessionId}: ${f.players.map((p) => `${p.name ?? p.playerId} ${p.points}`).join(', ')}`;
}
