import { z } from 'zod';
import type { PlayerNumberLookup } from './player-numbers';
import type { CentralCandidate, CentralConfigPatch, CentralPlayersView, CentralStatus } from './central';
import {
  boothErrorSchema,
  boothSettingsSchema,
  characterCatalogSchema,
  difficultySchema,
  eventProfileSchema,
  qualityPresetSchema,
  routineManifestSchema,
  slugSchema,
} from './schemas';

/**
 * IPC channel names. Every channel has a fixed direction and a set of allowed
 * callers enforced in the main process. Payloads are validated with the
 * matching schema on receipt; renderer messages are untrusted.
 */
export const IPC = {
  /** renderer -> main (invoke). Returns `BootstrapData`. */
  getBootstrap: 'booth:get-bootstrap',
  /** operator -> main (invoke). Partial settings patch; returns updated settings. */
  updateSettings: 'booth:update-settings',
  /** operator -> main (send). Forwarded to the participant window. */
  operatorCommand: 'booth:operator-command',
  /** main -> participant (event). */
  participantCommand: 'booth:participant-command',
  /** participant -> main (send). Forwarded to the operator window. */
  participantStatus: 'booth:participant-status',
  /** main -> operator (event). */
  operatorStatus: 'booth:operator-status',
  /** main -> both renderers (event) after settings change. */
  settingsChanged: 'booth:settings-changed',
  /** renderer -> main (send). Structured log line. */
  log: 'booth:log',
  /** participant -> main (send). Anonymous session result record. */
  sessionRecord: 'booth:session-record',
  /** operator -> main (invoke). Writes a diagnostics bundle; returns its path. */
  exportDiagnostics: 'booth:export-diagnostics',
  /** operator -> main (invoke). Recent main-process error history. */
  getErrorHistory: 'booth:get-error-history',
  /** operator -> main (invoke). Reloads the participant window. */
  reloadParticipant: 'booth:reload-participant',
  /** participant -> main (invoke). Registers entered names; returns serial player ids. */
  registerPlayers: 'booth:register-players',
  /** operator -> main (invoke). Score feed status (port, addresses, clients). */
  getFeedStatus: 'booth:get-feed-status',
  /** operator -> main (invoke). Generates a new score-feed shared key. */
  regenerateFeedKey: 'booth:regenerate-feed-key',
  /** operator -> main (invoke). The score-feed shared key, only when the operator clicks Show or Copy. */
  revealFeedKey: 'booth:reveal-feed-key',
  /** operator -> main (invoke). Copies the shared key to the clipboard in the main process (the key does not pass through the console). */
  copyFeedKey: 'booth:copy-feed-key',
  /** operator -> main (invoke). Copies text (an address, the firewall command, the log) to the clipboard. */
  copyText: 'booth:copy-text',
  /** operator -> main (invoke). Main leaderboard connection log, newest first. */
  getFeedLog: 'booth:get-feed-log',
  /** main -> operator (event). A short notice about the main leaderboard connection. */
  feedToast: 'booth:feed-toast',
  /** participant -> main (invoke). Looks up ONE player number in the event's player list. */
  lookupPlayerNumber: 'booth:lookup-player-number',
  /** main -> operator (event). The player number being entered and who it belongs to, for the operator to check. */
  playerEntry: 'booth:player-entry',
  /** operator -> main (invoke). Clears today's leaderboard (names and scores) for the active event. */
  clearLeaderboard: 'booth:clear-leaderboard',
  /** participant|operator -> main (invoke). Opens or focuses the leaderboard window. */
  openLeaderboard: 'booth:open-leaderboard',
  /** any role -> main (invoke). Returns `Leaderboard`. */
  getLeaderboard: 'booth:get-leaderboard',
  /** main -> leaderboard|participant (event) when entries change. */
  leaderboardUpdated: 'booth:leaderboard-updated',
  /** leaderboard|operator -> main (invoke). Window placement controls. */
  leaderboardWindow: 'booth:leaderboard-window',
  /** leaderboard|operator -> main (invoke). Available displays. */
  listDisplays: 'booth:list-displays',
  // ---- central registry (event-results/1); operator only unless noted ----
  /** operator -> main (invoke). Returns CentralStatus (never the credential). */
  centralGetStatus: 'booth:central-status',
  /** main -> operator (event). CentralStatus changed. */
  centralStatusChanged: 'booth:central-status-changed',
  /** operator -> main (invoke). Patch the central configuration. */
  centralUpdateConfig: 'booth:central-update-config',
  /** operator -> main (invoke). Store (replace) the source credential; write-only. */
  centralSetCredential: 'booth:central-set-credential',
  /** operator -> main (invoke). Check URL, credential and manifest. */
  centralTestConnection: 'booth:central-test',
  /** operator -> main (invoke). Resolve a player number for a slot; returns a candidate to confirm. */
  centralResolve: 'booth:central-resolve',
  /** operator -> main (invoke). Confirm the slot's candidate as the official participant. */
  centralConfirm: 'booth:central-confirm',
  /** operator -> main (invoke). Clear a slot's official participant (and candidate). */
  centralClearSlot: 'booth:central-clear-slot',
  /** operator -> main (invoke). Retry blocked results (one or all). */
  centralRetry: 'booth:central-retry',
  /** operator -> main (invoke). Run reconciliation now. */
  centralReconcile: 'booth:central-reconcile',
  /** operator -> main (invoke). Void or correct a submitted result (new revision). */
  centralEditResult: 'booth:central-edit-result',
  /** operator -> main (invoke). Give an unresolved local result its participant (resolve + submit). */
  centralResolveUnresolved: 'booth:central-resolve-unresolved',
  /** participant -> main (invoke). Official player names for the current session. */
  centralGetPlayers: 'booth:central-get-players',
  /** main -> participant (event). Official player names changed. */
  centralPlayersChanged: 'booth:central-players-changed',
} as const;

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  /** Unique key: one row per player (their best performance today). */
  playerId: z.string(),
  name: z.string(),
  sessionId: z.number().int().nonnegative(),
  slot: z.union([z.literal(1), z.literal(2)]),
  /** Average match %, the ranking key. */
  score: z.number().min(0),
  points: z.number().int().nonnegative(),
  routineId: z.string(),
  routineTitle: z.string(),
  mode: z.enum(['single', 'duo']),
  at: z.string(),
  /** Played without a player number (not competing for the event prize). */
  guest: z.boolean().optional(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export interface Leaderboard {
  eventName: string;
  /** Local calendar day the board covers (YYYY-MM-DD). */
  day: string;
  entries: LeaderboardEntry[];
  /** Completed live (webcam) sessions counted today. Replay/demo sessions never count. */
  sessionsCounted: number;
}

export const leaderboardWindowCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fullscreen'), enabled: z.boolean() }),
  z.object({ type: z.literal('move-to-display'), displayId: z.number().int() }),
  z.object({ type: z.literal('close') }),
]);
export type LeaderboardWindowCommand = z.infer<typeof leaderboardWindowCommandSchema>;

