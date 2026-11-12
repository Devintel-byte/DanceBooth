import { createActor, type ActorRefFrom } from 'xstate';
import {
  boothError,
  replayFixtureSchema,
  type BoothError,
  type BoothSettings,
  type BootstrapData,
  type Landmark,
  type OperatorCommand,
  type ParticipantStatus,
  type PlayerSlotState,
  type RoutineManifest,
  type TrackingFrame,
  type TrackingProviderStatus,
} from '@booth/contracts';
import { ClockMapper, REST_POSE, SongTimeline, beatAt, danceCount, nextMoveIndex, pickDance, withDance, type FullPose } from '@booth/choreography';
import { RollingStats } from '@booth/diagnostics';
import {
  DIFFICULTY_PRESETS,
  PlayerScorer,
  extractPose,
  type FeedbackCategory,
  type ScoreSummary,
} from '@booth/scoring';
import { sessionMachine, type SessionEvent, type SessionStateName } from '@booth/session';
import {
  CalibrationHold,
  PlayerAssigner,
  ReplayTrackingProvider,
  TrackingLossMonitor,
  evaluateFraming,
  DEFAULT_ASSIGNMENT,
  type SlotCalibration,
  LandmarkSmoother,
  blendAppearance,
} from '@booth/tracking';
import { booth, log } from '../../shared/booth';
import { AudioEngine, isBoothError } from './audio-engine';
import { WebcamPoseProvider, listCameras, type CameraInfo } from './webcam-provider';
import { CUE_NOTES, type UiCue } from '../ui/ui-sounds';

export type InputSource = 'webcam' | 'replay' | 'none';

export interface PlayerView {
  slot: 1 | 2;
  status: PlayerSlotState['status'];
  confidence: number;
  points: number;
  percent: number;
  lastFeedback: FeedbackCategory | null;
  /** Points for the last judged move (0..100 = how closely it was matched), null if not judged. */
  lastMovePoints: number | null;
  feedbackSeq: number;
  prompt: boolean;
  characterId: string;
  paletteId: string;
  name: string | null;
  playerId: string | null;
  /** Duo: identity locked to the player's outfit at calibration. */
  locked: boolean;
}

/** Low-rate, immutable snapshot for React. */
export interface UiSnapshot {
  state: SessionStateName;
  sessionId: number;
  mode: 'single' | 'duo';
  routine: RoutineManifest | null;
  difficulty: string;
  songTimeSec: number | null;
  countdown: number | null;
  progress: number;
  nextMoveLabel: string | null;
  players: PlayerView[];
  calibration: SlotCalibration[];
  calibrationProgress: number;
  /** Calibration is taking a while: offer "Press START to dance anyway". */
  calibrationHelp: boolean;
  /** Nobody in view during calibration: seconds until it returns to the start, else null. */
  calibrationLeavingIn: number | null;
  results: { slot: 1 | 2; summary: ScoreSummary }[];
  inputSource: InputSource;
  trackingStatus: TrackingProviderStatus;
  error: BoothError | null;
  pauseReason: string | null;
  reducedMotion: boolean;
  showPerf: boolean;
  liveAvatar: boolean;
  quality: BoothSettings['quality'];
  maxRenderFps: number;
  /** Seconds until RESULTS resets automatically, else null. */
  resultsSecondsLeft: number | null;
  /** Today's leaderboard rank per slot for this session (real live results only). */
  placements: { slot: 1 | 2; rank: number; of: number }[];
  perf: PerfView;
}

export interface PerfView {
  fps: number;
  frameMsP50: number | null;
  frameMsP95: number | null;
  frameMsP99: number | null;
  inferenceMs: number | null;
  trackingHz: number;
  resultAgeMs: number | null;
  inFlight: number;
  droppedBusy: number;
  droppedStale: number;
  jsHeapMB: number | null;
  audioState: string;
}

/** Mutable per-frame state read by the 3D scene and canvases. Never put in React state. */
export interface FrameState {
  songTimeSec: number;
  /** Time used to drive the instructor animation: song time in a session, a demo loop otherwise. */
  animTimeSec: number;
  beatPhase: number;
  players: { slot: 1 | 2; tracked: boolean; landmarks: Landmark[] | null; pose: FullPose; hasPose: boolean; tag: string; locked: boolean }[];
  sourceAspect: number;
}

const SNAPSHOT_INTERVAL_MS = 100;
const STATUS_INTERVAL_MS = 250;

function clonePose(p: Readonly<FullPose>): FullPose {
  return { ...p };
}

export class BoothRuntime {
  readonly frame: FrameState = {
    songTimeSec: 0,
    animTimeSec: 0,
    beatPhase: 0,
    players: [],
    sourceAspect: 16 / 9,
  };

  private actor: ActorRefFrom<typeof sessionMachine>;
  private audio = new AudioEngine();
  private clockMap = new ClockMapper();
  private webcam: WebcamPoseProvider | null = null;
  private replay: ReplayTrackingProvider | null = null;
  private replayMode: 'free' | 'song' = 'free';
  private replayFreeStart = 0;
  private unsubscribeTracking: (() => void)[] = [];
  private trackingStatus: TrackingProviderStatus = { kind: 'idle' };
  private inputSource: InputSource = 'none';
  private useReplay: boolean;

