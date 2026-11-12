import { describe, expect, it } from 'vitest';
import type { SegmentName } from '@booth/contracts';
import {
  DIFFICULTY_PRESETS,
  PlayerScorer,
  angleBetweenDeg,
  extractPose,
  matchPose,
  pointsFor,
  synthesizeLandmarks,
} from './index';

type Pose = Partial<Record<SegmentName, [number, number]>>;

const ARMS_UP: Pose = {
  leftUpperArm: [0.3, 1],
  leftForearm: [0.2, 1],
  rightUpperArm: [-0.3, 1],
  rightForearm: [-0.2, 1],
};
/** Instructor's LEFT arm out to the side (appears on screen right), right arm down. */
const LEFT_ARM_OUT: Pose = {
  leftUpperArm: [1, 0],
  leftForearm: [1, 0],
  rightUpperArm: [-0.1, -1],
  rightForearm: [-0.1, -1],
};
const normal = DIFFICULTY_PRESETS.normal;

describe('extractPose', () => {
  it('round-trips synthetic poses in both mirroring conventions', () => {
    for (const mirroring of ['mirror', 'same-side'] as const) {
      const lms = synthesizeLandmarks(LEFT_ARM_OUT, { mirroring });
      const pose = extractPose(lms, mirroring);
      const d = pose.segments.leftUpperArm!.direction;
      expect(angleBetweenDeg(d, { x: 1, y: 0 })).toBeLessThan(0.5);
      expect(pose.bodyScale).toBeCloseTo(0.28, 5);
    }
  });

  it('mirror mode maps the participant left arm onto the instructor right arm', () => {
    // Participant raises their anatomical LEFT arm out to their left, which a
    // camera facing them sees on the image right (+x).
    const lms = synthesizeLandmarks(LEFT_ARM_OUT, { mirroring: 'same-side' });
    // Interpreted as same-side: it is the instructor's left arm pointing screen-right.
    expect(extractPose(lms, 'same-side').segments.leftUpperArm).toBeDefined();
    // Interpreted as mirror: the same raw image is the participant mirroring a RIGHT arm.
    const mirrored = extractPose(lms, 'mirror');
    const right = mirrored.segments.rightUpperArm!.direction;
    expect(angleBetweenDeg(right, { x: -1, y: 0 })).toBeLessThan(0.5);
  });

  it('treats low-visibility joints as missing rather than wrong', () => {
    const lms = synthesizeLandmarks(ARMS_UP, { mirroring: 'mirror', hidden: ['leftWrist', 'leftElbow'] });
    const pose = extractPose(lms, 'mirror');
    // participant left arm maps to instructor right in mirror mode
    expect(pose.segments.rightUpperArm).toBeUndefined();
    expect(pose.segments.rightForearm).toBeUndefined();
    expect(pose.segments.leftUpperArm).toBeDefined();
  });

  it('drops degenerate (zero-length) segments', () => {
    const lms = synthesizeLandmarks(ARMS_UP, { mirroring: 'same-side' });
    lms[13] = { ...lms[11]! }; // left elbow on top of left shoulder
    const pose = extractPose(lms, 'same-side');
    expect(pose.segments.leftUpperArm).toBeUndefined();
  });

  it('never produces NaN directions from non-finite input', () => {
    const lms = synthesizeLandmarks(ARMS_UP, { mirroring: 'same-side' });
    lms[15] = { x: Number.NaN, y: 0.5, z: 0, visibility: 0.9 };
    const pose = extractPose(lms, 'same-side');
    expect(pose.segments.leftForearm).toBeUndefined();
    for (const f of Object.values(pose.segments)) {
      expect(Number.isFinite(f.direction.x) && Number.isFinite(f.direction.y)).toBe(true);
    }
  });
});