/** Main leaderboard connection, as the operator console shows it. Never contains the shared key. */
export interface FeedStatusInfo {
  enabled: boolean;
  listening: boolean;
  port: number;
  boothId: string;
  /** off: disabled · waiting: listening, main leaderboard not connected · connected · problem (see `problem`). */
  state: 'off' | 'waiting' | 'connected' | 'problem';
  problem: string | null;
  /** The connected main leaderboard (client=leaderboardhq), if any. */
  mainLeaderboard: { ip: string; connectedAt: string } | null;
  /** Other connected clients ("scoreboard"). */
  scoreboards: { ip: string; connectedAt: string }[];
  /** What to type into the main leaderboard: `IP:port`, one per LAN address. */
  addresses: string[];
  hasKey: boolean;
  lastSessionSentAt: string | null;
  /** Player list received from the main leaderboard (null: never received). */
  playerList: { count: number; receivedAt: string; title: string | null } | null;
  /** One-time Windows firewall rule for the port (run in an Administrator PowerShell). */
  firewallCommand: string;
}

export interface FeedLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface FeedToast {
  level: 'good' | 'warn' | 'bad' | 'info';
  message: string;
}

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
  hostsLeaderboard: boolean;
}

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export const sessionModeSchema = z.enum(['single', 'duo']);
export type SessionMode = z.infer<typeof sessionModeSchema>;

export const operatorCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    mode: sessionModeSchema,
    routineId: slugSchema.optional(),
    difficulty: difficultySchema.optional(),
  }),
  /** The song new sessions start with (participants can still change it at character select). */
  z.object({ type: z.literal('select-routine'), routineId: slugSchema }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('abort') }),
  z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('enter-maintenance') }),
  z.object({ type: z.literal('exit-maintenance') }),
  z.object({ type: z.literal('select-camera'), deviceId: z.string().max(512) }),
  z.object({ type: z.literal('restart-tracking') }),
  z.object({ type: z.literal('audio-test') }),
  z.object({ type: z.literal('set-replay'), enabled: z.boolean() }),
  z.object({ type: z.literal('skip-calibration') }),
]);
export type OperatorCommand = z.infer<typeof operatorCommandSchema>;

const nullableNumber = z.number().finite().nullable();

