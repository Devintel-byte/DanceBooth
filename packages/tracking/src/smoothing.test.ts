import { describe, expect, it } from 'vitest';
import { LANDMARK, type DetectedBody, type Landmark } from '@booth/contracts';
import { LandmarkSmoother, OneEuro } from './smoothing';
import { PlayerAssigner, DEFAULT_ASSIGNMENT, coreConfidence } from './assignment';

describe('OneEuro', () => {
  it('removes jitter on a still point', () => {
    const f = new OneEuro(1.2, 3);
    let maxDev = 0;
    for (let i = 0; i < 60; i++) {
      const out = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33);
      if (i > 10) maxDev = Math.max(maxDev, Math.abs(out - 0.5));
    }
    expect(maxDev).toBeLessThan(0.005);
  });

  it('follows a fast move with little lag', () => {
    const f = new OneEuro(1.2, 3);
    let out = 0;
    // 0.6 normalised widths in 300 ms at 30 Hz (a quick arm swing).
    for (let i = 0; i <= 10; i++) out = f.filter(Math.min(0.6, i * 0.06), i * 33);
    for (let i = 11; i <= 16; i++) out = f.filter(0.6, i * 33);
    expect(out).toBeGreaterThan(0.55);
  });
});

function lms(vis: number): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: i / 40, z: 0, visibility: vis }));
}

describe('LandmarkSmoother', () => {
  it('keeps a joint visible through a one-frame visibility drop', () => {
    const s = new LandmarkSmoother();
    s.filter(lms(0.9), 0);
    s.filter(lms(0.9), 33);
    const out = s.filter(lms(0.1), 66);
    expect(out[LANDMARK.leftWrist]!.visibility).toBeGreaterThan(0.5);
  });

  it('restarts after a long gap instead of sliding from an old position', () => {
    const s = new LandmarkSmoother();
    s.filter(lms(0.9), 0);
    const moved = lms(0.9).map((l) => ({ ...l, x: 0.1 }));
    expect(s.filter(moved, 5000)[0]!.x).toBeCloseTo(0.1);
  });
});

function body(x: number, shoulderVis: number, hipVis: number): DetectedBody {
  const l = lms(0.9).map((p) => ({ ...p, x }));
  for (const i of [LANDMARK.leftShoulder, LANDMARK.rightShoulder]) l[i]!.visibility = shoulderVis;
  for (const i of [LANDMARK.leftHip, LANDMARK.rightHip]) l[i]!.visibility = hipVis;
  return { detectionIndex: 0, imageLandmarks: l, worldLandmarks: l };
}

describe('robust assignment', () => {
  it('keeps a dancer whose hips are cropped or hidden but upper body is clear', () => {
    expect(coreConfidence(body(0.5, 0.95, 0.05))).toBeGreaterThan(0.9);
    const a = new PlayerAssigner({ ...DEFAULT_ASSIGNMENT, slots: 1 });
    expect(a.assign([body(0.5, 0.95, 0.05)], 0)[0]!.status).toBe('tracked');
  });

  it('solo: reacquires the dancer after a fast jump across the frame', () => {
    const a = new PlayerAssigner({ ...DEFAULT_ASSIGNMENT, slots: 1 });
    a.assign([body(0.5, 0.9, 0.9)], 0);
    a.assign([], 150);
    // 0.45 widths in 400 ms at low tracking rate: beyond the speed gate, still the same dancer.
    expect(a.assign([body(0.05, 0.9, 0.9)], 400)[0]!.status).toBe('tracked');
  });

  it('duo: still refuses a jump into the other player\'s position', () => {
    const a = new PlayerAssigner({ ...DEFAULT_ASSIGNMENT, slots: 2, mirrorDisplay: false });
    a.assign([body(0.2, 0.9, 0.9), body(0.8, 0.9, 0.9)], 0);
    const out = a.assign([body(0.8, 0.9, 0.9)], 33);
    expect(out.find((p) => p.slot === 2)!.status).toBe('tracked');
    expect(out.find((p) => p.slot === 1)!.status).toBe('lost');
  });
});

describe('CalibrationHold dropouts', () => {
  it('a one-frame blip pauses progress instead of restarting it; a long drop restarts', async () => {
    const { CalibrationHold } = await import('./calibration');
    const h = new CalibrationHold(1500, 400);
    for (let t = 0; t <= 1000; t += 100) h.update(true, t);
    h.update(false, 1100);
    expect(h.update(true, 1200).progress).toBeGreaterThan(0.7);
    expect(h.update(true, 1700).complete).toBe(true);
    h.reset();
    h.update(true, 0);
    h.update(true, 800);
    h.update(false, 900);
    expect(h.update(false, 1500).progress).toBe(0);
  });
});
