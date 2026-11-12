# 0003 — Frame transport to the pose worker

**Context.** Inference must not block the render thread, must not build a backlog, and must release frame memory deterministically.

**Options considered.**

1. `MediaStreamTrackProcessor` in a worker (transfer the track). Not reliably available for transferring tracks from window to worker in this Chromium; would need verification per version.
2. Run MediaPipe on the main renderer thread. Simple, but inference (40–60 ms measured) would stall rendering.
3. **`createImageBitmap(video)` on the renderer, transfer the bitmap** (zero-copy ownership transfer) to a dedicated module worker. ✔

**Decision.** Option 3 with a `FrameGate`: paced to `targetHz`, at most `maxInFlight` (default 1) outstanding frames, results discarded if from an old generation or older than 300 ms, hung work reclaimed after 2 s. The worker closes every bitmap in `finally`. Module worker + `forVisionTasks(base, useModule=true)` because `importScripts` throws in module workers (confirmed in the tasks-vision 1.2.0 loader: it falls back to dynamic `import()` on TypeError).

**Measured (dev laptop, Integrated Webcam, 1280×720 request, lite model, 2026-11-02).** GPU delegate ≈42–64 ms inference, ≈13–15 Hz; CPU ≈54 ms, ≈15 Hz; in-flight never above 1. This is below the 20–30 Hz target on this machine; booth hardware must be qualified (see hardware-qualification.md). GPU was not faster than CPU here while the 3D scene was idle in ATTRACT; measure again during PLAYING on target hardware.

**Update 2026-11-02 (session 2), measured on the same laptop after adding the 3D
dance studio (environment lighting, GLB characters):** the GPU delegate
collapsed to 0–1 Hz. In-flight work stayed bounded at 1 frame, with
"busy" drops of about 75 per 8 s, because inference shares the GPU with the
scene. The CPU delegate held about 12 Hz with about 62 ms per inference. **The
default delegate is now CPU.** GPU remains selectable in the operator console.
Measure both on the booth PC (hardware-qualification H3).