export const participantStatusSchema = z.object({
  state: z.string().max(40),
  sessionId: z.number().int().nonnegative(),
  mode: sessionModeSchema.nullable(),
  routineId: z.string().max(64).nullable(),
  songTimeSec: nullableNumber,
  durationSec: nullableNumber,
  inputSource: z.enum(['webcam', 'replay', 'none']),
  players: z
    .array(
      z.object({
        slot: z.union([z.literal(1), z.literal(2)]),
        status: z.enum(['empty', 'tracked', 'lost']),
        confidence: z.number().min(0).max(1),
        score: z.number().min(0),
        points: z.number().int().nonnegative().default(0),
      }),
    )
    .max(2),
  tracking: z.object({
    status: z.string().max(200),
    delegate: z.enum(['CPU', 'GPU']).nullable(),
    updateRateHz: z.number().nonnegative(),
    lastInferenceMs: nullableNumber,
    latestResultAgeMs: nullableNumber,
    inFlight: z.number().int().nonnegative(),
    framesDroppedBusy: z.number().int().nonnegative(),
    framesDroppedStale: z.number().int().nonnegative(),
    framesCompleted: z.number().int().nonnegative(),
  }),
  render: z.object({
    fps: z.number().nonnegative(),
    frameMsP50: nullableNumber,
    frameMsP95: nullableNumber,
    frameMsP99: nullableNumber,
  }),
  memory: z.object({ jsHeapUsedMB: nullableNumber }),
  cameras: z.array(z.object({ deviceId: z.string().max(512), label: z.string().max(256) })).max(16),
  activeCameraId: z.string().max(512).nullable(),
  lastError: boothErrorSchema.nullable(),
});
export type ParticipantStatus = z.infer<typeof participantStatusSchema>;

export const logEntrySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string().max(2000),
  code: z.string().max(64).optional(),
  context: z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

/**
 * Display names: 1-16 characters of letters, digits, spaces, . ' -
 * (any script). Trimmed and whitespace-collapsed before use.
 */
export const playerNameSchema = z
  .string()
  .transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Enter a name').max(16, 'Use 16 characters or fewer').regex(/^[\p{L}\p{N} .'-]+$/u, 'Use letters and numbers only'));

/** Serial player id, unique within an event on this booth, e.g. player-001. */
export const playerIdSchema = z.string().regex(/^player-\d{3,6}$/);

/** Player number as typed: 4 digits (spaces and dashes ignored), kept as text. */
export const playerNumberInputSchema = z.string().trim().min(1).max(16);

/**
 * One entry per player slot. `name` is required for guests and for numbers the
 * booth does not recognise; for a recognised number the main process uses the
 * registered name instead.
 */
export const registerPlayersSchema = z.object({
  players: z
    .array(
      z.object({
        name: z.string().max(200).optional(),
        number: playerNumberInputSchema.optional(),
      }),
    )
    .min(1)
    .max(2),
});
export const lookupPlayerNumberSchema = z.object({ slot: z.union([z.literal(1), z.literal(2)]), number: z.string().max(16) });

/** What the operator sees while a player enters their number (the public screen never shows the number). */
export type PlayerEntryView =
  | { slot: 1 | 2; number: string; status: PlayerNumberLookup['status']; name: string | null }
  | { slot: 1 | 2; number: null; status: 'none'; name: null };
export interface RegisteredPlayer {
  playerId: string;
  name: string;
  /** The 4-digit player number, when one was given. */
  number?: string;
  /** The number was found in the event's player list. */
  numberRecognised?: boolean;
}

