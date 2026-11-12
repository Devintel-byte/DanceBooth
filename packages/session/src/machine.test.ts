import { describe, expect, it } from 'vitest';
import { SimulatedClock, createActor } from 'xstate';
import { sessionRulesSchema } from '@booth/contracts';
import { ACTIVE_SESSION_STATES, sessionMachine, type SessionEvent, type SessionStateName } from './index';

const rules = sessionRulesSchema.parse({});

function boot() {
  const clock = new SimulatedClock();
  const actor = createActor(sessionMachine, {
    clock,
    input: { rules, defaultRoutineId: 'dev-groove', defaultDifficulty: 'normal' },
  });
  actor.start();
  const send = (e: SessionEvent) => actor.send(e);
  const state = () => actor.getSnapshot().value as SessionStateName;
  const ctx = () => actor.getSnapshot().context;
  send({ type: 'BOOTED' });
  send({ type: 'SELF_CHECK_PASSED' });
  return { actor, clock, send, state, ctx };
}

/** Drives a session from ATTRACT to PLAYING through the participant journey. */
function toPlaying(h: ReturnType<typeof boot>) {
  h.send({ type: 'START' });
  h.send({ type: 'SELECT_MODE', mode: 'single' });
  h.send({ type: 'CONFIRM_CHARACTERS', players: [{ slot: 1, characterId: 'demo', paletteId: 'p' }] });
  h.send({ type: 'CONFIRM_NAMES', players: [{ slot: 1, characterId: 'demo', paletteId: 'p', name: 'Ada', playerId: 'player-001' }] });
  h.send({ type: 'CALIBRATED', sessionId: h.ctx().sessionId });
  h.send({ type: 'SKIP' });
  h.clock.increment(rules.countdownSec * 1000);
  expect(h.state()).toBe('PLAYING');
}

