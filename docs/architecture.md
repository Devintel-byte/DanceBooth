# Architecture

## Processes and responsibilities

```
┌──────────────────────── Electron main (Node) ────────────────────────┐
│ lifecycle · windows/displays · booth-app:// + booth-asset:// protocols │
│ CSP/permissions/navigation guards · validated IPC router · settings   │
│ logger (rotation/retention) · session records · diagnostics export    │
│ renderer crash policy · display-sleep blocker                          │
└───────────────▲───────────────────────────────────────▲──────────────┘
     preload    │ participant bridge         preload    │ operator bridge
┌───────────────┴──────────────────┐   ┌────────────────┴──────────────┐
│ Participant renderer (sandboxed)  │   │ Operator renderer (sandboxed) │
│ BoothRuntime (effects layer)      │   │ status, controls, settings,   │
│  ├ XState session machine         │   │ diagnostics, error history    │
│  ├ AudioEngine (Web Audio clock)  │   └───────────────────────────────┘
│  ├ SongTimeline + pose sampler    │
│  ├ PlayerAssigner, calibration    │        ┌──────────────────────────┐
│  ├ PlayerScorer per slot          │ bitmap │ Pose worker (module)     │
│  ├ WebcamPoseProvider ────────────┼───────►│ MediaPipe PoseLandmarker │
│  │   or ReplayTrackingProvider    │◄───────┤ VIDEO mode, CPU/GPU      │
│  React UI (low-rate snapshot)     │ result └──────────────────────────┘
│  R3F stage (reads per-frame state)│
└───────────────────────────────────┘
```

* **Main** never sees video. It owns privileged operations only; every
  renderer message passes `senderRole()` (window identity + main frame +
  expected origin) and a Zod schema (`ipc-policy.ts`).
* **Preload** exposes `window.booth` per role. Participant cannot send
  operator commands; operator cannot send status. No `ipcRenderer`, Node,
  or filesystem access reaches page code.
* **Participant renderer** hosts `BoothRuntime`, the single owner of session
  resources. React reads an immutable snapshot published at ≤10 Hz; the 3D
  scene and skeleton canvas read a mutable `FrameState` every frame. Pose
  data never flows through React state.
* **Operator renderer** receives participant status at 4 Hz (relayed by main)
  and sends commands that main forwards to the participant window.

## Session lifecycle

`packages/session` defines the machine (BOOT, SELF_CHECK, ATTRACT,
MODE_SELECT, CHARACTER_SELECT, CALIBRATION, TUTORIAL, COUNTDOWN, PLAYING,
PAUSED, RESULTS, RESETTING, RECOVERABLE_ERROR, MAINTENANCE). It is pure:
timers are XState delays (tested with `SimulatedClock`), and side effects
live in `BoothRuntime.onStateChange`. Events from asynchronous resources
carry the `sessionId`; guards drop events from older sessions. ABORT is
handled in every active state. Recoverable errors retry through RESETTING
up to `maxRecoveryAttempts`, then escalate to MAINTENANCE.

Ownership: tracking (camera + worker) is a booth-level resource kept warm
between participants; audio playback, timeline, scorers, calibration state
and per-participant UI state are session-level and released by the
idempotent `cleanupSession()` on RESETTING / RECOVERABLE_ERROR / MAINTENANCE.

## Timing model

* **Authoritative clock:** `AudioContext.currentTime`. `SongTimeline` maps
  it to song position (schedule, pause, resume, calibration offset). Song time
  is never accumulated from frame deltas.
* **Countdown:** entering COUNTDOWN schedules the buffer to start exactly
  `countdownSec` later on the audio clock; the countdown digits are derived
  from the negative song time, so audio and visuals cannot disagree.
* **Camera frames:** stamped with `requestVideoFrameCallback` `captureTime`
  (performance clock). `ClockMapper` converts to audio time using
  `AudioContext.getOutputTimestamp()`, so scoring uses **capture** time, not
  inference completion time.
* **Replay frames:** carry `mediaTimeSec` aligned to song position 0 and are
  advanced from the audio position, so replay scoring is deterministic.

## Tracking pipeline

1. `WebcamPoseProvider` opens the camera (`getUserMedia`, 8 s timeout, late
   streams released), keeps an invisible `<video>` in the DOM.
2. Each video frame asks `FrameGate.tryAcquire()`. It paces to `targetHz` and
   refuses when `maxInFlight` (default 1) frames are outstanding; refused
   frames are counted as dropped, never queued.
3. Admitted frames → `createImageBitmap` → **transferred** to the worker.
   The worker closes every bitmap in `finally`.
4. Worker runs `detectForVideo` (strictly increasing timestamps) and returns
   packed `Float32Array`s (transferred).
5. `FrameGate.complete()` discards results from older generations (restart)
   or older than 300 ms.
6. `PlayerAssigner` maps detections to stable P1/P2 slots (zone claim,
   proximity + speed gating, confidence floor, lost/forget timers).
7. Calibration (`evaluateFraming`) and scoring consume the assigned frame.

GPU delegate failure falls back to CPU **and reports it** in the status text.
MediaPipe runs in a module worker; it loads the ES-module WASM loader variant
(`forVisionTasks(base, true)`), because `importScripts` is unavailable in
module workers (verified in the 1.2.0 bundle source).

## Scoring

Pure (`packages/scoring`). Landmarks → instructor-frame segment directions
(`extractPose`, see decision 0004 for mirror conventions) → per-segment angle
error with piecewise-linear scoring, relevant-group weighting, and an
evidence threshold. Low-visibility or degenerate segments are excluded, never
counted wrong; a move with too little evidence is `no-read` and excluded from
the percentage. Timing uses the best sample in a ±tolerance window with a
floor. `PlayerScorer` de-duplicates by frame key and is deterministic.

## Local asset serving and security

* `booth-app://participant|operator/...` serves the built renderers
  (production). Distinct hosts give distinct origins used by permission and
  IPC checks.
* `booth-asset://content/...` serves `assets/` (dev: repo root; packaged:
  `resources/assets`) through `resolveAssetPath()` (rejects traversal,
  encoded traversal, drive letters, UNC, ADS, NUL) with explicit MIME types,
  byte ranges, and CORS limited to the app/dev origins.
* CSP (production): `default-src 'none'`; scripts from self + booth-asset +
  `'wasm-unsafe-eval'`; no inline/remote script. Dev adds the Vite origin.
* `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity` on,
  window.open denied, off-origin navigation blocked, webviews blocked.
* Permissions: only `media` with video only, only for the participant window
  at its expected origin. Device (USB/HID/serial) permissions denied.
* Fuses (packaged): RunAsNode off, NODE_OPTIONS off, inspect args off, ASAR
  integrity validation on, only load app from ASAR.

Kiosk mode is a window feature, not a security boundary; see
[operator-runbook.md](operator-runbook.md#booth-pc-configuration).

## Extension points (not implemented)

* `TrackingProvider` interface for other cameras/devices (must emit the
  canonical 33-landmark topology with explicit coordinate space).
* Networking: none. Session records are local JSONL; a future sync would read
  them, not change the session machine.