export const sessionRecordSchema = z.object({
  sessionId: z.number().int().nonnegative(),
  routineId: z.string().max(64),
  mode: sessionModeSchema,
  difficulty: difficultySchema,
  endedReason: z.enum(['completed', 'aborted', 'error', 'timeout']),
  durationSec: z.number().nonnegative(),
  inputSource: z.enum(['webcam', 'replay']),
  scores: z
    .array(
      z.object({
        slot: z.union([z.literal(1), z.literal(2)]),
        /** Registered player; the main process checks it exists before storing. */
        playerId: playerIdSchema.optional(),
        score: z.number().min(0),
        points: z.number().int().nonnegative().optional(),
        judgedMoves: z.number().int().nonnegative(),
        insufficientEvidence: z.number().int().nonnegative(),
      }),
    )
    .max(2),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const settingsPatchSchema = z
  .object({
    activeProfileId: slugSchema,
    camera: boothSettingsSchema.shape.camera.unwrap().partial(),
    tracking: boothSettingsSchema.shape.tracking.unwrap().partial(),
    calibrationOffsetMs: z.number().min(-500).max(500),
    quality: qualityPresetSchema,
    showPerfOverlay: z.boolean(),
    reducedMotion: z.boolean(),
    liveAvatar: z.boolean(),
    uiSoundVolume: z.number().min(0).max(1),
    maxRenderFps: z.number().int().min(0).max(144),
    kiosk: z.boolean(),
    scoreFeed: z
      .object({
        enabled: z.boolean(),
        port: z.number().int().min(1024).max(65535),
        boothId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const bootstrapDataSchema = z.object({
  app: z.object({
    version: z.string(),
    isPackaged: z.boolean(),
    devTools: z.boolean(),
    /** Base URL for content assets served by the app's custom protocol. */
    assetBaseUrl: z.string(),
    /** Start with deterministic replay input instead of the webcam (dev/E2E only). */
    startInReplay: z.boolean(),
    /** Asset path of the replay fixture used in replay mode. */
    replayFixture: z.string(),
    /** Windows camera path this run uses (fixed at startup). */
    captureBackend: z.enum(['media-foundation', 'directshow']).default('media-foundation'),
  }),
  settings: boothSettingsSchema,
  profile: eventProfileSchema,
  profiles: z.array(z.object({ id: z.string(), eventName: z.string() })),
  routines: z.array(routineManifestSchema),
  characters: characterCatalogSchema,
  /** Content problems found at startup; sessions are blocked for invalid routines. */
  contentIssues: z.array(z.object({ file: z.string(), message: z.string() })),
});
export type BootstrapData = z.infer<typeof bootstrapDataSchema>;

/** The API exposed on `window.booth` by the preload script. */
export interface BoothBridge {
  role: 'participant' | 'operator' | 'leaderboard';
  getBootstrap(): Promise<BootstrapData>;
  log(entry: LogEntry): void;
  // participant
  sendStatus(status: ParticipantStatus): void;
  sendSessionRecord(record: SessionRecord): void;
  onCommand(listener: (command: OperatorCommand) => void): () => void;
  // operator
  sendCommand(command: OperatorCommand): void;
  updateSettings(patch: SettingsPatch): Promise<z.infer<typeof boothSettingsSchema>>;
  exportDiagnostics(): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  getErrorHistory(): Promise<{ at: string; code: string; message: string }[]>;
  reloadParticipant(): Promise<void>;
  onStatus(listener: (status: ParticipantStatus) => void): () => void;
  // shared
  onSettingsChanged(listener: (settings: z.infer<typeof boothSettingsSchema>) => void): () => void;
  openLeaderboard(): Promise<void>;
  getLeaderboard(): Promise<Leaderboard>;
  onLeaderboardUpdated(listener: (board: Leaderboard) => void): () => void;
  // participant: names (+ player numbers) -> serial ids
  registerPlayers(players: { name?: string; number?: string }[]): Promise<RegisteredPlayer[]>;
  /** Looks up a typed number (send an empty string to clear the operator's view for that slot). */
  lookupPlayerNumber(slot: 1 | 2, number: string): Promise<PlayerNumberLookup>;
  // operator: player entry check
  onPlayerEntry(listener: (entry: PlayerEntryView) => void): () => void;
  // operator: score feed + leaderboard maintenance
  getFeedStatus(): Promise<FeedStatusInfo>;
  regenerateFeedKey(): Promise<FeedStatusInfo>;
  revealFeedKey(): Promise<string | null>;
  copyFeedKey(): Promise<boolean>;
  copyText(text: string): Promise<void>;
  getFeedLog(): Promise<FeedLogEntry[]>;
  onFeedToast(listener: (toast: FeedToast) => void): () => void;
  clearLeaderboard(): Promise<void>;
  // leaderboard + operator
  leaderboardWindow(command: LeaderboardWindowCommand): Promise<void>;
  listDisplays(): Promise<DisplayInfo[]>;
  // central registry (operator)
  centralGetStatus(): Promise<CentralStatus>;
  onCentralStatus(listener: (status: CentralStatus) => void): () => void;
  centralUpdateConfig(patch: CentralConfigPatch): Promise<CentralStatus>;
  centralSetCredential(credential: string): Promise<CentralStatus>;
  centralTestConnection(): Promise<{ ok: boolean; message: string }>;
  centralResolve(slot: 1 | 2, code: string): Promise<{ ok: true; candidate: CentralCandidate } | { ok: false; error: string }>;
  centralConfirm(slot: 1 | 2): Promise<{ ok: true } | { ok: false; error: string }>;
  centralClearSlot(slot: 1 | 2): Promise<void>;
  centralRetry(resultId?: string): Promise<void>;
  centralReconcile(): Promise<{ ok: boolean; message: string }>;
  centralEditResult(edit: { kind: 'void'; resultId: string } | { kind: 'correct'; resultId: string; points: number }): Promise<{ ok: true } | { ok: false; error: string }>;
  centralResolveUnresolved(resultId: string, code: string): Promise<{ ok: true; displayName: string } | { ok: false; error: string }>;
  // central registry (participant)
  centralGetPlayers(): Promise<CentralPlayersView>;
  onCentralPlayers(listener: (view: CentralPlayersView) => void): () => void;
}
