import { assign, setup } from 'xstate';
import type { BoothError, Difficulty, SessionMode, SessionRules } from '@booth/contracts';

/** Every session-machine state. Names are part of the operator/diagnostics contract. */
export const SESSION_STATES = [
  'BOOT',
  'SELF_CHECK',
  'ATTRACT',
  'MODE_SELECT',
  'CHARACTER_SELECT',
  'NAME_ENTRY',
  'CALIBRATION',
  'TUTORIAL',
  'COUNTDOWN',
  'PLAYING',
  'PAUSED',
  'RESULTS',
  'RESETTING',
  'RECOVERABLE_ERROR',
  'MAINTENANCE',
] as const;
export type SessionStateName = (typeof SESSION_STATES)[number];

/** States in which a participant session exists and the operator may abort it. */
export const ACTIVE_SESSION_STATES: readonly SessionStateName[] = [
  'MODE_SELECT',
  'CHARACTER_SELECT',
  'NAME_ENTRY',
  'CALIBRATION',
  'TUTORIAL',
  'COUNTDOWN',
  'PLAYING',
  'PAUSED',
  'RESULTS',
];

export interface PlayerSelection {
  slot: 1 | 2;
  characterId: string;
  paletteId: string;
  /** Display name entered before the game (set at NAME_ENTRY). */
  name?: string;
  /** Serial id assigned by the booth for this name, e.g. player-001. */
  playerId?: string;
}

export type EndReason = 'completed' | 'aborted' | 'error' | 'timeout';

export interface SessionContext {
  /** Incremented when a new participant session begins; 0 means none yet. */
  sessionId: number;
  mode: SessionMode;
  routineId: string | null;
  difficulty: Difficulty;
  players: PlayerSelection[];
  pauseReason: 'operator' | 'tracking-lost' | null;
  endReason: EndReason | null;
  error: BoothError | null;
  /** Consecutive automatic recoveries; reset after a successful session start. */
  recoveryAttempts: number;
  /** Selections carried into the next session when the participant chooses "Play again". */
  rematch: Pick<SessionContext, 'mode' | 'routineId' | 'difficulty' | 'players'> | null;
  rules: SessionRules;
  maxRecoveryAttempts: number;
  defaultRoutineId: string | null;
  defaultDifficulty: Difficulty;
}

export interface SessionInput {
  rules: SessionRules;
  defaultRoutineId: string | null;
  defaultDifficulty: Difficulty;
  maxRecoveryAttempts?: number;
}

/**
 * Events. Those raised by asynchronous session resources (audio, tracking,
 * calibration) carry the `sessionId` they belong to; events from a previous
 * session are ignored so they cannot leak into the next one.
 */
