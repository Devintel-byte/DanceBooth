import { describe, expect, it } from 'vitest';
import type { DetectedBody, PlayerSlotState } from '@booth/contracts';
import { synthesizeLandmarks } from '@booth/scoring';
import { CalibrationHold, TrackingLossMonitor, evaluateFraming } from './calibration';

const tracked: PlayerSlotState = { slot: 1, status: 'tracked', bodyIndex: 0, confidence: 0.9, lostForMs: 0, lastX: 0.5 };
const T_POSE = { leftUpperArm: [1, 0], leftForearm: [1, 0], rightUpperArm: [-1, 0], rightForearm: [-1, 0] } as const;

function bodyAt(opts: Parameters<typeof synthesizeLandmarks>[1]): DetectedBody {
  return { detectionIndex: 0, imageLandmarks: synthesizeLandmarks(T_POSE, opts) };
}

describe('evaluateFraming', () => {
  it('accepts a well-framed participant', () => {
    const r = evaluateFraming([bodyAt({ mirroring: 'mirror', torso: 0.22, hipY: 0.55 })], [tracked], ['arms'], true);
    expect(r[0]).toEqual({ slot: 1, ready: true, issues: [] });
  });

  it('asks a participant who is too close to step back', () => {
    const r = evaluateFraming([bodyAt({ mirroring: 'mirror', torso: 0.5, hipY: 0.7 })], [tracked], ['arms'], true);
    expect(r[0]!.issues).toContain('step-back');
  });

  it('asks a distant participant to come closer', () => {
    const r = evaluateFraming([bodyAt({ mirroring: 'mirror', torso: 0.08 })], [tracked], ['arms'], true);
    expect(r[0]!.issues).toContain('come-closer');
  });

  it('gives a mirrored direction when cut off at the side', () => {
    // Raw x near 0.95 is near the display's LEFT edge when mirrored -> move right.
    const r = evaluateFraming([bodyAt({ mirroring: 'mirror', torso: 0.2, hipX: 0.92 })], [tracked], ['arms'], true);
    expect(r[0]!.issues).toContain('move-right');
  });

  it('asks for hidden arms to be shown and reports missing players', () => {
    const r = evaluateFraming(
      [bodyAt({ mirroring: 'mirror', torso: 0.22, hidden: ['leftWrist'] })],
      [tracked, { slot: 2, status: 'empty', bodyIndex: null, confidence: 0, lostForMs: 0, lastX: null }],
      ['arms'],
      true,
    );
    expect(r[0]!.issues).toContain('show-arms');
    expect(r[1]).toEqual({ slot: 2, ready: false, issues: ['not-detected'] });
  });
});

describe('duo framing', () => {
  const p2: PlayerSlotState = { slot: 2, status: 'tracked', bodyIndex: 1, confidence: 0.9, lostForMs: 0, lastX: 0.75 };
  const at = (hipX: number) => ({ detectionIndex: 0, imageLandmarks: synthesizeLandmarks(T_POSE, { mirroring: 'mirror', torso: 0.16, hipX }) });

  it('accepts two well-separated players on their own sides', () => {
    // Mirrored display: raw 0.72 shows on the left (P1), raw 0.28 on the right (P2).
    const r = evaluateFraming([at(0.72), at(0.28)], [tracked, p2], ['arms'], true);
    expect(r.map((x) => x.ready)).toEqual([true, true]);
  });

  it('flags players that drift into the other half or stand too close', () => {
    const swapped = evaluateFraming([at(0.3), at(0.72)], [tracked, p2], ['arms'], true);
    expect(swapped[0]!.issues).toContain('wrong-side');
    expect(swapped[1]!.issues).toContain('wrong-side');
    const close = evaluateFraming([at(0.55), at(0.45)], [tracked, p2], ['arms'], true);
    expect(close[0]!.issues).toContain('too-close');
    expect(close[1]!.issues).toContain('too-close');
  });
});

describe('CalibrationHold', () => {
  it('requires continuous readiness', () => {
    const h = new CalibrationHold(1000);
    expect(h.update(true, 0).complete).toBe(false);
    expect(h.update(false, 500).progress).toBe(0);
    h.update(true, 600);
    expect(h.update(true, 1600).complete).toBe(true);
  });
});

describe('TrackingLossMonitor', () => {
  it('prompts after the grace period and pauses only when everyone is gone', () => {
    const m = new TrackingLossMonitor(1500, 5000);
    const lost = (ms: number): PlayerSlotState => ({ ...tracked, status: 'lost', bodyIndex: null, lostForMs: ms });
    expect(m.evaluate([lost(1000)], 1000)).toEqual({ prompt: [], shouldPause: false });
    expect(m.evaluate([lost(2000)], 2000)).toEqual({ prompt: [1], shouldPause: false });
    expect(m.evaluate([lost(6000)], 6000).shouldPause).toBe(true);
  });
});
