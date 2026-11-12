import { describe, expect, it } from 'vitest';
import type { DetectedBody, ReplayFixture, TrackingFrame } from '@booth/contracts';
import { FrameGate, PlayerAssigner, ReplayTrackingProvider, DEFAULT_ASSIGNMENT } from './index';

/** Raw-image body whose hip centre is at `rawX`. Only core joints matter here. */
function body(rawX: number, visibility = 0.9, detectionIndex = 0): DetectedBody {
  const lms = Array.from({ length: 33 }, () => ({ x: rawX, y: 0.5, z: 0, visibility }));
  return { detectionIndex, imageLandmarks: lms };
}

describe('PlayerAssigner', () => {
  const duo = { ...DEFAULT_ASSIGNMENT, slots: 2 as const, mirrorDisplay: true };

  it('claims slots by display zone, not detector order', () => {
    const a = new PlayerAssigner(duo);
    // Mirrored display: raw x 0.8 appears on the display LEFT -> Player 1.
    const s = a.assign([body(0.2, 0.9, 0), body(0.8, 0.9, 1)], 0);
    expect(s[0]).toMatchObject({ slot: 1, status: 'tracked', bodyIndex: 1 });
    expect(s[1]).toMatchObject({ slot: 2, status: 'tracked', bodyIndex: 0 });
  });

  it('keeps identities when detector order flips', () => {
    const a = new PlayerAssigner(duo);
    a.assign([body(0.8), body(0.2)], 0);
    const s = a.assign([body(0.2), body(0.79)], 33);
    expect(s[0]!.bodyIndex).toBe(1); // player 1 is still the body at raw 0.79
    expect(s[1]!.bodyIndex).toBe(0);
  });

  it('marks a briefly occluded player lost, then reacquires by proximity', () => {
    const a = new PlayerAssigner(duo);
    a.assign([body(0.8), body(0.2)], 0);
    let s = a.assign([body(0.2)], 100);
    expect(s[0]).toMatchObject({ status: 'lost', lostForMs: 100 });
    expect(s[1]!.status).toBe('tracked');
    s = a.assign([body(0.78), body(0.2)], 600);
    expect(s[0]).toMatchObject({ status: 'tracked', bodyIndex: 0 });
  });

  it('does not let a low-confidence detection steal a slot', () => {
    const a = new PlayerAssigner(duo);
    a.assign([body(0.8), body(0.2)], 0);
    const s = a.assign([body(0.8, 0.1), body(0.2)], 33);
    expect(s[0]!.status).toBe('lost');
  });

  it('rejects implausible jumps instead of swapping identities', () => {
    const a = new PlayerAssigner(duo);
    a.assign([body(0.8), body(0.2)], 0);
    // Player 2 vanishes and a body appears near player 1's position 33ms later: P2 must not take it.
    const s = a.assign([body(0.79)], 33);
    expect(s[0]!.status).toBe('tracked');
    expect(s[1]!.status).toBe('lost');
  });

  it('forgets a slot after the configured time', () => {
    const a = new PlayerAssigner({ ...duo, forgetAfterMs: 1000 });
    a.assign([body(0.8)], 0);
    expect(a.assign([], 1500)[0]!.status).toBe('empty');
  });

  it('single-player mode accepts a body anywhere', () => {
    const a = new PlayerAssigner({ ...DEFAULT_ASSIGNMENT, slots: 1 });
    expect(a.assign([body(0.1)], 0)[0]!.status).toBe('tracked');
  });
});

describe('FrameGate', () => {
  const cfg = { maxInFlight: 1, minIntervalMs: 30, maxResultAgeMs: 250, inFlightTimeoutMs: 2000 };

  it('never exceeds the in-flight bound and counts busy drops', () => {
    const g = new FrameGate(cfg);
    const t = g.tryAcquire(0)!;
    expect(t).not.toBeNull();
    expect(g.tryAcquire(40)).toBeNull();
    expect(g.snapshot().framesDroppedBusy).toBe(1);
    expect(g.complete(t.generation, t.frameId, 50, 20)?.captureTimestampMs).toBe(0);
    expect(g.tryAcquire(80)).not.toBeNull();
    expect(g.snapshot().inFlight).toBe(1);
  });

  it('paces submissions to the target rate without counting drops', () => {
    const g = new FrameGate({ ...cfg, maxInFlight: 2 });
    expect(g.tryAcquire(0)).not.toBeNull();
    expect(g.tryAcquire(10)).toBeNull();
    expect(g.snapshot().framesDroppedBusy).toBe(0);
  });

  it('discards results from a previous generation and stale results', () => {
    const g = new FrameGate(cfg);
    const t = g.tryAcquire(0)!;
    g.restart();
    expect(g.complete(t.generation, t.frameId, 10, 5)).toBeNull();
    const t2 = g.tryAcquire(100)!;
    expect(g.complete(t2.generation, t2.frameId, 500, 5)).toBeNull(); // 400ms old
    expect(g.snapshot().framesDroppedStale).toBe(2);
  });

  it('reclaims slots from hung inference', () => {
    const g = new FrameGate(cfg);
    g.tryAcquire(0);
    expect(g.tryAcquire(2500)).not.toBeNull();
  });
});