export type SessionEvent =
  | { type: 'BOOTED' }
  | { type: 'SELF_CHECK_PASSED' }
  | { type: 'SELF_CHECK_FAILED'; error: BoothError }
  | { type: 'START' }
  | { type: 'OPERATOR_START'; mode: SessionMode; routineId?: string; difficulty?: Difficulty }
  | { type: 'ACTIVITY' }
  | { type: 'BACK' }
  | { type: 'SELECT_MODE'; mode: SessionMode }
  | { type: 'SELECT_ROUTINE'; routineId: string }
  /** Operator: the song new sessions start with (also applies to a session still choosing). */
  | { type: 'SET_DEFAULT_ROUTINE'; routineId: string }
  | { type: 'CONFIRM_CHARACTERS'; players: PlayerSelection[] }
  /** Players with names AND booth-assigned ids (registered before this event is sent). */
  | { type: 'CONFIRM_NAMES'; players: PlayerSelection[] }
  | { type: 'CALIBRATED'; sessionId: number }
  | { type: 'SKIP_CALIBRATION' }
  /** Participant chose to start although calibration is not complete (offered after calibrationHelpSec). */
  | { type: 'DANCE_ANYWAY'; sessionId: number }
  /** Nobody has been in view for calibrationAwaySec: the guest has left. */
  | { type: 'CALIBRATION_ABANDONED'; sessionId: number }
  | { type: 'SKIP' }
  | { type: 'SONG_ENDED'; sessionId: number }
  | { type: 'TRACKING_LOST'; sessionId: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CONTINUE' }
  | { type: 'PLAY_AGAIN' }
  | { type: 'ABORT' }
  | { type: 'RESET' }
  | { type: 'RESET_DONE' }
  | { type: 'ERROR'; error: BoothError; sessionId?: number }
  | { type: 'RETRY' }
  | { type: 'ENTER_MAINTENANCE' }
  | { type: 'EXIT_MAINTENANCE' };

const sec = (s: number) => Math.round(s * 1000);

export const sessionMachine = setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent,
    input: {} as SessionInput,
  },
  delays: {
    selectionTimeout: ({ context }) => sec(context.rules.selectionTimeoutSec),
    nameEntryTimeout: ({ context }) => sec(context.rules.nameEntryTimeoutSec),
    calibrationTimeout: ({ context }) => sec(context.rules.calibrationTimeoutSec),
    tutorial: ({ context }) => sec(context.rules.tutorialSec),
    countdown: ({ context }) => sec(context.rules.countdownSec),
    pausedAbort: ({ context }) => sec(context.rules.pausedAbortSec),
    results: ({ context }) => sec(context.rules.resultsDisplaySec),
    resetWatchdog: 5000,
    recoveryDelay: 3000,
  },
  guards: {
    isCurrentSession: ({ context, event }) =>
      'sessionId' in event && event.sessionId === context.sessionId,
    errorIsCurrentOrGlobal: ({ context, event }) =>
      event.type === 'ERROR' && (event.sessionId === undefined || event.sessionId === context.sessionId),
    errorIsUnrecoverable: ({ event }) => event.type === 'ERROR' && !event.error.recoverable,
    canAutoRecover: ({ context }) => context.recoveryAttempts < context.maxRecoveryAttempts,
    hasRoutine: ({ context }) => context.routineId !== null,
    hasRematch: ({ context }) => context.rematch !== null,
    namesComplete: ({ context, event }) =>
      event.type === 'CONFIRM_NAMES' &&
      event.players.length === (context.mode === 'duo' ? 2 : 1) &&
      event.players.every((p) => !!p.name && !!p.playerId) &&
      new Set(event.players.map((p) => p.playerId)).size === event.players.length,
  },
  actions: {
    beginSession: assign(({ context }) => ({
      sessionId: context.sessionId + 1,
      mode: 'single' as SessionMode,
      routineId: context.defaultRoutineId,
      difficulty: context.defaultDifficulty,
      players: [],
      pauseReason: null,
      endReason: null,
      error: null,
    })),
    applyOperatorStart: assign(({ context, event }) => {
      if (event.type !== 'OPERATOR_START') return {};
      return {
        mode: event.mode,
        routineId: event.routineId ?? context.routineId,
        difficulty: event.difficulty ?? context.difficulty,
        players: defaultPlayers(event.mode),
      };
    }),
    setMode: assign(({ event }) => (event.type === 'SELECT_MODE' ? { mode: event.mode } : {})),
    setRoutine: assign(({ event }) => (event.type === 'SELECT_ROUTINE' || event.type === 'SET_DEFAULT_ROUTINE' ? { routineId: event.routineId } : {})),
    setDefaultRoutine: assign(({ event }) => (event.type === 'SET_DEFAULT_ROUTINE' ? { defaultRoutineId: event.routineId } : {})),
    setPlayers: assign(({ event }) =>
      event.type === 'CONFIRM_CHARACTERS' || event.type === 'CONFIRM_NAMES' ? { players: event.players } : {},
    ),
    markOperatorPause: assign({ pauseReason: 'operator' as const }),
    markTrackingPause: assign({ pauseReason: 'tracking-lost' as const }),
    clearPause: assign({ pauseReason: null }),
    endCompleted: assign({ endReason: 'completed' as const, recoveryAttempts: 0 }),
    endAborted: assign({ endReason: 'aborted' as const }),
    endTimeout: assign({ endReason: 'timeout' as const }),
    recordError: assign(({ event }) =>
      event.type === 'ERROR' || event.type === 'SELF_CHECK_FAILED'
        ? { error: event.error, endReason: 'error' as const }
        : {},
    ),
    saveRematch: assign(({ context }) => ({
      rematch: { mode: context.mode, routineId: context.routineId, difficulty: context.difficulty, players: context.players },
    })),
    applyRematch: assign(({ context }) => (context.rematch ? { ...context.rematch, rematch: null } : {})),
    clearRematch: assign({ rematch: null }),
    countRecovery: assign(({ context }) => ({ recoveryAttempts: context.recoveryAttempts + 1 })),
    clearRecovery: assign({ recoveryAttempts: 0, error: null }),
    /** Clears all participant-specific data. Session id is kept so stale events stay detectable. */
    clearParticipant: assign(({ context }) => ({
      mode: 'single' as SessionMode,
      routineId: context.defaultRoutineId,
      difficulty: context.defaultDifficulty,
      players: [],
      pauseReason: null,
    })),
  },
}).createMachine({
  id: 'session',
  initial: 'BOOT',
  context: ({ input }) => ({
    sessionId: 0,
    mode: 'single',
    routineId: input.defaultRoutineId,
    difficulty: input.defaultDifficulty,
    players: [],
    pauseReason: null,
    endReason: null,
    error: null,
    recoveryAttempts: 0,
    rematch: null,
    rules: input.rules,
    maxRecoveryAttempts: input.maxRecoveryAttempts ?? 3,
    defaultRoutineId: input.defaultRoutineId,
    defaultDifficulty: input.defaultDifficulty,
  }),
  on: {
    ENTER_MAINTENANCE: { target: '.MAINTENANCE', actions: 'endAborted' },
    SET_DEFAULT_ROUTINE: { actions: 'setDefaultRoutine' },
    ERROR: [
      { guard: 'errorIsUnrecoverable', target: '.MAINTENANCE', actions: 'recordError' },
      { guard: 'errorIsCurrentOrGlobal', target: '.RECOVERABLE_ERROR', actions: 'recordError' },
    ],
  },
  states: {
    BOOT: {
      on: { BOOTED: 'SELF_CHECK' },
    },
    SELF_CHECK: {
      on: {
        SELF_CHECK_PASSED: { target: 'ATTRACT', actions: 'clearRecovery' },
        SELF_CHECK_FAILED: { target: 'MAINTENANCE', actions: 'recordError' },
      },
    },
    ATTRACT: {
      on: {
        START: { target: 'MODE_SELECT', actions: 'beginSession' },
        SET_DEFAULT_ROUTINE: { actions: ['setDefaultRoutine', 'setRoutine'] },
        OPERATOR_START: {
          guard: 'hasRoutine',
          target: 'NAME_ENTRY',
          actions: ['beginSession', 'applyOperatorStart'],
        },
      },
    },
    MODE_SELECT: {
      after: { selectionTimeout: { target: 'RESETTING', actions: 'endTimeout' } },
      on: {
        ACTIVITY: { target: 'MODE_SELECT', reenter: true },
        SELECT_MODE: { target: 'CHARACTER_SELECT', actions: 'setMode' },
        SELECT_ROUTINE: { actions: 'setRoutine', target: 'MODE_SELECT', reenter: true },
        SET_DEFAULT_ROUTINE: { actions: ['setDefaultRoutine', 'setRoutine'] },
        BACK: { target: 'RESETTING', actions: 'endAborted' },
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    CHARACTER_SELECT: {
      after: { selectionTimeout: { target: 'RESETTING', actions: 'endTimeout' } },
      on: {
        ACTIVITY: { target: 'CHARACTER_SELECT', reenter: true },
        SELECT_ROUTINE: { actions: 'setRoutine', target: 'CHARACTER_SELECT', reenter: true },
        SET_DEFAULT_ROUTINE: { actions: ['setDefaultRoutine', 'setRoutine'] },
        CONFIRM_CHARACTERS: { guard: 'hasRoutine', target: 'NAME_ENTRY', actions: 'setPlayers' },
        BACK: 'MODE_SELECT',
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    NAME_ENTRY: {
      after: { nameEntryTimeout: { target: 'RESETTING', actions: 'endTimeout' } },
      on: {
        ACTIVITY: { target: 'NAME_ENTRY', reenter: true },
        CONFIRM_NAMES: { guard: 'namesComplete', target: 'CALIBRATION', actions: 'setPlayers' },
        BACK: 'CHARACTER_SELECT',
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    CALIBRATION: {
      after: { calibrationTimeout: { target: 'RESETTING', actions: 'endTimeout' } },
      on: {
        CALIBRATED: { guard: 'isCurrentSession', target: 'TUTORIAL' },
        SKIP_CALIBRATION: 'TUTORIAL',
        DANCE_ANYWAY: { guard: 'isCurrentSession', target: 'TUTORIAL' },
        CALIBRATION_ABANDONED: { guard: 'isCurrentSession', target: 'RESETTING', actions: 'endTimeout' },
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    TUTORIAL: {
      after: { tutorial: 'COUNTDOWN' },
      on: {
        SKIP: 'COUNTDOWN',
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    COUNTDOWN: {
      after: { countdown: 'PLAYING' },
      on: {
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    PLAYING: {
      entry: 'clearPause',
      on: {
        SONG_ENDED: { guard: 'isCurrentSession', target: 'RESULTS', actions: 'endCompleted' },
        TRACKING_LOST: { guard: 'isCurrentSession', target: 'PAUSED', actions: 'markTrackingPause' },
        PAUSE: { target: 'PAUSED', actions: 'markOperatorPause' },
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    PAUSED: {
      after: { pausedAbort: { target: 'RESETTING', actions: 'endTimeout' } },
      on: {
        RESUME: 'PLAYING',
        ABORT: { target: 'RESETTING', actions: 'endAborted' },
      },
    },
    RESULTS: {
      after: { results: 'RESETTING' },
      on: {
        CONTINUE: 'RESETTING',
        PLAY_AGAIN: { target: 'RESETTING', actions: 'saveRematch' },
        ABORT: 'RESETTING',
      },
    },
    RESETTING: {
      entry: 'clearParticipant',
      after: {
        resetWatchdog: {
          target: 'RECOVERABLE_ERROR',
          actions: assign({
            error: { code: 'UNKNOWN', message: 'Reset did not complete in time', recoverable: true },
          }),
        },
      },
      on: {
        RESET_DONE: [
          // "Play again": a NEW session (new id) with the same choices, straight to calibration.
          { guard: 'hasRematch', target: 'CALIBRATION', actions: ['beginSession', 'applyRematch'] },
          { target: 'ATTRACT' },
        ],
      },
    },
    RECOVERABLE_ERROR: {
      entry: ['clearParticipant', 'clearRematch'],
      after: {
        recoveryDelay: [
          { guard: 'canAutoRecover', target: 'RESETTING', actions: 'countRecovery' },
          { target: 'MAINTENANCE' },
        ],
      },
      on: {
        RETRY: { target: 'RESETTING', actions: 'countRecovery' },
        ABORT: 'RESETTING',
      },
    },
    MAINTENANCE: {
      entry: ['clearParticipant', 'clearRematch'],
      on: {
        EXIT_MAINTENANCE: { target: 'SELF_CHECK', actions: 'clearRecovery' },
        ERROR: { actions: 'recordError' },
        ENTER_MAINTENANCE: {},
      },
    },
  },
});

function defaultPlayers(mode: SessionMode): PlayerSelection[] {
  const players: PlayerSelection[] = [{ slot: 1, characterId: '', paletteId: '' }];
  if (mode === 'duo') players.push({ slot: 2, characterId: '', paletteId: '' });
  return players;
}

export type SessionMachine = typeof sessionMachine;
