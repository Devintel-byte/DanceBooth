import type { UiSnapshot } from '../runtime/runtime';

const f = (v: number | null, digits = 1) => (v === null ? 'n/a' : v.toFixed(digits));

/**
 * Developer performance overlay. Values are measured in this renderer:
 * - FPS / frame times: requestAnimationFrame intervals (display cadence, not GPU time).
 * - Inference: wall time of detectForVideo inside the worker.
 * - Result age: result time minus camera capture time (ESTIMATE; excludes display latency,
 *   and equals 0 for replay input).
 * - JS heap: Chromium's non-standard performance.memory (approximate).
 * GPU/CPU utilisation is not measurable from the renderer and is not shown.
 */
export function PerfOverlay({ snap }: { snap: UiSnapshot }) {
  const p = snap.perf;
  return (
    <div className="perf-overlay" aria-hidden="true">
      <div>
        FPS {f(p.fps, 0)} · frame p50/95/99 {f(p.frameMsP50)}/{f(p.frameMsP95)}/{f(p.frameMsP99)} ms
      </div>
      <div>
        input {snap.inputSource} · track {f(p.trackingHz, 0)} Hz · infer {f(p.inferenceMs)} ms · age≈{f(p.resultAgeMs, 0)} ms
      </div>
      <div>
        in-flight {p.inFlight} · dropped busy {p.droppedBusy} / stale {p.droppedStale} · heap≈{f(p.jsHeapMB, 0)} MB · audio {p.audioState}
      </div>
      <div>
        state {snap.state} · session {snap.sessionId} · song {f(snap.songTimeSec, 2)} s
      </div>
    </div>
  );
}