describe('ReplayTrackingProvider', () => {
  const fixture: ReplayFixture = {
    schemaVersion: 1,
    id: 'test-fixture',
    provenance: { kind: 'synthetic', generator: 'test', createdAt: '2026-11-02', description: 'unit test' },
    sourceWidth: 640,
    sourceHeight: 480,
    frames: [0, 0.1, 0.2, 0.3].map((t) => ({
      t,
      bodies: [Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.9] as [number, number, number, number])],
    })),
  };

  it('emits each frame once, in order, aligned to media time', async () => {
    const p = new ReplayTrackingProvider(fixture);
    const got: TrackingFrame[] = [];
    p.onFrame((f) => got.push(f));
    await p.start();
    p.advanceTo(0.15, 1000);
    p.advanceTo(0.15, 1016);
    p.advanceTo(1, 1033);
    expect(got.map((f) => f.mediaTimeSec)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(got.every((f) => f.source === 'replay')).toBe(true);
    expect(p.finished).toBe(true);
  });

  it('emits nothing after stop', async () => {
    const p = new ReplayTrackingProvider(fixture);
    let n = 0;
    p.onFrame(() => n++);
    await p.start();
    await p.stop();
    p.advanceTo(1, 0);
    expect(n).toBe(0);
  });
});

/** Body with a realistic torso: shoulders/hips ±halfWidth around rawX. */
function person(rawX: number, halfWidth = 0.05, visibility = 0.9): DetectedBody {
  const lms = Array.from({ length: 33 }, () => ({ x: rawX, y: 0.5, z: 0, visibility }));
  lms[11] = { x: rawX + halfWidth, y: 0.35, z: 0, visibility };
  lms[12] = { x: rawX - halfWidth, y: 0.35, z: 0, visibility };
  lms[23] = { x: rawX + halfWidth * 0.7, y: 0.6, z: 0, visibility };
  lms[24] = { x: rawX - halfWidth * 0.7, y: 0.6, z: 0, visibility };
  return { detectionIndex: 0, imageLandmarks: lms };
}

describe('duo players standing close together', () => {
  const duo = { ...DEFAULT_ASSIGNMENT, slots: 2 as const, mirrorDisplay: true };

  it('drops a second detection of the same person (overlap of the split halves)', () => {
    const a = new PlayerAssigner(duo);
    // Mirrored display: raw 0.6 is display 0.4 (Player 1 side), raw 0.3 is display 0.7.
    const s = a.assign([person(0.6), person(0.605, 0.05, 0.7), person(0.3)], 0);
    expect(s.find((p) => p.slot === 1)!.bodyIndex).toBe(0);
    expect(s.find((p) => p.slot === 2)!.bodyIndex).toBe(2);
  });

  it('keeps Player 1 and Player 2 on their sides when shoulders almost touch', () => {
    const a = new PlayerAssigner(duo);
    a.assign([person(0.62), person(0.38)], 0); // P1 display 0.38, P2 display 0.62
    let ids = { p1: 0, p2: 0 };
    // They step together to about one shoulder width apart; detector order flips every frame.
    for (let f = 1; f <= 20; f++) {
      const left = person(0.56 - (f % 2) * 0.005);
      const right = person(0.45 + (f % 2) * 0.005);
      const bodies = f % 2 ? [left, right] : [right, left];
      const s = a.assign(bodies, f * 33);
      const p1 = s.find((p) => p.slot === 1)!;
      const p2 = s.find((p) => p.slot === 2)!;
      expect(p1.status).toBe('tracked');
      expect(p2.status).toBe('tracked');
      // Player 1 must stay the body on the display-left (larger raw x when mirrored).
      expect(bodies[p1.bodyIndex!]!.imageLandmarks[11]!.x).toBeGreaterThan(bodies[p2.bodyIndex!]!.imageLandmarks[11]!.x);
      ids = { p1: p1.bodyIndex!, p2: p2.bodyIndex! };
    }
    expect(ids.p1).not.toBe(ids.p2);
  });
});
