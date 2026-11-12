import { describe, expect, it } from 'vitest';
import { buildLeaderboard, localDay, type StoredRecord } from './leaderboard';

const at = new Date(2026, 10, 2, 14, 0).toISOString();
const later = new Date(2026, 10, 2, 15, 0).toISOString();
const score = (slot: 1 | 2, playerId: string, s: number, points = s * 10) => ({ slot, playerId, score: s, points, judgedMoves: 10, insufficientEvidence: 0 });
const rec = (over: Partial<StoredRecord>): StoredRecord => ({
  at,
  eventId: 'ev',
  sessionId: 1,
  routineId: 'funky-chunk',
  mode: 'single',
  difficulty: 'easy',
  endedReason: 'completed',
  durationSec: 50,
  inputSource: 'webcam',
  scores: [score(1, 'player-001', 50)],
  ...over,
});
const names: Record<string, string> = { 'player-001': 'Ada', 'player-002': 'Sam', 'player-003': 'Sam' };
const opts = {
  eventId: 'ev',
  eventName: 'Event',
  day: localDay(new Date(at)),
  titles: { 'funky-chunk': 'Funky Chunk' },
  nameOf: (id: string) => names[id] ?? null,
};

describe('buildLeaderboard', () => {
  it('has one row per player id with their best score, both duo players ranked', () => {
    const b = buildLeaderboard(
      [
        rec({ sessionId: 1, scores: [score(1, 'player-001', 70)] }),
        rec({ sessionId: 2, mode: 'duo', scores: [score(1, 'player-002', 90), score(2, 'player-003', 60)] }),
        rec({ sessionId: 3, at: later, scores: [score(1, 'player-001', 80)] }), // Ada plays again and improves
      ],
      opts,
    );
    expect(b.entries.map((e) => [e.rank, e.playerId, e.name, e.points])).toEqual([
      [1, 'player-002', 'Sam', 900],
      [2, 'player-001', 'Ada', 800],
      [3, 'player-003', 'Sam', 600],
    ]);
    // Two different people both called Sam remain separate rows (unique ids).
    expect(b.entries.filter((e) => e.name === 'Sam')).toHaveLength(2);
  });

  it('ranks by points, never by match %, and breaks ties by who got there first', () => {
    const b = buildLeaderboard(
      [
        rec({ scores: [score(1, 'player-001', 95, 700)] }),
        rec({ at: later, scores: [score(1, 'player-002', 60, 900)] }),
        rec({ at: later, scores: [score(1, 'player-003', 99, 700)] }),
      ],
      opts,
    );
    expect(b.entries.map((e) => [e.rank, e.playerId])).toEqual([
      [1, 'player-002'],
      [2, 'player-001'],
      [2, 'player-003'],
    ]);
  });

  it('never includes replay, aborted, other-event, other-day, unjudged, unnamed or cleared players', () => {
    const b = buildLeaderboard(
      [
        rec({ inputSource: 'replay' }),
        rec({ endedReason: 'aborted' }),
        rec({ eventId: 'other' }),
        rec({ at: new Date(2026, 9, 1).toISOString() }),
        rec({ scores: [{ ...score(1, 'player-001', 0), judgedMoves: 0 }] }),
        rec({ scores: [{ slot: 1, score: 99, judgedMoves: 10, insufficientEvidence: 0 }] }),
        rec({ scores: [score(1, 'player-099', 99)] }),
      ],
      opts,
    );
    expect(b.entries).toEqual([]);
  });
});