  /** Per-slot landmark smoothing (jitter removal, visibility hysteresis). */
  private smoothers = new Map<1 | 2, LandmarkSmoother>([
    [1, new LandmarkSmoother()],
    [2, new LandmarkSmoother()],
  ]);
  private assigner = new PlayerAssigner({ ...DEFAULT_ASSIGNMENT, slots: 1, mirrorDisplay: true });
  private latestFrame: TrackingFrame | null = null;
  /** latestFrame.bodies with each assigned player's landmarks replaced by the smoothed ones. */
  private smoothedBodies: TrackingFrame['bodies'] = [];
  private allMissingSince: number | null = null;
  private calibrationHold = new CalibrationHold();
  /** Duo: each player's outfit signature, averaged while they stand ready in calibration. */
  private calibrationLooks = new Map<1 | 2, number[]>();
  private calibration: SlotCalibration[] = [];
  private calibrationProgress = 0;
  private calibrationEnteredAt = 0;
  private someoneSeenAt = 0;
  private lossMonitor: TrackingLossMonitor;

  // Session-scoped resources (created at COUNTDOWN, released by cleanupSession()).
  private timeline: SongTimeline | null = null;
  private scorers = new Map<1 | 2, PlayerScorer>();
  private feedback = new Map<1 | 2, { cat: FeedbackCategory; seq: number; points: number | null }>();
  /** Counts of real perfect/great judgements; characters celebrate when it changes. */
  private celebrations = new Map<1 | 2, number>();
  private results: { slot: 1 | 2; summary: ScoreSummary }[] = [];
  private sessionStartedAt: number | null = null;
  private resultsEnteredAt: number | null = null;
  private placements: { slot: 1 | 2; rank: number; of: number }[] = [];
  private recordSent = false;
  /** This session's dance: the selected routine with one of its variations in place. */
  private sessionDance: RoutineManifest | null = null;
  /** Last dance played per routine, so the next session gets a different one. */
  private lastDance = new Map<string, number>();
  private audioBuffer: AudioBuffer | null = null;

  private frameTimes = new RollingStats(240);
  /** Intervals between rendered 3D frames (may be capped below the display rate). */
  private sceneFrameTimes = new RollingStats(120);
  private lastSceneFrame = 0;
  private lastTick = 0;
  private raf = 0;
  private lastSnapshotAt = 0;
  private lastStatusAt = 0;
  private snapshot: UiSnapshot;
  private listeners = new Set<() => void>();
  private cameras: CameraInfo[] = [];
  private lastError: BoothError | null = null;
  private disposed = false;
  private prevState: SessionStateName = 'BOOT';

  constructor(
    private boot: BootstrapData,
    private settings: BoothSettings,
  ) {
    this.useReplay = boot.app.startInReplay;
    const rules = boot.profile.session;
    this.lossMonitor = new TrackingLossMonitor(rules.trackingLostGraceSec * 1000, rules.trackingLostPauseSec * 1000);
    this.actor = createActor(sessionMachine, {
      input: {
        rules,
        defaultRoutineId: boot.routines[0]?.id ?? null,
        defaultDifficulty: boot.profile.defaultDifficulty,
      },
    });
    this.snapshot = this.buildSnapshot();
    this.actor.subscribe((snap) => this.onStateChange(snap.value as SessionStateName));
  }

  // ---------- public API ----------

  start(): void {
    this.actor.start();
    this.raf = requestAnimationFrame(this.tick);
    navigator.mediaDevices?.addEventListener?.('devicechange', this.refreshCameras);
    this.send({ type: 'BOOTED' });
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): UiSnapshot => this.snapshot;

  send(event: SessionEvent): void {
    if (!this.disposed) this.actor.send(event);
  }

  playUiCue(cue: UiCue): void {
    this.audio.notes(CUE_NOTES[cue], this.settings.uiSoundVolume);
  }

  /** Records leaderboard placement for the current session from a board update. */
  setLeaderboard(board: { entries: { sessionId: number; slot: 1 | 2; rank: number }[] }): void {
    const sid = this.context.sessionId;
    this.placements = board.entries
      .filter((e) => e.sessionId === sid)
      .map((e) => ({ slot: e.slot, rank: e.rank, of: board.entries.length }));
    this.publish(true);
  }

  /** Called by the 3D scene once per rendered frame. */
  noteSceneFrame(now: number): void {
    if (this.lastSceneFrame > 0) this.sceneFrameTimes.push(now - this.lastSceneFrame);
    this.lastSceneFrame = now;
  }

  celebrationSeq(slot: 1 | 2): number {
    return this.celebrations.get(slot) ?? 0;
  }

  get state(): SessionStateName {
    return this.actor.getSnapshot().value as SessionStateName;
  }

  get context() {
    return this.actor.getSnapshot().context;
  }

