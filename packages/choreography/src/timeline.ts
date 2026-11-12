/**
 * Song timeline driven by an authoritative audio clock.
 *
 * All song-time consumers (instructor animation, scoring windows, beat cues,
 * stage effects, progress UI) read `songTimeSec()` from one `SongTimeline`.
 * Song time is derived from the audio clock, never accumulated from
 * render-frame deltas, so it cannot drift from what the participant hears.
 */
export interface AudioClock {
  /** Seconds, monotonic while the context runs (AudioContext.currentTime). */
  readonly currentTime: number;
}

export type TimelineState = 'idle' | 'scheduled' | 'playing' | 'paused' | 'ended';

export interface TimelineOptions {
  durationSec: number;
  /** Positive values shift judging/visuals later relative to audio (output latency compensation). */
  calibrationOffsetMs?: number;
}

export class SongTimeline {
  private state: TimelineState = 'idle';
  /** Audio-clock time at which song position 0 plays (valid while scheduled/playing). */
  private startAt = 0;
  /** Song position held while paused/idle. */
  private heldPosition = 0;
  private readonly durationSec: number;
  private readonly calibrationSec: number;

  constructor(
    private readonly clock: AudioClock,
    opts: TimelineOptions,
  ) {
    this.durationSec = opts.durationSec;
    this.calibrationSec = (opts.calibrationOffsetMs ?? 0) / 1000;
  }

  get status(): TimelineState {
    return this.state;
  }

  get duration(): number {
    return this.durationSec;
  }

  /**
   * Schedules playback so song position `fromSec` plays at audio time `atAudioTime`.
   * Returns the audio-clock time to pass to `AudioBufferSourceNode.start(when, offset)`.
   */
  schedule(atAudioTime: number, fromSec = 0): { when: number; offset: number } {
    if (this.state === 'playing' || this.state === 'scheduled') {
      throw new Error(`cannot schedule while ${this.state}`);
    }
    const when = Math.max(atAudioTime, this.clock.currentTime);
    this.startAt = when - fromSec;
    this.heldPosition = fromSec;
    this.state = 'scheduled';
    return { when, offset: fromSec };
  }

  /** Raw song position heard by the participant (may be negative during a scheduled lead-in). */
  audioPositionSec(): number {
    switch (this.state) {
      case 'scheduled':
      case 'playing': {
        const pos = this.clock.currentTime - this.startAt;
        if (this.state === 'scheduled' && pos >= this.heldPosition) this.state = 'playing';
        if (pos >= this.durationSec) {
          this.state = 'ended';
          this.heldPosition = this.durationSec;
          return this.durationSec;
        }
        return pos;
      }
      default:
        return this.heldPosition;
    }
  }

  /** Song time used for visuals and judging: audio position minus calibration offset. */
  songTimeSec(): number {
    return this.audioPositionSec() - this.calibrationSec;
  }

  /**
   * Converts a timestamp on the audio clock to song time (for captured camera
   * frames, after mapping their capture time onto the audio clock).
   */
  songTimeAtAudioTime(audioTime: number): number {
    if (this.state === 'scheduled' || this.state === 'playing') {
      return audioTime - this.startAt - this.calibrationSec;
    }
    return this.heldPosition - this.calibrationSec;
  }

  /** Pauses and returns the song position to resume from. */
  pause(): number {
    if (this.state !== 'playing' && this.state !== 'scheduled') return this.heldPosition;
    this.heldPosition = Math.max(0, Math.min(this.durationSec, this.clock.currentTime - this.startAt));
    this.state = 'paused';
    return this.heldPosition;
  }

  /** Position playback should resume from after a pause. */
  get resumePosition(): number {
    return this.heldPosition;
  }

  stop(): void {
    this.state = 'idle';
    this.heldPosition = 0;
    this.startAt = 0;
  }

  get ended(): boolean {
    if (this.state === 'playing' || this.state === 'scheduled') this.audioPositionSec();
    return this.state === 'ended';
  }

  progress(): number {
    return Math.max(0, Math.min(1, this.audioPositionSec() / this.durationSec));
  }
}

/**
 * Maps `performance.now()` timestamps (camera capture times) onto the audio
 * clock. `AudioContext.getOutputTimestamp()` gives a matching pair of
 * (contextTime, performanceTime) samples; we keep the latest pair.
 */
export class ClockMapper {
  private contextTime = 0;
  private performanceTime = 0;
  private valid = false;

  update(sample: { contextTime?: number; performanceTime?: number }): void {
    if (sample.contextTime === undefined || sample.performanceTime === undefined) return;
    if (!Number.isFinite(sample.contextTime) || !Number.isFinite(sample.performanceTime)) return;
    this.contextTime = sample.contextTime;
    this.performanceTime = sample.performanceTime;
    this.valid = true;
  }

  get isValid(): boolean {
    return this.valid;
  }

  /** Audio-clock seconds corresponding to a `performance.now()` timestamp in ms. */
  toAudioTime(performanceMs: number): number {
    return this.contextTime + (performanceMs - this.performanceTime) / 1000;
  }
}
