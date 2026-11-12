import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Leaderboard, LeaderboardEntry, SessionRecord } from '@booth/contracts';

export interface StoredRecord extends Omit<SessionRecord, 'scores'> {
  /** Unique, persistent id of this stored record (survives app restarts, unlike sessionId). */
  recordId?: string;
  at: string;
  eventId: string;
  /** As sent by the participant screen, plus the 4-digit player number as `code` (added by the main process when one was given). */
  scores: (SessionRecord['scores'][number] & { code?: string })[];
}

export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today's completed LIVE sessions for one event (the records the board and feed are built from). */
export function countedRecords(records: readonly StoredRecord[], eventId: string, day: string): StoredRecord[] {
  return records.filter(
    (r) => r.eventId === eventId && r.endedReason === 'completed' && r.inputSource === 'webcam' && localDay(new Date(r.at)) === day,
  );
}

/**
 * One row per player id (their best performance today), ranked by points,
 * then who got there first (percentages are not used for ranking). Replay/demo, aborted and
 * unjudged sessions never appear, and neither do players whose names were
 * cleared, so the board only ever shows real, attributable results.
 */
export function buildLeaderboard(
  records: readonly StoredRecord[],
  opts: {
    eventId: string;
    eventName: string;
    day: string;
    titles: Record<string, string>;
    nameOf: (playerId: string) => string | null;
    limit?: number;
  },
): Leaderboard {
  const counted = countedRecords(records, opts.eventId, opts.day);
  const best = new Map<string, Omit<LeaderboardEntry, 'rank'>>();
  for (const r of counted) {
    for (const s of r.scores) {
      if (s.judgedMoves === 0 || !s.playerId) continue;
      const name = opts.nameOf(s.playerId);
      if (!name) continue;
      const row = {
        playerId: s.playerId,
        name,
        sessionId: r.sessionId,
        slot: s.slot,
        score: s.score,
        points: s.points ?? 0,
        routineId: r.routineId,
        routineTitle: opts.titles[r.routineId] ?? r.routineId,
        mode: r.mode,
        at: r.at,
        guest: !s.code,
      };
      const prev = best.get(s.playerId);
      if (!prev || row.points > prev.points || (row.points === prev.points && row.at < prev.at)) best.set(s.playerId, row);
    }
  }
  const rows = [...best.values()].sort((a, b) => b.points - a.points || a.at.localeCompare(b.at));
  const entries: LeaderboardEntry[] = [];
  let rank = 0;
  let prev: string | null = null;
  rows.slice(0, opts.limit ?? 20).forEach((r, i) => {
    const key = String(r.points);
    if (key !== prev) rank = i + 1;
    prev = key;
    entries.push({ ...r, rank });
  });
  return { eventName: opts.eventName, day: opts.day, entries, sessionsCounted: counted.length };
}

/** Reads stored session records; malformed lines are skipped. */
export function readRecords(dir: string): StoredRecord[] {
  if (!existsSync(dir)) return [];
  const out: StoredRecord[] = [];
  for (const name of readdirSync(dir).filter((n) => /^sessions-.*\.jsonl$/.test(n))) {
    for (const line of readFileSync(path.join(dir, name), 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as StoredRecord;
        if (typeof r.at === 'string' && Array.isArray(r.scores)) out.push(r);
      } catch {
        // Skip a partially written line rather than losing the board.
      }
    }
  }
  return out;
}
