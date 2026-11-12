import type { CoordinateSpace, Landmark } from './landmarks';

export type TrackingSourceKind = 'webcam-mediapipe' | 'replay';

export interface DetectedBody {
  /** Index in the provider's result list. NOT a stable identity. */
  detectionIndex: number;
  /** 33 landmarks in `image-normalized` space. */
  imageLandmarks: Landmark[];
  /** Optional 33 landmarks in `world-meters` space. */
  worldLandmarks?: Landmark[];
  /** Optional clothing colour histogram (see @booth/tracking appearance.ts); used to keep duo identities apart. */
  appearance?: number[];
}

export type PlayerSlotId = 1 | 2;

export type PlayerSlotStatus = 'empty' | 'tracked' | 'lost';

export interface PlayerSlotState {
  slot: PlayerSlotId;
  status: PlayerSlotStatus;
  /** Index into `TrackingFrame.bodies` when tracked in this frame. */
  bodyIndex: number | null;
  /** Mean visibility of the core joints for the assigned body, 0..1. */
  confidence: number;
  /** Milliseconds since the slot was last tracked; 0 while tracked. */
  lostForMs: number;
  /** Last known hip-centre x in display space (mirrored when the display is mirrored), 0..1. */
  lastX: number | null;
}

/**
 * Canonical tracking result. One per processed camera/replay frame.
 * Timestamps share the participant renderer's `performance.now()` clock.
 */
export interface TrackingFrame {
  /** Tracking generation; frames from older generations must be discarded. */
  generation: number;
  frameId: number;
  source: TrackingSourceKind;
  /** When the frame was captured (or the replay timestamp mapped onto the live clock). */
  captureTimestampMs: number;
  /** When the result became available to the consumer. */
  resultTimestampMs: number;
  /** Measured inference duration, when the provider can measure it. */
  inferenceMs: number | null;
  /**
   * For replay sources: the fixture time of this frame relative to replay start
   * (replay is aligned to song position 0). Null for live sources.
   */
  mediaTimeSec: number | null;
  sourceWidth: number;
  sourceHeight: number;
  coordinateSpace: CoordinateSpace;
  bodies: DetectedBody[];
  /** Filled in by player assignment; empty straight out of a provider. */
  players: PlayerSlotState[];
}

export interface TrackingStats {
  framesSubmitted: number;
  framesCompleted: number;
  framesDroppedBusy: number;
  framesDroppedStale: number;
  inFlight: number;
  lastInferenceMs: number | null;
  /** Completed results per second over the recent window. */
  updateRateHz: number;
  /** resultTimestamp - captureTimestamp for the latest frame (an estimate; see docs). */
  latestResultAgeMs: number | null;
  delegate: 'CPU' | 'GPU' | null;
}

export type TrackingProviderStatus =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; detail: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'stopped' };

export function emptyTrackingStats(): TrackingStats {
  return {
    framesSubmitted: 0,
    framesCompleted: 0,
    framesDroppedBusy: 0,
    framesDroppedStale: 0,
    inFlight: 0,
    lastInferenceMs: null,
    updateRateHz: 0,
    latestResultAgeMs: null,
    delegate: null,
  };
}