  updateSettings(s: BoothSettings): void {
    const trackingChanged =
      JSON.stringify(s.tracking) !== JSON.stringify(this.settings.tracking) ||
      JSON.stringify(s.camera) !== JSON.stringify(this.settings.camera);
    this.settings = s;
    if (trackingChanged && !this.useReplay && this.isIdleState()) void this.restartTracking();
    this.publish(true);
  }

  /** Participant pressed START during calibration: allowed once the "dance anyway" offer is shown. */
  danceAnyway(): void {
    if (this.state !== 'CALIBRATION' || !this.calibrationHelpVisible(performance.now())) return;
    this.send({ type: 'DANCE_ANYWAY', sessionId: this.context.sessionId });
  }

  /** Participant picked a song at character select. */
  selectRoutine(routineId: string): void {
    if (this.state !== 'CHARACTER_SELECT' && this.state !== 'MODE_SELECT') return;
    if (!this.boot.routines.some((r) => r.id === routineId)) return;
    this.send({ type: 'SELECT_ROUTINE', routineId });
  }

  private calibrationHelpVisible(now: number): boolean {
    return this.state === 'CALIBRATION' && now - this.calibrationEnteredAt >= this.context.rules.calibrationHelpSec * 1000 && now - this.someoneSeenAt < 2000;
  }

