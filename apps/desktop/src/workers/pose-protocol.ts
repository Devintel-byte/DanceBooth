/**
 * Duo split mode: the frame is cut at a split line between the two players
 * (starting at the centre, then following the midpoint between them), and
 * each side, extended past the line by this much (normalised width), goes to
 * its own landmarker. Measured best between 0.03 and 0.06; 0.1 already lets
 * a landmarker latch onto the neighbour when players stand close.
 */
export const DUO_SPLIT_OVERLAP = 0.045;

/** Messages between the participant renderer and the pose worker. */
export type WorkerRequest =
  | {
      type: 'init';
      wasmBaseUrl: string;
      modelUrl: string;
      delegate: 'GPU' | 'CPU';
      numPoses: number;
      /** Duo: one landmarker per half of the frame instead of one landmarker for two people. */
      duoSplit: boolean;
      minPoseDetectionConfidence: number;
      minPosePresenceConfidence: number;
      minTrackingConfidence: number;
    }
  | { type: 'configure'; numPoses: number; duoSplit: boolean }
  | { type: 'frame'; generation: number; frameId: number; timestampMs: number; bitmap: ImageBitmap }
  | { type: 'close' };

export type WorkerResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; initMs: number; fallbackReason: string | null }
  | { type: 'error'; code: 'MODEL_MISSING' | 'MODEL_INIT_FAILED'; message: string }
  | {
      type: 'result';
      generation: number;
      frameId: number;
      inferenceMs: number;
      width: number;
      height: number;
      bodyCount: number;
      /** [x, y, z, visibility] * 33 per body, image-normalized. */
      image: Float32Array;
      /** [x, y, z, visibility] * 33 per body, world-meters. */
      world: Float32Array;
      /** APPEARANCE_BINS clothing-colour histogram per body; NaN in the first bin when not measurable. */
      appearance: Float32Array;
    }
  | { type: 'skipped'; generation: number; frameId: number; reason: string }
  | { type: 'frame-error'; generation: number; frameId: number; message: string }
  | { type: 'closed' };
