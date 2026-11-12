/// <reference lib="webworker" />
/**
 * Pose inference worker (module worker).
 *
 * Receives ImageBitmaps transferred from the participant renderer, runs
 * MediaPipe Pose Landmarker in VIDEO mode, and posts compact results back.
 * Every received bitmap is closed exactly once, including on error paths.
 * The worker never queues frames: the renderer's FrameGate bounds in-flight
 * work, so at most `maxInFlight` bitmaps can be waiting here.
 *
 * Duo "split" mode: instead of asking one landmarker for two people in the
 * whole frame (which merges them, or finds only one, when they stand close
 * together), the frame is cut at a split line between the players and each
 * side (plus a small overlap) goes to its own landmarker looking for one
 * person; a person whose torso is on the wrong side of the line is ignored.
 * The line follows the midpoint between the two players. Each person is also
 * larger in the model input, which improves hands and feet. Results are
 * mapped back to full-frame coordinates.
 *
 * Measured on rendered pairs of Mixamo dancers standing 0.45 / 0.6 / 0.8 / 1.0 m
 * apart (16 poses each, lite model): both players found with the whole frame
 * in 8, 2, 3, 5 of 16; with the split in 16 of 16 at every spacing, with
 * about half the joint error.
 */
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { APPEARANCE_BINS, appearanceSignature } from '@booth/tracking';
import { DUO_SPLIT_OVERLAP, type WorkerRequest, type WorkerResponse } from './pose-protocol';

declare const self: DedicatedWorkerGlobalScope;

type InitRequest = Extract<WorkerRequest, { type: 'init' }>;

interface Slot {
  landmarker: PoseLandmarker;
  lastTimestamp: number;
}

let primary: Slot | null = null;
/** Second landmarker for the right half in duo split mode (created on first use). */
let secondary: Slot | null = null;
let secondaryPending: Promise<void> | null = null;
let initReq: InitRequest | null = null;
let activeDelegate: 'GPU' | 'CPU' = 'CPU';
let numPoses = 1;
let duoSplit = true;
let primaryPoses = 1;
let initializing = false;
const canvases: OffscreenCanvas[] = [];

function post(msg: WorkerResponse): void {
  self.postMessage(msg);
}

/** MediaPipe's WASM module factory, kept so a second landmarker can be created in this worker. */
let wasmFactory: unknown = null;

async function createLandmarker(req: InitRequest, delegate: 'GPU' | 'CPU', poses: number) {
  // useModule=true: the module-worker loader variant (importScripts is unavailable in module workers).
  const fileset = await FilesetResolver.forVisionTasks(req.wasmBaseUrl, true);
  // MediaPipe reads globalThis.ModuleFactory (set when its loader module is first imported)
  // and then clears it, so a second landmarker would fail with "ModuleFactory not set".
  // Import the loader once, keep the factory, and hand it back before every creation.
  const g = globalThis as { ModuleFactory?: unknown };
  if (!wasmFactory) wasmFactory = ((await import(/* @vite-ignore */ fileset.wasmLoaderPath)) as { default: unknown }).default;
  g.ModuleFactory = wasmFactory;
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: req.modelUrl, delegate },
    runningMode: 'VIDEO',
    numPoses: poses,
    minPoseDetectionConfidence: req.minPoseDetectionConfidence,
    minPosePresenceConfidence: req.minPosePresenceConfidence,
    minTrackingConfidence: req.minTrackingConfidence,
    outputSegmentationMasks: false,
  });
}

const splitActive = () => numPoses === 2 && duoSplit;

/** Where the frame is cut between the two players in split mode (normalised x). */
let splitX = 0.5;

/** Poses per landmarker: one per side in split mode, otherwise the requested count. */
async function syncPrimaryPoses(): Promise<void> {
  const want = splitActive() ? 1 : numPoses;
  if (!primary || primaryPoses === want) return;
  primaryPoses = want;
  await primary.landmarker.setOptions({ numPoses: want });
}

