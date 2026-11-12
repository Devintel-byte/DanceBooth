import {
  DEPTH_CAMERA_LABEL,
  boothError,
  cameraErrorCode,
  type BoothError,
  type BoothSettings,
  type DetectedBody,
  type TrackingFrame,
  type TrackingProviderStatus,
  type TrackingStats,
} from '@booth/contracts';
import { APPEARANCE_BINS, Emitter, FrameGate, type TrackingProvider } from '@booth/tracking';
import { cameraAttempts, chooseCamera } from './camera-choice';
import { log } from '../../shared/booth';
import type { WorkerRequest, WorkerResponse } from '../../../workers/pose-protocol';

export interface WebcamOptions {
  assetBaseUrl: string;
  camera: BoothSettings['camera'];
  tracking: BoothSettings['tracking'];
  numPoses: 1 | 2;
  /** Windows camera path this run uses (for error advice). */
  captureBackend?: 'media-foundation' | 'directshow';
  cameraTimeoutMs?: number;
  modelTimeoutMs?: number;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export async function listCameras(): Promise<CameraInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => BoothError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Real webcam + MediaPipe Pose Landmarker tracking.
 *
 * Capture runs on the renderer (getUserMedia + requestVideoFrameCallback);
 * each admitted frame is converted to an ImageBitmap and TRANSFERRED to the
 * pose worker. The FrameGate admits at most `maxInFlight` frames, so frames
 * are dropped (and counted) rather than queued when inference is slow.
 * Raw video never leaves this renderer and is never recorded.
 */
export class WebcamPoseProvider implements TrackingProvider {
  readonly kind = 'webcam-mediapipe' as const;
  private readonly frames = new Emitter<TrackingFrame>();
  private readonly statuses = new Emitter<TrackingProviderStatus>();
  private readonly gate: FrameGate;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private worker: Worker | null = null;
  private rvfcHandle: number | null = null;
  private running = false;
  private stopped = true;
  private deviceId: string | null = null;
  /** Why this camera was chosen (saved, integrated webcam, ...), for the operator. */
  choiceReason = '';
  private lastStatus: TrackingProviderStatus = { kind: 'idle' };

  constructor(private opts: WebcamOptions) {
    this.gate = new FrameGate({
      maxInFlight: opts.tracking.maxInFlight,
      minIntervalMs: 1000 / opts.tracking.targetHz,
      maxResultAgeMs: 300,
      inFlightTimeoutMs: 2000,
    });
  }

  get activeDeviceId(): string | null {
    return this.deviceId;
  }

  get status(): TrackingProviderStatus {
    return this.lastStatus;
  }

  private setStatus(s: TrackingProviderStatus): void {
    this.lastStatus = s;
    this.statuses.emit(s);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.stopped = false;
    this.setStatus({ kind: 'starting' });
    try {
      await this.openCamera();
      await this.startWorker();
      if (this.stopped) return;
      this.running = true;
      this.pump();
    } catch (e) {
      await this.stop();
      const err = (e && typeof e === 'object' && 'code' in e ? e : boothError('UNKNOWN', String(e))) as BoothError;
      this.setStatus({ kind: 'error', code: err.code, message: err.message });
      throw err;
    }
  }

  /** Changes the pose count without restarting (MediaPipe setOptions). */
  setNumPoses(n: 1 | 2): void {
    if (this.opts.numPoses === n) return;
    this.opts = { ...this.opts, numPoses: n };
    this.post({ type: 'configure', numPoses: n, duoSplit: this.opts.tracking.duoSplit });
  }