describe('session machine', () => {
  it('lets the participant pick the song at character select, and the operator set the song for new sessions', () => {
    const h = boot();
    // Operator chooses the song while the booth is idle: the next participant gets it.
    h.send({ type: 'SET_DEFAULT_ROUTINE', routineId: 'maltina-theme' });
    h.send({ type: 'START' });
    expect(h.ctx().routineId).toBe('maltina-theme');
    h.send({ type: 'SELECT_MODE', mode: 'single' });
    expect(h.state()).toBe('CHARACTER_SELECT');
    // Participant switches song on the character screen.
    h.send({ type: 'SELECT_ROUTINE', routineId: 'amatry' });
    expect(h.state()).toBe('CHARACTER_SELECT');
    expect(h.ctx().routineId).toBe('amatry');
    h.send({ type: 'CONFIRM_CHARACTERS', players: [{ slot: 1, characterId: 'demo', paletteId: 'p' }] });
    h.send({ type: 'CONFIRM_NAMES', players: [{ slot: 1, characterId: 'demo', paletteId: 'p', name: 'Ada', playerId: 'player-001' }] });
    expect(h.ctx().routineId).toBe('amatry');
    // A later session starts again with the operator's song.
    h.send({ type: 'ABORT' });
    h.send({ type: 'RESET_DONE' });
    h.send({ type: 'START' });
    expect(h.ctx().routineId).toBe('maltina-theme');
    // The operator changing song while someone is choosing applies straight away.
    h.send({ type: 'SELECT_MODE', mode: 'single' });
    h.send({ type: 'SET_DEFAULT_ROUTINE', routineId: 'my-bebe' });
    expect(h.ctx().routineId).toBe('my-bebe');
    expect(h.state()).toBe('CHARACTER_SELECT');
  });

  it('runs the full journey and returns to attract', () => {
    const h = boot();
    expect(h.state()).toBe('ATTRACT');
    toPlaying(h);
    h.send({ type: 'SONG_ENDED', sessionId: h.ctx().sessionId });
    expect(h.state()).toBe('RESULTS');
    expect(h.ctx().endReason).toBe('completed');
    h.clock.increment(rules.resultsDisplaySec * 1000);
    expect(h.state()).toBe('RESETTING');
    h.send({ type: 'RESET_DONE' });
    expect(h.state()).toBe('ATTRACT');
    expect(h.ctx().players).toEqual([]);
  });

  it('play again starts a new session with the same choices at calibration', () => {
    const h = boot();
    h.send({ type: 'START' });
    h.send({ type: 'SELECT_MODE', mode: 'duo' });
    const players = [
      { slot: 1 as const, characterId: 'a', paletteId: 'x' },
      { slot: 2 as const, characterId: 'b', paletteId: 'y' },
    ];
    h.send({ type: 'CONFIRM_CHARACTERS', players });
    const named = players.map((p, i) => ({ ...p, name: `P${i + 1}`, playerId: `player-00${i + 1}` }));
    h.send({ type: 'CONFIRM_NAMES', players: named });
    h.send({ type: 'SKIP_CALIBRATION' });
    h.send({ type: 'SKIP' });
    h.clock.increment(rules.countdownSec * 1000);
    const first = h.ctx().sessionId;
    h.send({ type: 'SONG_ENDED', sessionId: first });
    h.send({ type: 'PLAY_AGAIN' });
    expect(h.state()).toBe('RESETTING');
    h.send({ type: 'RESET_DONE' });
    expect(h.state()).toBe('CALIBRATION');
    expect(h.ctx().sessionId).toBe(first + 1);
    expect(h.ctx().mode).toBe('duo');
    // Same people, same names and player ids: they keep their leaderboard identity.
    expect(h.ctx().players).toEqual(named);
    expect(h.ctx().rematch).toBeNull();
    // A later normal finish goes back to attract.
    h.send({ type: 'ABORT' });
    h.send({ type: 'RESET_DONE' });
    expect(h.state()).toBe('ATTRACT');
  });

  it('ignores stale events from a previous session', () => {
    const h = boot();
    toPlaying(h);
    const old = h.ctx().sessionId;
    h.send({ type: 'ABORT' });
    h.send({ type: 'RESET_DONE' });
    toPlaying(h);
    h.send({ type: 'SONG_ENDED', sessionId: old });
    expect(h.state()).toBe('PLAYING');
    h.send({ type: 'ERROR', sessionId: old, error: { code: 'AUDIO_LOAD_FAILED', message: 'x', recoverable: true } });
    expect(h.state()).toBe('PLAYING');
  });

  it('lets the operator abort from every active state', () => {
    const reach: Record<string, (h: ReturnType<typeof boot>) => void> = {
      MODE_SELECT: (h) => h.send({ type: 'START' }),
      CHARACTER_SELECT: (h) => {
        h.send({ type: 'START' });
        h.send({ type: 'SELECT_MODE', mode: 'duo' });
      },
      NAME_ENTRY: (h) => h.send({ type: 'OPERATOR_START', mode: 'single' }),
      CALIBRATION: (h) => {
        h.send({ type: 'OPERATOR_START', mode: 'single' });
        h.send({ type: 'CONFIRM_NAMES', players: [{ slot: 1, characterId: 'a', paletteId: 'b', name: 'Ada', playerId: 'player-001' }] });
      },
      TUTORIAL: (h) => {
        reach.CALIBRATION!(h);
        h.send({ type: 'SKIP_CALIBRATION' });
      },
      COUNTDOWN: (h) => {
        reach.CALIBRATION!(h);
        h.send({ type: 'SKIP_CALIBRATION' });
        h.send({ type: 'SKIP' });
      },
      PLAYING: (h) => toPlaying(h),
      PAUSED: (h) => {
        toPlaying(h);
        h.send({ type: 'PAUSE' });
      },
      RESULTS: (h) => {
        toPlaying(h);
        h.send({ type: 'SONG_ENDED', sessionId: h.ctx().sessionId });
      },
    };
    for (const s of ACTIVE_SESSION_STATES) {
      const h = boot();
      reach[s]!(h);
      expect(h.state()).toBe(s);
      h.send({ type: 'ABORT' });
      expect(h.state(), `abort from ${s}`).toBe('RESETTING');
    }
  });

  it('returns to attract after selection inactivity, and activity extends it', () => {
    const h = boot();
    h.send({ type: 'START' });
    h.clock.increment(rules.selectionTimeoutSec * 1000 - 100);
    h.send({ type: 'ACTIVITY' });
    h.clock.increment(rules.selectionTimeoutSec * 1000 - 100);
    expect(h.state()).toBe('MODE_SELECT');
    h.clock.increment(200);
    expect(h.state()).toBe('RESETTING');
    expect(h.ctx().endReason).toBe('timeout');
  });

  it('requires a name and a unique id for every player before calibration', () => {
    const h = boot();
    h.send({ type: 'OPERATOR_START', mode: 'duo' });
    expect(h.state()).toBe('NAME_ENTRY');
    const p = (slot: 1 | 2, name?: string, playerId?: string) => ({ slot, characterId: 'a', paletteId: 'b', name, playerId });
    h.send({ type: 'CONFIRM_NAMES', players: [p(1, 'Ada', 'player-001')] });
    expect(h.state()).toBe('NAME_ENTRY'); // one name missing in duo
    h.send({ type: 'CONFIRM_NAMES', players: [p(1, 'Ada', 'player-001'), p(2, 'Bo', 'player-001')] });
    expect(h.state()).toBe('NAME_ENTRY'); // duplicate id
    h.send({ type: 'CONFIRM_NAMES', players: [p(1, 'Ada', 'player-001'), p(2, 'Ada', 'player-002')] });
    expect(h.state()).toBe('CALIBRATION'); // same name is fine, ids keep them distinct
    expect(h.ctx().players.map((x) => x.playerId)).toEqual(['player-001', 'player-002']);
  });

  it('times out name entry back to reset', () => {
    const h = boot();
    h.send({ type: 'OPERATOR_START', mode: 'single' });
    h.clock.increment(rules.nameEntryTimeoutSec * 1000);
    expect(h.state()).toBe('RESETTING');
  });

  function toCalibration(h: ReturnType<typeof boot>) {
    h.send({ type: 'OPERATOR_START', mode: 'duo' });
    expect(h.ctx().players).toHaveLength(2);
    h.send({
      type: 'CONFIRM_NAMES',
      players: [
        { slot: 1, characterId: 'a', paletteId: 'b', name: 'A', playerId: 'player-001' },
        { slot: 2, characterId: 'a', paletteId: 'b', name: 'B', playerId: 'player-002' },
      ],
    });
    expect(h.state()).toBe('CALIBRATION');
  }

  it('keeps calibrating while players are trying (no quick timeout)', () => {
    const h = boot();
    toCalibration(h);
    h.clock.increment(60_000); // well past the old 40 s timeout
    expect(h.state()).toBe('CALIBRATION');
    // Safety cap only.
    h.clock.increment(rules.calibrationTimeoutSec * 1000);
    expect(h.state()).toBe('RESETTING');
  });

  it('lets players dance anyway, and returns to the start only when nobody is there', () => {
    const a = boot();
    toCalibration(a);
    a.send({ type: 'DANCE_ANYWAY', sessionId: a.ctx().sessionId - 1 }); // stale session: ignored
    expect(a.state()).toBe('CALIBRATION');
    a.send({ type: 'DANCE_ANYWAY', sessionId: a.ctx().sessionId });
    expect(a.state()).toBe('TUTORIAL');

    const b = boot();
    toCalibration(b);
    b.send({ type: 'CALIBRATION_ABANDONED', sessionId: b.ctx().sessionId });
    expect(b.state()).toBe('RESETTING');
    expect(b.ctx().endReason).toBe('timeout');
  });

  it('operator can skip calibration', () => {
    const h = boot();
    toCalibration(h);
    h.send({ type: 'SKIP_CALIBRATION' });
    expect(h.state()).toBe('TUTORIAL');
  });

  it('pauses on tracking loss and aborts after the paused timeout', () => {
    const h = boot();
    toPlaying(h);
    h.send({ type: 'TRACKING_LOST', sessionId: h.ctx().sessionId });
    expect(h.state()).toBe('PAUSED');
    expect(h.ctx().pauseReason).toBe('tracking-lost');
    h.send({ type: 'RESUME' });
    expect(h.state()).toBe('PLAYING');
    h.send({ type: 'PAUSE' });
    h.clock.increment(rules.pausedAbortSec * 1000);
    expect(h.state()).toBe('RESETTING');
  });

  it('starts only one countdown and does not overlap sessions', () => {
    const h = boot();
    h.send({ type: 'OPERATOR_START', mode: 'single' });
    const id = h.ctx().sessionId;
    h.send({ type: 'OPERATOR_START', mode: 'single' }); // ignored outside ATTRACT
    h.send({ type: 'START' });
    expect(h.ctx().sessionId).toBe(id);
    expect(h.state()).toBe('NAME_ENTRY');
  });

  it('escalates repeated recoverable errors to maintenance', () => {
    const h = boot();
    const err = { code: 'TRACKING_WORKER_CRASHED' as const, message: 'boom', recoverable: true };
    for (let i = 0; i < 3; i++) {
      h.send({ type: 'ERROR', error: err });
      expect(h.state()).toBe('RECOVERABLE_ERROR');
      h.clock.increment(3000);
      expect(h.state()).toBe('RESETTING');
      h.send({ type: 'RESET_DONE' });
    }
    h.send({ type: 'ERROR', error: err });
    h.clock.increment(3000);
    expect(h.state()).toBe('MAINTENANCE');
    h.send({ type: 'EXIT_MAINTENANCE' });
    expect(h.state()).toBe('SELF_CHECK');
  });

  it('sends unrecoverable errors straight to maintenance', () => {
    const h = boot();
    toPlaying(h);
    h.send({ type: 'ERROR', error: { code: 'MODEL_MISSING', message: 'no model', recoverable: false } });
    expect(h.state()).toBe('MAINTENANCE');
    expect(h.ctx().players).toEqual([]);
  });

  it('escalates a stuck reset via the watchdog', () => {
    const h = boot();
    h.send({ type: 'START' });
    h.send({ type: 'BACK' });
    h.clock.increment(5000);
    expect(h.state()).toBe('RECOVERABLE_ERROR');
  });

  it('survives many repeated session cycles without growing state', () => {
    const h = boot();
    for (let i = 0; i < 200; i++) {
      toPlaying(h);
      h.send({ type: 'SONG_ENDED', sessionId: h.ctx().sessionId });
      h.send({ type: 'CONTINUE' });
      h.send({ type: 'RESET_DONE' });
    }
    expect(h.state()).toBe('ATTRACT');
    expect(h.ctx().sessionId).toBe(200);
    expect(JSON.stringify(h.ctx()).length).toBeLessThan(2000);
  });
});