function ensureSecondary(): void {
  if (secondary || secondaryPending || !initReq) return;
  const req = initReq;
  secondaryPending = createLandmarker(req, activeDelegate, 1)
    .then((l) => {
      secondary = { landmarker: l, lastTimestamp: -1 };
    })
    .catch((e: unknown) => post({ type: 'error', code: 'MODEL_INIT_FAILED', message: `second landmarker failed: ${String(e)}` }))
    .finally(() => {
      secondaryPending = null;
    });
}

async function init(req: InitRequest): Promise<void> {
  if (initializing) return;
  initializing = true;
  try {
    primary?.landmarker.close();
    secondary?.landmarker.close();
    primary = secondary = null;
    initReq = req;
    numPoses = req.numPoses;
    duoSplit = req.duoSplit;
    primaryPoses = splitActive() ? 1 : numPoses;
    splitX = 0.5;
    const t0 = performance.now();
    try {
      primary = { landmarker: await createLandmarker(req, req.delegate, primaryPoses), lastTimestamp: -1 };
      activeDelegate = req.delegate;
      post({ type: 'ready', delegate: req.delegate, initMs: performance.now() - t0, fallbackReason: null });
    } catch (e) {
      if (req.delegate !== 'GPU') throw e;
      // GPU delegate unavailable: fall back to CPU and REPORT it (never silent).
      const reason = e instanceof Error ? e.message : String(e);
      primary = { landmarker: await createLandmarker(req, 'CPU', primaryPoses), lastTimestamp: -1 };
      activeDelegate = 'CPU';
      post({ type: 'ready', delegate: 'CPU', initMs: performance.now() - t0, fallbackReason: `GPU delegate failed: ${reason}` });
    }
    if (splitActive()) ensureSecondary();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = /fetch|404|not found|Failed to load/i.test(message) ? 'MODEL_MISSING' : 'MODEL_INIT_FAILED';
    post({ type: 'error', code, message });
  } finally {
    initializing = false;
  }
}

function run(slot: Slot, source: TexImageSource, timestampMs: number): PoseLandmarkerResult {
  // VIDEO mode requires strictly increasing timestamps (ms) per landmarker.
  const ts = Math.max(Math.floor(timestampMs), slot.lastTimestamp + 1);
  slot.lastTimestamp = ts;
  return slot.landmarker.detectForVideo(source, ts);
}

/** Copies a horizontal band [x0, x1) of the frame into a reusable canvas. */
function crop(bitmap: ImageBitmap, index: number, x0: number, x1: number): OffscreenCanvas {
  const sx = Math.round(x0 * bitmap.width);
  const sw = Math.max(1, Math.round(x1 * bitmap.width) - sx);
  let c = canvases[index];
  if (!c || c.width !== sw || c.height !== bitmap.height) {
    c = new OffscreenCanvas(sw, bitmap.height);
    canvases[index] = c;
  }
  c.getContext('2d')!.drawImage(bitmap, sx, 0, sw, bitmap.height, 0, 0, sw, bitmap.height);
  return c;
}

interface Body {
  image: readonly { x: number; y: number; z: number; visibility?: number }[];
  world: readonly { x: number; y: number; z: number; visibility?: number }[] | undefined;
}

/** Mean x of shoulders and hips. */
function torsoX(lms: Body['image']): number {
  const pts = [11, 12, 23, 24].map((i) => lms[i]).filter((l) => !!l);
  return pts.length ? pts.reduce((a, l) => a + l!.x, 0) / pts.length : 0.5;
}

/** Small copy of the frame for sampling clothing colours (only histograms leave the worker). */
let sampler: OffscreenCanvas | null = null;
const SAMPLE_WIDTH = 192;

function appearanceOf(bitmap: ImageBitmap, bodies: readonly Body[]): Float32Array {
  const out = new Float32Array(bodies.length * APPEARANCE_BINS).fill(0);
  if (!bodies.length) return out;
  const h = Math.max(1, Math.round((SAMPLE_WIDTH * bitmap.height) / bitmap.width));
  if (!sampler || sampler.height !== h) sampler = new OffscreenCanvas(SAMPLE_WIDTH, h);
  const g = sampler.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, SAMPLE_WIDTH, h);
  const px = g.getImageData(0, 0, SAMPLE_WIDTH, h).data;
  bodies.forEach((b, i) => {
    const sig = appearanceSignature(px, SAMPLE_WIDTH, h, b.image as Parameters<typeof appearanceSignature>[3]);
    if (sig) out.set(sig, i * APPEARANCE_BINS);
    else out[i * APPEARANCE_BINS] = NaN;
  });
  return out;
}