describe('matchPose', () => {
  it('scores an exact match as 1 and an opposite pose low', () => {
    const lms = synthesizeLandmarks(ARMS_UP, { mirroring: 'mirror' });
    const pose = extractPose(lms, 'mirror');
    expect(matchPose(pose, ARMS_UP, ['arms'], normal).quality).toBeCloseTo(1, 5);
    const down: Pose = {
      leftUpperArm: [0, -1],
      leftForearm: [0, -1],
      rightUpperArm: [0, -1],
      rightForearm: [0, -1],
    };
    const m = matchPose(pose, down, ['arms'], normal);
    expect(m.valid).toBe(true);
    expect(m.quality).toBeLessThan(0.05);
  });

  it('is invariant to body size, position and proportions', () => {
    const a = extractPose(synthesizeLandmarks(LEFT_ARM_OUT, { mirroring: 'mirror', torso: 0.18, hipX: 0.3 }), 'mirror');
    const b = extractPose(
      synthesizeLandmarks(LEFT_ARM_OUT, {
        mirroring: 'mirror',
        torso: 0.35,
        hipX: 0.7,
        proportions: { upperArm: 0.7, forearm: 0.4, shoulderWidth: 0.9 },
      }),
      'mirror',
    );
    expect(matchPose(a, LEFT_ARM_OUT, ['arms'], normal).quality).toBeCloseTo(1, 5);
    expect(matchPose(b, LEFT_ARM_OUT, ['arms'], normal).quality).toBeCloseTo(1, 5);
  });

  it('reports insufficient evidence instead of a confident failure', () => {
    const lms = synthesizeLandmarks(ARMS_UP, {
      mirroring: 'mirror',
      hidden: ['leftElbow', 'leftWrist', 'rightElbow', 'rightWrist'],
    });
    const m = matchPose(extractPose(lms, 'mirror'), ARMS_UP, ['arms'], normal);
    expect(m.valid).toBe(false);
    expect(m.evidence).toBe(0);
  });

  it('scores the wrong arm low in mirror mode', () => {
    // Participant does the same-side version of LEFT_ARM_OUT while the routine expects mirroring.
    const lms = synthesizeLandmarks(LEFT_ARM_OUT, { mirroring: 'same-side' });
    const m = matchPose(extractPose(lms, 'mirror'), LEFT_ARM_OUT, ['arms'], normal);
    expect(m.quality).toBeLessThan(0.5);
  });
});

describe('points follow how closely the move is matched', () => {
  it('gives proportionally fewer points as the pose drifts from the reference', () => {
    const ref: Pose = { leftUpperArm: [1, 0], leftForearm: [1, 0], rightUpperArm: [-1, 0], rightForearm: [-1, 0] };
    const tilted = (deg: number): Pose => {
      const r = (deg * Math.PI) / 180;
      const d: [number, number] = [Math.cos(r), Math.sin(r)];
      const m: [number, number] = [-Math.cos(r), Math.sin(r)];
      return { leftUpperArm: d, leftForearm: d, rightUpperArm: m, rightForearm: m };
    };
    const points = [0, 25, 30, 33, 36, 40, 55, 80].map((deg) => {
      const s = new PlayerScorer({ requiredGroups: ['arms'], moves: [{ timeSec: 1, judged: true, pose: ref }] }, normal);
      for (let k = 0; k < 25; k++) s.addSample(k, 0.6 + k * 0.033, extractPose(synthesizeLandmarks(tilted(deg), { mirroring: 'mirror' }), 'mirror'));
      s.finish();
      return s.moveResults[0]!.points;
    });
    // 10 for a match, 4 for close, nothing for a wrong pose held still.
    expect(points[0]).toBe(10);
    for (let i = 1; i < points.length; i++) expect(points[i]!).toBeLessThanOrEqual(points[i - 1]!);
    expect(points).toContain(4);
    expect(points[points.length - 1]).toBe(0);
  });
});