  handleCommand(cmd: OperatorCommand): void {
    switch (cmd.type) {
      case 'start':
        if (this.state === 'ATTRACT') {
          this.send({ type: 'OPERATOR_START', mode: cmd.mode, ...(cmd.routineId ? { routineId: cmd.routineId } : {}), ...(cmd.difficulty ? { difficulty: cmd.difficulty } : {}) });
        }
        break;
      case 'select-routine':
        if (this.boot.routines.some((r) => r.id === cmd.routineId)) this.send({ type: 'SET_DEFAULT_ROUTINE', routineId: cmd.routineId });
        break;
      case 'pause':
        this.send({ type: 'PAUSE' });
        break;
      case 'resume':
        this.send({ type: 'RESUME' });
        break;
      case 'abort':
      case 'reset':
        this.send({ type: 'ABORT' });
        break;
      case 'enter-maintenance':
        this.send({ type: 'ENTER_MAINTENANCE' });
        break;
      case 'exit-maintenance':
        this.send({ type: 'EXIT_MAINTENANCE' });
        break;
      case 'skip-calibration':
        this.send({ type: 'SKIP_CALIBRATION' });
        break;
      case 'audio-test':
        void this.audio.ensureRunning().then(() => this.audio.testTone()).catch((e: unknown) => this.reportError(e));
        break;
      case 'restart-tracking':
        void this.restartTracking();
        break;
      case 'select-camera':
        // Settings are persisted by the operator console; restart picks up the new id.
        this.settings = { ...this.settings, camera: { ...this.settings.camera, deviceId: cmd.deviceId } };
        if (!this.useReplay) void this.restartTracking();
        break;
      case 'set-replay':
        this.useReplay = cmd.enabled;
        void this.restartTracking();
        break;
    }
    this.publish(true);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.refreshCameras);
    this.cleanupSession('aborted');
    await this.stopTracking();
    await this.audio.close();
    this.actor.stop();
    this.listeners.clear();
  }

  // ---------- tracking lifecycle ----------

  private isIdleState(): boolean {
    return ['ATTRACT', 'MAINTENANCE', 'SELF_CHECK', 'RECOVERABLE_ERROR', 'BOOT'].includes(this.state);
  }

  private async stopTracking(): Promise<void> {
    this.unsubscribeTracking.forEach((u) => u());
    this.unsubscribeTracking = [];
    const w = this.webcam;
    const r = this.replay;
    this.webcam = null;
    this.replay = null;
    await w?.stop();
    await r?.stop();
    this.latestFrame = null;
    this.inputSource = 'none';
    this.frame.players = [];
  }

  private trackingChain: Promise<void> = Promise.resolve();
  private queuedStart: Promise<void> | null = null;

  /**
   * Single-flight: one camera start at a time. Requests made while one is
   * running merge into one follow-up start, which reads the latest settings.
   * (Concurrent starts made a slow camera fight itself and froze the PC.)
   */
  private startTracking(): Promise<void> {
    if (this.queuedStart) return this.queuedStart;
    const run = this.trackingChain.then(() => {
      this.queuedStart = null;
      return this.startTrackingNow();
    });
    this.queuedStart = run;
    this.trackingChain = run.catch(() => undefined);
    return run;
  }

  private async startTrackingNow(): Promise<void> {
    await this.stopTracking();
    const numPoses = this.context.mode === 'duo' ? 2 : 1;
    if (this.useReplay) {
      const res = await fetch(`${this.boot.app.assetBaseUrl}${this.boot.app.replayFixture}`);
      if (!res.ok) throw boothError('CONTENT_MISSING', `replay fixture HTTP ${res.status}`, false);
      const fixture = replayFixtureSchema.parse(await res.json());
      const provider = new ReplayTrackingProvider(fixture);
      this.unsubscribeTracking.push(provider.onFrame(this.onTrackingFrame), provider.onStatus(this.onTrackingStatus));
      this.replay = provider;
      this.replayMode = 'free';
      this.replayFreeStart = performance.now();
      await provider.start();
      this.inputSource = 'replay';
      log('info', `tracking started: replay ${fixture.id} (${fixture.provenance.kind})`);
      return;
    }
    const provider = new WebcamPoseProvider({
      assetBaseUrl: this.boot.app.assetBaseUrl,
      camera: this.settings.camera,
      tracking: this.settings.tracking,
      numPoses,
      captureBackend: this.boot.app.captureBackend,
    });
    this.unsubscribeTracking.push(provider.onFrame(this.onTrackingFrame), provider.onStatus(this.onTrackingStatus));
    this.webcam = provider;
    await provider.start();
    this.inputSource = 'webcam';
    await this.refreshCameras();
    log('info', `tracking started: webcam ${provider.activeDeviceId ?? '?'}`);
  }

  private async restartTracking(): Promise<void> {
    try {
      await this.startTracking();
      this.lastError = null;
    } catch (e) {
      this.reportError(e, false);
    }
    this.publish(true);
  }

  private refreshCameras = async (): Promise<void> => {
    try {
      this.cameras = await listCameras();
    } catch {
      this.cameras = [];
    }
  };

  private onTrackingStatus = (s: TrackingProviderStatus): void => {
    this.trackingStatus = s;
    if (s.kind === 'error') {
      log('error', `tracking error ${s.code}: ${s.message}`, s.code);
      const err = boothError(s.code as BoothError['code'], s.message, true);
      this.lastError = err;
      // Loss of the camera/worker mid-session is a recoverable session error.
      if (!this.isIdleState()) this.send({ type: 'ERROR', error: err, sessionId: this.context.sessionId });
    }
    this.publish(true);
  };

  private onTrackingFrame = (frame: TrackingFrame): void => {
    const players = this.assigner.assign(frame.bodies, frame.captureTimestampMs);
    frame.players = players;
    // Duo calibration: learn each ready player's outfit; it is locked in when calibration completes.
    if (this.state === 'CALIBRATION' && this.context.mode === 'duo') {
      for (const p of players) {
        const look = p.bodyIndex !== null ? frame.bodies[p.bodyIndex]?.appearance : undefined;
        if (look && this.calibration.find((c) => c.slot === p.slot)?.ready) {
          this.calibrationLooks.set(p.slot, blendAppearance(this.calibrationLooks.get(p.slot) ?? null, look, 0.15));
        }
      }
    }
    this.latestFrame = frame;
    this.frame.sourceAspect = frame.sourceWidth / Math.max(1, frame.sourceHeight);

    const anyTracked = players.some((p) => p.status === 'tracked');
    if (anyTracked) this.allMissingSince = null;
    else this.allMissingSince ??= frame.captureTimestampMs;

    // Smoothed landmarks per slot: used for the overlay, the avatar and scoring alike.
    const smoothed = new Map<1 | 2, Landmark[]>();
    for (const p of players) {
      const body = p.bodyIndex !== null ? frame.bodies[p.bodyIndex] : undefined;
      if (body) smoothed.set(p.slot, this.smoothers.get(p.slot)!.filter(body.imageLandmarks, frame.captureTimestampMs));
      else if (p.status === 'empty') this.smoothers.get(p.slot)!.reset();
    }
    this.smoothedBodies = frame.bodies.map((b, i) => {
      const p = players.find((q) => q.bodyIndex === i);
      const lms = p ? smoothed.get(p.slot) : undefined;
      return lms ? { ...b, imageLandmarks: lms } : b;
    });
    const holdMs = this.boot.profile.session.trackingLostGraceSec * 1000;
    this.frame.players = players.map((p) => {
      const prev = this.frame.players.find((q) => q.slot === p.slot);
      const lms = smoothed.get(p.slot);
      const pose = prev?.pose ?? clonePose(REST_POSE);
      let hasPose = prev?.hasPose ?? false;
      if (lms) {
        // Avatar view: always mirror-image, independent of the routine's judging convention.
        const ex = extractPose(lms, 'mirror');
        for (const [seg, f] of Object.entries(ex.segments)) {
          pose[seg as keyof FullPose] = f.direction;
        }
        hasPose = true;
      }
      // A momentary miss keeps the last skeleton on screen (dimmed) instead of blinking out.
      const held = !lms && p.status === 'lost' && p.lostForMs <= holdMs ? (prev?.landmarks ?? null) : null;
      const sel = this.context.players.find((q) => q.slot === p.slot);
      const tag = `P${p.slot}${sel?.name ? ` · ${sel.name}` : ''}`;
      return { slot: p.slot, tracked: p.status === 'tracked', landmarks: lms ?? held, pose, hasPose, tag, locked: this.assigner.isLocked(p.slot) };
    });

    // Scoring: only while the song is actually playing.
    const tl = this.timeline;
    const routine = this.routine();
    if (this.state !== 'PLAYING' || !tl || !routine || tl.status !== 'playing') return;
    const calib = this.settings.calibrationOffsetMs / 1000;
    let songT: number;
    if (frame.mediaTimeSec !== null) {
      songT = frame.mediaTimeSec - calib;
    } else {
      if (!this.clockMap.isValid) return;
      songT = tl.songTimeAtAudioTime(this.clockMap.toAudioTime(frame.captureTimestampMs));
    }
    for (const p of players) {
      const scorer = this.scorers.get(p.slot);
      if (!scorer) continue;
      const lms = p.status === 'tracked' ? smoothed.get(p.slot) : undefined;
      // Use generation+frameId so frames from a restarted provider never collide.
      const key = frame.generation * 1e7 + frame.frameId;
      // Both readings of the same body: players may copy mirror-wise or same-side; the scorer keeps whichever they follow.
      const other = routine.mirroring === 'mirror' ? 'same-side' : 'mirror';
      scorer.addSample(key, songT, lms ? extractPose(lms, routine.mirroring) : null, lms ? extractPose(lms, other) : null);
    }
  };

  // ---------- session effects ----------

  private routine(): RoutineManifest | null {
    const id = this.context.routineId;
    if (this.sessionDance && this.sessionDance.id === id) return this.sessionDance;
    return this.boot.routines.find((r) => r.id === id) ?? null;
  }

  private onStateChange(next: SessionStateName): void {
    const prev = this.prevState;
    if (prev === next && next !== 'MODE_SELECT' && next !== 'CHARACTER_SELECT') {
      this.publish(true);
      return;
    }
    this.prevState = next;
    log('info', `session ${prev} -> ${next} (session ${this.context.sessionId})`);
    switch (next) {
      case 'SELF_CHECK':
        void this.runSelfCheck();
        break;
      case 'ATTRACT':
        if (!this.webcam && !this.replay) void this.restartTracking();
        break;
      case 'CALIBRATION': {
        const duo = this.context.mode === 'duo';
        this.assigner.configure({ slots: duo ? 2 : 1 });
        this.webcam?.setNumPoses(duo ? 2 : 1);
        this.calibrationHold.reset();
        this.calibrationProgress = 0;
        this.calibrationLooks.clear();
        this.calibrationEnteredAt = this.someoneSeenAt = performance.now();
        break;
      }
      case 'COUNTDOWN':
        void this.prepareSong();
        break;
      case 'PLAYING':
        if (prev === 'PAUSED') this.resumeSong();
        break;
      case 'PAUSED':
        this.timeline?.pause();
        this.audio.stop();
        break;
      case 'RESULTS':
        this.resultsEnteredAt = performance.now();
        this.finishSong();
        break;
      case 'RESETTING':
        this.cleanupSession(this.context.endReason === 'completed' ? 'completed' : this.context.endReason ?? 'aborted');
        queueMicrotask(() => this.send({ type: 'RESET_DONE' }));
        break;
      case 'RECOVERABLE_ERROR':
      case 'MAINTENANCE':
        this.cleanupSession('error');
        if (this.context.error) this.lastError = this.context.error;
        break;
    }
    this.publish(true);
  }

  private async runSelfCheck(): Promise<void> {
    const sessionAtStart = this.context.sessionId;
    try {
      if (this.boot.routines.length === 0) {
        throw boothError('CONTENT_INVALID', 'No valid routines are enabled for this event profile', false);
      }
      await this.audio.ensureRunning();
      for (const r of this.boot.routines) await this.audio.load(`${this.boot.app.assetBaseUrl}${r.audio.file}`);
      await this.startTracking();
      if (this.state === 'SELF_CHECK' && this.context.sessionId === sessionAtStart) {
        this.lastError = null;
        this.send({ type: 'SELF_CHECK_PASSED' });
      }
    } catch (e) {
      const err = isBoothError(e) ? e : boothError('UNKNOWN', String(e), false);
      this.lastError = err;
      log('error', `self-check failed ${err.code}: ${err.message}`, err.code);
      this.send({ type: 'SELF_CHECK_FAILED', error: err });
    }
  }

  private async prepareSong(): Promise<void> {
    const base = this.boot.routines.find((r) => r.id === this.context.routineId) ?? null;
    const sessionId = this.context.sessionId;
    if (!base) {
      this.send({ type: 'ERROR', error: boothError('CONTENT_MISSING', 'Selected routine is unavailable', true), sessionId });
      return;
    }
    // A different dance to the same song every session (never the last one played).
    // Replay/demo input performs the default dance, so the demo dances along with it.
    const dance = this.useReplay ? 0 : pickDance(danceCount(base), this.lastDance.get(base.id));
    this.lastDance.set(base.id, dance);
    this.sessionDance = withDance(base, dance);
    const routine = this.sessionDance;
    log('info', `routine ${base.id}: dance ${dance + 1} of ${danceCount(base)}`);
    try {
      await this.audio.ensureRunning();
      this.audioBuffer = await this.audio.load(`${this.boot.app.assetBaseUrl}${routine.audio.file}`);
    } catch (e) {
      this.send({ type: 'ERROR', error: isBoothError(e) ? e : boothError('AUDIO_LOAD_FAILED', String(e), true), sessionId });
      return;
    }
    // The session may have been aborted while loading.
    if (this.context.sessionId !== sessionId || this.state !== 'COUNTDOWN') return;
    const ctx = this.audio.context;
    const config = DIFFICULTY_PRESETS[this.context.difficulty];
    this.timeline = new SongTimeline(ctx, {
      durationSec: routine.durationSec,
      calibrationOffsetMs: this.settings.calibrationOffsetMs + routine.audio.offsetMs,
    });
    this.scorers.clear();
    this.feedback.clear();
    const slots: (1 | 2)[] = this.context.mode === 'duo' ? [1, 2] : [1];
    for (const s of slots) this.scorers.set(s, new PlayerScorer(routine, config));
    // Audio starts exactly when the countdown ends, on the audio clock.
    const lead = this.boot.profile.session.countdownSec;
    const { when, offset } = this.timeline.schedule(ctx.currentTime + lead, 0);
    this.audio.play(this.audioBuffer, when, offset);
    this.sessionStartedAt = performance.now();
    this.recordSent = false;
    if (this.replay) {
      this.replay.rewind();
      this.replayMode = 'song';
    }
  }

  private resumeSong(): void {
    const tl = this.timeline;
    if (!tl || !this.audioBuffer || tl.status !== 'paused') return;
    const ctx = this.audio.context;
    // Resume after a 1 s lead-in so the participant can get ready.
    const { when, offset } = tl.schedule(ctx.currentTime + 1, tl.resumePosition);
    this.audio.play(this.audioBuffer, when, offset);
  }

  private finishSong(): void {
    this.audio.stop();
    this.results = [...this.scorers.entries()].map(([slot, scorer]) => {
      scorer.finish();
      return { slot, summary: scorer.summary() };
    });
    this.sendRecord('completed');
  }

  private sendRecord(reason: 'completed' | 'aborted' | 'error' | 'timeout'): void {
    const routine = this.routine();
    if (this.recordSent || this.sessionStartedAt === null || !routine) return;
    this.recordSent = true;
    const scores = [...this.scorers.entries()].map(([slot, s]) => {
      const sum = s.summary();
      const playerId = this.context.players.find((p) => p.slot === slot)?.playerId;
      return {
        slot,
        ...(playerId ? { playerId } : {}),
        score: Math.round(sum.percent * 10) / 10,
        points: sum.points,
        judgedMoves: sum.judgedMoves,
        insufficientEvidence: sum.insufficientEvidence,
      };
    });
    try {
      booth().sendSessionRecord({
        sessionId: this.context.sessionId,
        routineId: routine.id,
        mode: this.context.mode,
        difficulty: this.context.difficulty,
        endedReason: reason,
        durationSec: (performance.now() - this.sessionStartedAt) / 1000,
        inputSource: this.inputSource === 'replay' ? 'replay' : 'webcam',
        scores,
      });
    } catch (e) {
      log('warn', `session record not sent: ${String(e)}`);
    }
  }

  /** Releases all session-scoped resources. Idempotent. */
  private cleanupSession(reason: 'completed' | 'aborted' | 'error' | 'timeout'): void {
    if (reason !== 'completed') this.sendRecord(reason);
    this.audio.stop();
    this.timeline?.stop();
    this.timeline = null;
    this.scorers.clear();
    this.feedback.clear();
    this.celebrations.clear();
    this.placements = [];
    this.resultsEnteredAt = null;
    this.audioBuffer = null;
    this.sessionStartedAt = null;
    this.sessionDance = null;
    this.calibrationHold.reset();
    this.calibration = [];
    this.calibrationProgress = 0;
    this.allMissingSince = null;
    if (this.state !== 'RESULTS') this.results = [];
    this.assigner.configure({ slots: 1 });
    this.webcam?.setNumPoses(1);
    if (this.replay) {
      this.replay.rewind();
      this.replayMode = 'free';
      this.replayFreeStart = performance.now();
    }
  }

  private reportError(e: unknown, toMachine = true): void {
    const err = isBoothError(e) ? e : boothError('UNKNOWN', String(e), true);
    this.lastError = err;
    log('error', `${err.code}: ${err.message}`, err.code);
    if (toMachine && !this.isIdleState()) this.send({ type: 'ERROR', error: err, sessionId: this.context.sessionId });
    this.publish(true);
  }

  // ---------- per-frame loop ----------

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.lastTick > 0) this.frameTimes.push(now - this.lastTick);
    this.lastTick = now;

    const ts = this.audio.outputTimestamp();
    if (ts) this.clockMap.update(ts);

    const state = this.state;
    const tl = this.timeline;

    // Replay input: free-running loop when idle, song-aligned during a song.
    if (this.replay) {
      if (this.replayMode === 'song' && tl) {
        this.replay.advanceTo(tl.audioPositionSec(), now);
      } else if (this.replayMode === 'free') {
        if (this.replay.finished) {
          this.replay.rewind();
          this.replayFreeStart = now;
        }
        this.replay.advanceTo((now - this.replayFreeStart) / 1000, now);
      }
    }

    // Instructor pose and beat come from the shared song timeline.
    const routine = this.routine();
    if (tl) {
      const t = tl.songTimeSec();
      this.frame.songTimeSec = t;
      this.frame.animTimeSec = t;
      this.frame.beatPhase = beatAt(t, routine?.bpm, routine?.firstBeatSec ?? 0)?.phase ?? 0;
    } else if (this.boot.routines[0]) {
      // Attract / menus: loop the chosen song's dance on the wall clock.
      const demo = routine ?? this.boot.routines.find((r) => r.id === this.context.defaultRoutineId) ?? this.boot.routines[0];
      const t = ((now / 1000) % (demo.durationSec - 2)) + 2;
      this.frame.songTimeSec = 0;
      this.frame.animTimeSec = t;
      this.frame.beatPhase = beatAt(t, demo.bpm, demo.firstBeatSec)?.phase ?? 0;
    }

    if (state === 'CALIBRATION') this.updateCalibration(now);

    if (state === 'PLAYING' && tl) {
      const songT = tl.songTimeSec();
      for (const [slot, scorer] of this.scorers) {
        for (const r of scorer.advance(songT)) {
          const prev = this.feedback.get(slot);
          this.feedback.set(slot, { cat: r.feedback, seq: (prev?.seq ?? 0) + 1, points: r.valid ? r.points : null });
          if (r.feedback === 'perfect' || r.feedback === 'great') {
            this.celebrations.set(slot, (this.celebrations.get(slot) ?? 0) + 1);
          }
        }
      }
      // Tracking loss: prompt after grace; pause if everyone is gone too long.
      const players = this.latestFrame?.players ?? [];
      const missingFor = this.allMissingSince !== null ? now - this.allMissingSince : 0;
      if (this.lossMonitor.evaluate(players, missingFor).shouldPause) {
        this.send({ type: 'TRACKING_LOST', sessionId: this.context.sessionId });
      }
      if (tl.ended) this.send({ type: 'SONG_ENDED', sessionId: this.context.sessionId });
    }

    this.publish(false, now);
  };

  private updateCalibration(now: number): void {
    const routine = this.routine();
    const frame = this.latestFrame;
    const players = frame?.players ?? [];
    this.calibration = evaluateFraming(frame ? this.smoothedBodies : [], players, routine?.requiredGroups ?? ['arms'], true);
    const expected = this.context.mode === 'duo' ? 2 : 1;
    const allReady = this.calibration.length === expected && this.calibration.every((c) => c.ready);
    const r = this.calibrationHold.update(allReady, now);
    this.calibrationProgress = r.progress;
    // Never give up on someone who is trying; only on an empty space (the guest left).
    if (frame && this.smoothedBodies.length > 0) this.someoneSeenAt = now;
    if (now - this.someoneSeenAt >= this.context.rules.calibrationAwaySec * 1000) {
      this.send({ type: 'CALIBRATION_ABANDONED', sessionId: this.context.sessionId });
      return;
    }
    if (r.complete) {
      // Lock each duo player's identity to their outfit, so collisions and crossings mid-dance cannot swap them.
      if (this.context.mode === 'duo') for (const [slot, look] of this.calibrationLooks) this.assigner.lockAppearance(slot, look);
      this.send({ type: 'CALIBRATED', sessionId: this.context.sessionId });
    }
  }

  // ---------- publishing ----------

  private perfView(now: number): PerfView {
    const t = this.webcam?.stats(now) ?? this.replay?.stats() ?? null;
    const mean = this.frameTimes.mean();
    const sceneMean = this.sceneFrameTimes.mean();
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return {
      // Rate of actually rendered 3D frames; falls back to the UI loop before the scene renders.
      fps: sceneMean ? 1000 / sceneMean : mean ? 1000 / mean : 0,
      frameMsP50: this.frameTimes.percentile(50),
      frameMsP95: this.frameTimes.percentile(95),
      frameMsP99: this.frameTimes.percentile(99),
      inferenceMs: t?.lastInferenceMs ?? null,
      trackingHz: t?.updateRateHz ?? 0,
      resultAgeMs: t?.latestResultAgeMs ?? null,
      inFlight: t?.inFlight ?? 0,
      droppedBusy: t?.framesDroppedBusy ?? 0,
      droppedStale: t?.framesDroppedStale ?? 0,
      jsHeapMB: mem ? mem.usedJSHeapSize / 1e6 : null,
      audioState: this.audio.state,
    };
  }

  private buildSnapshot(now = performance.now()): UiSnapshot {
    const ctx = this.actor.getSnapshot().context;
    const routine = this.routine();
    const tl = this.timeline;
    const songT = tl ? tl.songTimeSec() : null;
    const players: PlayerView[] = (ctx.mode === 'duo' ? [1, 2] : [1]).map((slot) => {
      const s = slot as 1 | 2;
      const tracked = this.latestFrame?.players.find((p) => p.slot === s);
      const scorer = this.scorers.get(s);
      const sum = scorer?.summary();
      const sel = ctx.players.find((p) => p.slot === s);
      const fb = this.feedback.get(s);
      const lostFor = tracked?.lostForMs ?? 0;
      return {
        slot: s,
        status: tracked?.status ?? 'empty',
        confidence: tracked?.confidence ?? 0,
        points: sum?.points ?? 0,
        percent: sum?.percent ?? 0,
        lastFeedback: fb?.cat ?? null,
        lastMovePoints: fb?.points ?? null,
        feedbackSeq: fb?.seq ?? 0,
        prompt: !!tracked && tracked.status !== 'tracked' && (tracked.status === 'empty' || lostFor >= ctx.rules.trackingLostGraceSec * 1000),
        characterId: sel?.characterId ?? '',
        name: sel?.name ?? null,
        playerId: sel?.playerId ?? null,
        paletteId: sel?.paletteId ?? '',
        locked: this.assigner.isLocked(s),
      };
    });
    const next = routine && songT !== null ? nextMoveIndex(routine.moves, songT) : -1;
    return {
      state: this.state,
      sessionId: ctx.sessionId,
      mode: ctx.mode,
      routine,
      difficulty: ctx.difficulty,
      songTimeSec: songT,
      countdown: songT !== null && songT < 0 ? Math.ceil(-songT) : null,
      progress: tl ? tl.progress() : 0,
      nextMoveLabel: next >= 0 ? (routine!.moves[next]!.label ?? null) : null,
      players,
      calibration: this.calibration,
      calibrationProgress: this.calibrationProgress,
      calibrationHelp: this.calibrationHelpVisible(now),
      calibrationLeavingIn:
        this.state === 'CALIBRATION' && now - this.someoneSeenAt > 5000
          ? Math.max(0, Math.ceil(this.context.rules.calibrationAwaySec - (now - this.someoneSeenAt) / 1000))
          : null,
      results: this.results,
      inputSource: this.inputSource,
      trackingStatus: this.trackingStatus,
      error: this.lastError ?? ctx.error,
      pauseReason: ctx.pauseReason,
      reducedMotion: this.settings.reducedMotion,
      showPerf: this.settings.showPerfOverlay,
      liveAvatar: this.settings.liveAvatar,
      quality: this.settings.quality,
      maxRenderFps: this.settings.maxRenderFps,
      resultsSecondsLeft:
        this.state === 'RESULTS' && this.resultsEnteredAt !== null
          ? Math.max(0, Math.ceil(ctx.rules.resultsDisplaySec - (now - this.resultsEnteredAt) / 1000))
          : null,
      placements: this.placements,
      perf: this.perfView(now),
    };
  }

  private publish(force: boolean, now = performance.now()): void {
    if (force || now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshotAt = now;
      this.snapshot = this.buildSnapshot(now);
      for (const l of this.listeners) l();
    }
    if (force || now - this.lastStatusAt >= STATUS_INTERVAL_MS) {
      this.lastStatusAt = now;
      this.sendStatus();
    }
  }

  private sendStatus(): void {
    const s = this.snapshot;
    const ts = this.trackingStatus;
    const status: ParticipantStatus = {
      state: s.state,
      sessionId: s.sessionId,
      mode: s.state === 'ATTRACT' ? null : s.mode,
      routineId: s.routine?.id ?? null,
      songTimeSec: s.songTimeSec,
      durationSec: s.routine?.durationSec ?? null,
      inputSource: s.inputSource,
      players: s.players.map((p) => ({ slot: p.slot, status: p.status, confidence: Math.min(1, Math.max(0, p.confidence)), score: p.percent, points: p.points })),
      tracking: {
        status: (ts.kind === 'running' ? ts.detail : ts.kind === 'error' ? `${ts.code}: ${ts.message}` : ts.kind).slice(0, 200),
        delegate: this.webcam?.stats(performance.now()).delegate ?? null,
        updateRateHz: s.perf.trackingHz,
        lastInferenceMs: s.perf.inferenceMs,
        latestResultAgeMs: s.perf.resultAgeMs,
        inFlight: s.perf.inFlight,
        framesDroppedBusy: s.perf.droppedBusy,
        framesDroppedStale: s.perf.droppedStale,
        framesCompleted: (this.webcam?.stats(performance.now()) ?? this.replay?.stats())?.framesCompleted ?? 0,
      },
      render: { fps: s.perf.fps, frameMsP50: s.perf.frameMsP50, frameMsP95: s.perf.frameMsP95, frameMsP99: s.perf.frameMsP99 },
      memory: { jsHeapUsedMB: s.perf.jsHeapMB },
      cameras: this.cameras.slice(0, 16),
      activeCameraId: this.webcam?.activeDeviceId ?? null,
      lastError: s.error,
    };
    try {
      booth().sendStatus(status);
    } catch {
      // bridge not available
    }
  }
}