function detect(req: Extract<WorkerRequest, { type: 'frame' }>): void {
  const { bitmap } = req;
  try {
    if (!primary) {
      post({ type: 'skipped', generation: req.generation, frameId: req.frameId, reason: 'not-ready' });
      return;
    }
    const t0 = performance.now();
    const bodies: Body[] = [];
    if (splitActive() && secondary) {
      const halves: [Slot, number, number][] = [
        [primary, 0, Math.min(1, splitX + DUO_SPLIT_OVERLAP)],
        [secondary, Math.max(0, splitX - DUO_SPLIT_OVERLAP), 1],
      ];
      const centres: number[] = [];
      halves.forEach(([slot, x0, x1], i) => {
        const r = run(slot, crop(bitmap, i, x0, x1), req.timestampMs);
        const w = x1 - x0;
        r.landmarks.forEach((lms, b) => {
          // Back to full-frame normalised coordinates (z uses the same scale as x).
          const image = lms.map((l) => ({ ...l, x: x0 + l.x * w, z: l.z * w }));
          const cx = torsoX(image);
          // Only the person on this side of the line (the neighbour's arm or shoulder in the overlap is not a player).
          if (i === 0 ? cx >= splitX : cx < splitX) return;
          bodies.push({ image, world: r.worldLandmarks[b] });
          centres.push(cx);
        });
      });
      // Follow the players: move the line toward the midpoint between them.
      if (centres.length === 2) splitX = Math.min(0.75, Math.max(0.25, 0.6 * splitX + 0.4 * ((centres[0]! + centres[1]!) / 2)));
    } else {
      if (splitActive()) ensureSecondary(); // still loading: use the whole frame meanwhile
      const r = run(primary, bitmap, req.timestampMs);
      r.landmarks.forEach((lms, b) => bodies.push({ image: lms, world: r.worldLandmarks[b] }));
    }
    const appearance = numPoses === 2 ? appearanceOf(bitmap, bodies) : new Float32Array(0);
    const inferenceMs = performance.now() - t0;
    const n = bodies.length;
    // Pack as [x, y, z, visibility] * 33 per body.
    const image = new Float32Array(n * 33 * 4);
    const world = new Float32Array(n * 33 * 4);
    bodies.forEach((body, b) => {
      for (let i = 0; i < 33; i++) {
        const o = (b * 33 + i) * 4;
        const l = body.image[i];
        if (l) {
          image[o] = l.x;
          image[o + 1] = l.y;
          image[o + 2] = l.z;
          image[o + 3] = l.visibility ?? 1;
        }
        const w = body.world?.[i];
        if (w) {
          world[o] = w.x;
          world[o + 1] = w.y;
          world[o + 2] = w.z;
          world[o + 3] = w.visibility ?? 1;
        }
      }
    });
    const msg: WorkerResponse = {
      type: 'result',
      generation: req.generation,
      frameId: req.frameId,
      inferenceMs,
      width: bitmap.width,
      height: bitmap.height,
      bodyCount: n,
      image,
      world,
      appearance,
    };
    self.postMessage(msg, [image.buffer, world.buffer, appearance.buffer]);
  } catch (e) {
    post({ type: 'frame-error', generation: req.generation, frameId: req.frameId, message: e instanceof Error ? e.message : String(e) });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  switch (req.type) {
    case 'init':
      void init(req);
      break;
    case 'configure':
      numPoses = req.numPoses;
      duoSplit = req.duoSplit;
      splitX = 0.5;
      syncPrimaryPoses()
        .then(() => {
          if (splitActive()) ensureSecondary();
        })
        .catch((e: unknown) => post({ type: 'error', code: 'MODEL_INIT_FAILED', message: `setOptions failed: ${String(e)}` }));
      break;
    case 'frame':
      detect(req);
      break;
    case 'close':
      primary?.landmarker.close();
      secondary?.landmarker.close();
      primary = secondary = null;
      post({ type: 'closed' });
      break;
  }
};