describe('PlayerScorer', () => {
  const routine = {
    requiredGroups: ['arms'] as const,
    moves: [
      { timeSec: 1, judged: true, pose: ARMS_UP },
      { timeSec: 2, judged: true, pose: LEFT_ARM_OUT },
      { timeSec: 3, judged: true, pose: ARMS_UP },
    ],
  };

  function feed(scorer: PlayerScorer, poseAt: (t: number) => Pose | null, hz = 30, until = 4) {
    let frame = 0;
    for (let t = 0; t <= until; t += 1 / hz) {
      const p = poseAt(t);
      scorer.addSample(frame++, t, p ? extractPose(synthesizeLandmarks(p, { mirroring: 'mirror' }), 'mirror') : null);
      scorer.advance(t);
    }
    scorer.finish();
  }

  it('awards full points for perfect, on-time performance', () => {
    const s = new PlayerScorer(routine, normal);
    feed(s, (t) => (Math.abs(t - 2) < 0.4 ? LEFT_ARM_OUT : ARMS_UP));
    const sum = s.summary();
    expect(sum.judgedMoves).toBe(3);
    expect(sum.percent).toBeGreaterThan(99);
    expect(sum.feedbackCounts.perfect).toBe(3);
  });

  it('excuses a steady reaction delay but not falling further behind', () => {
    // A player who copies everything ~0.3 s late (normal when following a screen).
    const steady = new PlayerScorer(routine, normal);
    feed(steady, (t) => (t > 2.28 && t < 2.75 ? LEFT_ARM_OUT : ARMS_UP));
    const r = steady.moveResults[1]!;
    expect(r.valid).toBe(true);
    expect(r.timingOffsetSec!).toBeGreaterThan(0.25);
    expect(r.timingQuality).toBeGreaterThan(0.9);
    // The same move hit 0.65 s late, well beyond the usual delay, loses timing.
    const slow = new PlayerScorer(routine, normal);
    feed(slow, (t) => (t > 2.63 && t < 3 ? LEFT_ARM_OUT : ARMS_UP));
    const q = slow.moveResults[1]!;
    expect(q.timingQuality).toBeLessThan(0.8);
    // Timing can only take off timingWeight of the score: accuracy still dominates.
    expect(q.combined).toBeGreaterThanOrEqual((1 - normal.timingWeight) * q.poseQuality - 1e-9);
    expect(q.points).toBe(pointsFor(q.feedback, normal));
  });

  it('needs the pose held: one passing frame does not score', () => {
    const held = new PlayerScorer(routine, normal);
    feed(held, (t) => (t > 1.65 && t < 2.4 ? LEFT_ARM_OUT : ARMS_UP));
    const flick = new PlayerScorer(routine, normal);
    let n = 0;
    feed(flick, () => (n++ === 60 ? LEFT_ARM_OUT : ARMS_UP)); // a single frame at t = 2
    expect(held.moveResults[1]!.points).toBe(10);
    // A flick is not a match, and there are no points for just moving.
    expect(flick.moveResults[1]!.points).toBe(0);
  });

  it('accepts same-side copying from a player who does it consistently', () => {
    const RIGHT_ARM_OUT: Pose = { rightUpperArm: [-1, 0], rightForearm: [-1, 0], leftUpperArm: [0.1, -1], leftForearm: [0.1, -1] };
    const asym = {
      requiredGroups: ['arms'] as const,
      moves: Array.from({ length: 8 }, (_, i) => ({ timeSec: 1 + i, judged: true, pose: i % 2 ? RIGHT_ARM_OUT : LEFT_ARM_OUT })),
    };
    const run = (convention: 'mirror' | 'same-side') => {
      const sc = new PlayerScorer(asym, normal);
      let frame = 0;
      for (let t = 0; t <= 10; t += 1 / 30) {
        const i = Math.round(t - 1);
        const p = i >= 0 && i < 8 && Math.abs(t - 1 - i) < 0.3 ? asym.moves[i]!.pose : { leftUpperArm: [0.1, -1], leftForearm: [0.1, -1], rightUpperArm: [-0.1, -1], rightForearm: [-0.1, -1] } as Pose;
        const lms = synthesizeLandmarks(p, { mirroring: convention });
        sc.addSample(frame++, t, extractPose(lms, 'mirror'), extractPose(lms, 'same-side'));
        sc.advance(t);
      }
      sc.finish();
      return sc.summary().points;
    };
    const mirror = run('mirror');
    const same = run('same-side');
    expect(mirror).toBeGreaterThan(78);
    // Same-side players lose the first couple of moves while the booth learns, then score fully.
    expect(same).toBeGreaterThan(55);
    // Without the alternative reading they would score much less.
    const strict = new PlayerScorer(asym, normal);
    let f = 0;
    for (let t = 0; t <= 10; t += 1 / 30) {
      const i = Math.round(t - 1);
      const p = i >= 0 && i < 8 && Math.abs(t - 1 - i) < 0.3 ? asym.moves[i]!.pose : ({ leftUpperArm: [0.1, -1], leftForearm: [0.1, -1], rightUpperArm: [-0.1, -1], rightForearm: [-0.1, -1] } as Pose);
      strict.addSample(f++, t, extractPose(synthesizeLandmarks(p, { mirroring: 'same-side' }), 'mirror'));
      strict.advance(t);
    }
    strict.finish();
    expect(strict.summary().points).toBeLessThan(same - 20);
  });

  it('does not count tracking loss as failure', () => {
    const s = new PlayerScorer(routine, normal);
    feed(s, (t) => (t > 1.5 && t < 2.95 ? null : ARMS_UP));
    const sum = s.summary();
    expect(sum.insufficientEvidence).toBe(1);
    expect(sum.judgedMoves).toBe(2);
    expect(sum.percent).toBeGreaterThan(99);
  });

  it('ignores duplicate and out-of-order frames', () => {
    const s = new PlayerScorer(routine, normal);
    const pose = extractPose(synthesizeLandmarks(ARMS_UP, { mirroring: 'mirror' }), 'mirror');
    expect(s.addSample(5, 1, pose)).toBe(true);
    expect(s.addSample(5, 1, pose)).toBe(false);
    expect(s.addSample(4, 1.01, pose)).toBe(false);
  });

  it('is deterministic for identical input', () => {
    const run = () => {
      const s = new PlayerScorer(routine, DIFFICULTY_PRESETS.hard);
      feed(s, (t) => (t > 1.9 && t < 2.2 ? LEFT_ARM_OUT : ARMS_UP), 24);
      return JSON.stringify(s.moveResults);
    };
    expect(run()).toBe(run());
  });
});