  private async openCamera(): Promise<void> {
    const { camera } = this.opts;
    const attempts = cameraAttempts({ width: camera.width, height: camera.height, frameRate: camera.frameRate });
    let lastError: BoothError | null = null;
    for (const [i, attempt] of attempts.entries()) {
      if (this.stopped) throw boothError('CAMERA_TIMEOUT', 'Camera start cancelled', true);
      // Re-list before every attempt: a camera that reset itself may have a new id.
      // Labels are available because the participant origin holds the camera permission.
      const choice = chooseCamera(await listCameras().catch(() => []), camera.deviceId, camera.label);
      this.choiceReason = choice.reason;
      const video: MediaTrackConstraints = { ...attempt.video, ...(choice.deviceId ? { deviceId: { exact: choice.deviceId } } : {}) };
      const started = performance.now();
      try {
        await this.tryOpen(video);
        const track = this.stream!.getVideoTracks()[0]!;
        const s = track.getSettings();
        log('info', `camera started: "${track.label}" ${s.width}x${s.height}@${s.frameRate ?? '?'} (${attempt.label}) in ${Math.round(performance.now() - started)} ms`);
        return;
      } catch (e) {
        lastError = (e && typeof e === 'object' && 'code' in e ? e : boothError('UNKNOWN', String(e))) as BoothError;
        log('warn', `camera attempt ${i + 1}/${attempts.length} (${attempt.label}) failed after ${Math.round(performance.now() - started)} ms: ${lastError.code} ${lastError.message}`);
        this.releaseCamera();
        // Permission problems and missing devices do not get better with another size.
        if (lastError.code === 'CAMERA_PERMISSION_DENIED' || lastError.code === 'CAMERA_NOT_FOUND') break;
        // Give the device a moment to power down before it is opened again.
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (camera.label && DEPTH_CAMERA_LABEL.test(camera.label) && this.opts.captureBackend !== 'directshow') {
      throw boothError(lastError?.code ?? 'CAMERA_TIMEOUT', `${lastError?.message ?? 'Camera did not start'}. This depth camera needs the DirectShow camera driver: set Camera driver to Auto or DirectShow (the app restarts).`, true);
    }
    if (lastError?.code === 'CAMERA_IN_USE') {
      throw boothError('CAMERA_IN_USE', `${lastError.message}. Close other apps using the camera (for an Azure Kinect: Azure Kinect Viewer, body-tracking or recorder apps).`, true);
    }
    throw lastError ?? boothError('CAMERA_TIMEOUT', 'Camera did not start', true);
  }

  /** Opens the camera with one set of constraints and waits until a real frame has arrived. */
  private async tryOpen(video: MediaTrackConstraints): Promise<void> {
    const timeoutMs = this.opts.cameraTimeoutMs ?? 20_000;
    let timedOut = false;
    const request = navigator.mediaDevices.getUserMedia({ video, audio: false }).then((s) => {
      // If the request resolves after we gave up, release the camera immediately.
      if (timedOut) s.getTracks().forEach((t) => t.stop());
      return s;
    });
    try {
      this.stream = await withTimeout(request, timeoutMs, () => {
        timedOut = true;
        return boothError('CAMERA_TIMEOUT', 'Camera did not open in time', true);
      });
    } catch (e) {
      if (e instanceof DOMException) {
        const code = e.name === 'OverconstrainedError' ? 'CAMERA_TIMEOUT' : cameraErrorCode(e.name);
        throw boothError(code, `${e.name}: ${e.message}`, code !== 'CAMERA_PERMISSION_DENIED');
      }
      throw e;
    }
    const track = this.stream.getVideoTracks()[0];
    if (!track) throw boothError('CAMERA_NOT_FOUND', 'No video track', true);
    // Report the id the operator console lists (enumerateDevices), not a session-specific one.
    this.deviceId = (video.deviceId as { exact?: string } | undefined)?.exact ?? track.getSettings().deviceId ?? null;
    track.addEventListener('ended', () => {
      if (this.stopped || this.stream?.getVideoTracks()[0] !== track) return;
      this.setStatus({ kind: 'error', code: 'CAMERA_DISCONNECTED', message: 'Camera track ended (unplugged or taken by another app)' });
      void this.stop();
    });

    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.setAttribute('aria-hidden', 'true');
    // Kept in the DOM (invisible) so frame callbacks fire reliably; never displayed or recorded.
    el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(el);
    el.srcObject = this.stream;
    this.video = el;
    // Some cameras (Azure Kinect) open quickly but deliver the first frame seconds later:
    // wait for an actual frame, not just for play() to resolve.
    const firstFrame = new Promise<void>((resolve) => {
      el.requestVideoFrameCallback(() => resolve());
    });
    void el.play().catch(() => undefined);
    await withTimeout(firstFrame, timeoutMs, () => boothError('CAMERA_TIMEOUT', 'Camera opened but sent no picture in time', true));
  }

  /** Stops the stream and removes the hidden video element from a failed attempt. */
  private releaseCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
  }

  private startWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('../../../workers/pose.worker.ts', import.meta.url), {
        type: 'module',
        name: 'pose-worker',
      });
      this.worker = worker;
      const generation = this.gate.restart();
      let ready = false;
      const timer = setTimeout(() => {
        if (!ready) reject(boothError('MODEL_INIT_FAILED', 'Pose model did not initialise in time', true));
      }, this.opts.modelTimeoutMs ?? 30_000);

      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        switch (msg.type) {
          case 'ready':
            ready = true;
            clearTimeout(timer);
            this.gate.setDelegate(msg.delegate);
            this.setStatus({
              kind: 'running',
              detail: `${this.choiceReason ? `Camera: ${this.choiceReason} · ` : ''}MediaPipe ${msg.delegate} (init ${Math.round(msg.initMs)} ms)${msg.fallbackReason ? ` — ${msg.fallbackReason}` : ''}`,
            });
            resolve();
            break;
          case 'error':
            clearTimeout(timer);
            if (!ready) reject(boothError(msg.code, msg.message, msg.code !== 'MODEL_MISSING'));
            else this.setStatus({ kind: 'error', code: msg.code, message: msg.message });
            break;
          case 'result':
            this.onResult(msg);
            break;
          case 'skipped':
          case 'frame-error':
            this.gate.complete(msg.generation, msg.frameId, performance.now(), null);
            break;
          case 'closed':
            break;
        }
      };
      worker.onerror = (ev) => {
        ev.preventDefault();
        clearTimeout(timer);
        const message = ev.message || 'pose worker crashed';
        if (!ready) reject(boothError('TRACKING_WORKER_CRASHED', message, true));
        else if (!this.stopped) {
          this.setStatus({ kind: 'error', code: 'TRACKING_WORKER_CRASHED', message });
          void this.stop();
        }
      };
      void generation;
      this.post({
        type: 'init',
        wasmBaseUrl: `${this.opts.assetBaseUrl}tracking-models/wasm`,
        modelUrl: `${this.opts.assetBaseUrl}tracking-models/pose_landmarker_${this.opts.tracking.model}.task`,
        delegate: this.opts.tracking.delegate,
        numPoses: this.opts.numPoses,
        duoSplit: this.opts.tracking.duoSplit,
        minPoseDetectionConfidence: this.opts.tracking.minPoseDetectionConfidence,
        minPosePresenceConfidence: this.opts.tracking.minPosePresenceConfidence,
        minTrackingConfidence: this.opts.tracking.minTrackingConfidence,
      });
    });
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private pump = (): void => {
    const video = this.video;
    if (!video || !this.running) return;
    this.rvfcHandle = video.requestVideoFrameCallback((now, meta) => {
      if (!this.running) return;
      // captureTime is on the performance.now() clock when the camera reports it.
      const captureTs = meta.captureTime ?? now;
      const ticket = this.gate.tryAcquire(captureTs);
      if (ticket) {
        // Downscale before transfer: less copying and upload work for the model.
        // Duo split mode cuts the frame in two overlapping halves: send more pixels so each half keeps the detail.
        const want = this.opts.numPoses === 2 && this.opts.tracking.duoSplit ? Math.round(this.opts.tracking.inputWidth * 1.6) : this.opts.tracking.inputWidth;
        const w = Math.min(want, video.videoWidth || want);
        const h = Math.max(1, Math.round((w * (video.videoHeight || 9)) / (video.videoWidth || 16)));
        createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
          .then((bitmap) => {
            if (!this.running || !this.worker || ticket.generation !== this.gate.currentGeneration) {
              bitmap.close();
              this.gate.abandon(ticket.frameId);
              return;
            }
            this.post(
              { type: 'frame', generation: ticket.generation, frameId: ticket.frameId, timestampMs: captureTs, bitmap },
              [bitmap],
            );
          })
          .catch(() => this.gate.abandon(ticket.frameId));
      }
      this.pump();
    });
  };

  private onResult(msg: Extract<WorkerResponse, { type: 'result' }>): void {
    const now = performance.now();
    const ticket = this.gate.complete(msg.generation, msg.frameId, now, msg.inferenceMs);
    if (!ticket) return;
    const bodies: DetectedBody[] = [];
    for (let b = 0; b < msg.bodyCount; b++) {
      const imageLandmarks = [];
      const worldLandmarks = [];
      for (let i = 0; i < 33; i++) {
        const o = (b * 33 + i) * 4;
        imageLandmarks.push({ x: msg.image[o]!, y: msg.image[o + 1]!, z: msg.image[o + 2]!, visibility: msg.image[o + 3]! });
        worldLandmarks.push({ x: msg.world[o]!, y: msg.world[o + 1]!, z: msg.world[o + 2]!, visibility: msg.world[o + 3]! });
      }
      const o = b * APPEARANCE_BINS;
      const sig = msg.appearance.length >= o + APPEARANCE_BINS && !Number.isNaN(msg.appearance[o]) ? Array.from(msg.appearance.subarray(o, o + APPEARANCE_BINS)) : undefined;
      bodies.push(sig ? { detectionIndex: b, imageLandmarks, worldLandmarks, appearance: sig } : { detectionIndex: b, imageLandmarks, worldLandmarks });
    }
    this.frames.emit({
      generation: msg.generation,
      frameId: msg.frameId,
      source: 'webcam-mediapipe',
      captureTimestampMs: ticket.captureTimestampMs,
      resultTimestampMs: now,
      inferenceMs: msg.inferenceMs,
      mediaTimeSec: null,
      sourceWidth: msg.width,
      sourceHeight: msg.height,
      coordinateSpace: 'image-normalized',
      bodies,
      players: [],
    });
  }

  /** Idempotent: releases camera, worker and DOM element. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.video && this.rvfcHandle !== null) this.video.cancelVideoFrameCallback(this.rvfcHandle);
    this.rvfcHandle = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    if (this.worker) {
      this.post({ type: 'close' });
      this.worker.terminate();
      this.worker = null;
    }
    this.gate.restart();
    if (this.lastStatus.kind !== 'error') this.setStatus({ kind: 'stopped' });
  }

  onFrame(listener: (frame: TrackingFrame) => void): () => void {
    return this.frames.on(listener);
  }

  onStatus(listener: (status: TrackingProviderStatus) => void): () => void {
    return this.statuses.on(listener);
  }

  stats(nowMs: number): TrackingStats {
    return this.gate.snapshot(nowMs);
  }
}
