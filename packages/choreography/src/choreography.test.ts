import { describe, expect, it } from 'vitest';
import {
  ClockMapper,
  RoutinePoseSampler,
  SongTimeline,
  beatAt,
  nextMoveIndex,
  sampleClipTimeline,
  smoothPoseToward,
  REST_POSE,
} from './index';

class FakeClock {
  currentTime = 0;
}

describe('SongTimeline', () => {
  it('derives song time from the audio clock, including lead-in', () => {
    const clock = new FakeClock();
    const tl = new SongTimeline(clock, { durationSec: 10 });
    clock.currentTime = 5;
    const { when, offset } = tl.schedule(8);
    expect(when).toBe(8);
    expect(offset).toBe(0);
    clock.currentTime = 6;
    expect(tl.songTimeSec()).toBeCloseTo(-2);
    expect(tl.status).toBe('scheduled');
    clock.currentTime = 9.5;
    expect(tl.songTimeSec()).toBeCloseTo(1.5);
    expect(tl.status).toBe('playing');
  });

  it('pauses and resumes from the held position without drift', () => {
    const clock = new FakeClock();
    const tl = new SongTimeline(clock, { durationSec: 10 });
    tl.schedule(0);
    clock.currentTime = 3.25;
    expect(tl.pause()).toBeCloseTo(3.25);
    clock.currentTime = 100; // time passes while paused
    expect(tl.songTimeSec()).toBeCloseTo(3.25);
    const r = tl.schedule(100.5, tl.resumePosition);
    expect(r.offset).toBeCloseTo(3.25);
    clock.currentTime = 101.5;
    expect(tl.songTimeSec()).toBeCloseTo(4.25);
  });

  it('applies the calibration offset to song time but not to audio position', () => {
    const clock = new FakeClock();
    const tl = new SongTimeline(clock, { durationSec: 10, calibrationOffsetMs: 100 });
    tl.schedule(0);
    clock.currentTime = 2;
    expect(tl.audioPositionSec()).toBeCloseTo(2);
    expect(tl.songTimeSec()).toBeCloseTo(1.9);
  });

  it('ends at the routine duration and refuses double scheduling', () => {
    const clock = new FakeClock();
    const tl = new SongTimeline(clock, { durationSec: 4 });
    tl.schedule(0);
    expect(() => tl.schedule(1)).toThrow();
    clock.currentTime = 5;
    expect(tl.ended).toBe(true);
    expect(tl.audioPositionSec()).toBe(4);
    tl.stop();
    expect(tl.status).toBe('idle');
  });

  it('maps capture timestamps onto song time', () => {
    const clock = new FakeClock();
    const tl = new SongTimeline(clock, { durationSec: 30 });
    const mapper = new ClockMapper();
    mapper.update({ contextTime: 10, performanceTime: 50_000 });
    tl.schedule(10);
    // A frame captured 2.5 s after the song started:
    expect(tl.songTimeAtAudioTime(mapper.toAudioTime(52_500))).toBeCloseTo(2.5);
  });
});

describe('RoutinePoseSampler', () => {
  const routine = {
    moves: [
      { timeSec: 1, judged: true, pose: { leftUpperArm: [1, 0] as [number, number] } },
      { timeSec: 2, judged: true, pose: { leftUpperArm: [0, 1] as [number, number] } },
    ],
  };

  it('hits keyframe poses exactly on time and is deterministic', () => {
    const s = new RoutinePoseSampler(routine);
    const p1 = s.sample(1);
    expect(p1.leftUpperArm.x).toBeCloseTo(1);
    expect(p1.leftUpperArm.y).toBeCloseTo(0);
    expect(s.sample(2).leftUpperArm.y).toBeCloseTo(1);
    expect(JSON.stringify(s.sample(1.6))).toBe(JSON.stringify(s.sample(1.6)));
  });

  it('carries unspecified segments forward from rest', () => {
    const s = new RoutinePoseSampler(routine);
    const d = s.sample(1.5).rightShin;
    expect(d.x).toBeCloseTo(REST_POSE.rightShin.x, 9);
    expect(d.y).toBeCloseTo(REST_POSE.rightShin.y, 9);
  });

  it('produces unit directions while interpolating', () => {
    const s = new RoutinePoseSampler(routine);
    for (let t = 0; t < 3; t += 0.07) {
      const d = s.sample(t).leftUpperArm;
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 6);
    }
  });
});

describe('smoothPoseToward', () => {
  it('converges independent of frame rate and clamps torso tilt', () => {
    const target = { ...REST_POSE, leftUpperArm: { x: 1, y: 0 }, torso: { x: 1, y: 0 } };
    const at60 = { ...REST_POSE };
    const at30 = { ...REST_POSE };
    for (let i = 0; i < 60; i++) smoothPoseToward(at60, target, 1 / 60);
    for (let i = 0; i < 30; i++) smoothPoseToward(at30, target, 1 / 30);
    expect(at60.leftUpperArm.x).toBeCloseTo(at30.leftUpperArm.x, 6);
    expect(at60.leftUpperArm.x).toBeGreaterThan(0.999);
    const tiltDeg = (Math.atan2(at60.torso.x, at60.torso.y) * 180) / Math.PI;
    expect(tiltDeg).toBeCloseTo(35, 3);
  });
});

describe('sampleClipTimeline', () => {
  const seg = (clip: string, startSec: number, endSec: number, extra = {}) => ({
    clip,
    startSec,
    endSec,
    timeScale: 1,
    clipOffsetSec: 0,
    blendSec: 0.5,
    ...extra,
  });
  const durations = { Dance: 2, Wave: 1 };

  it('loops the clip in song time and scales by timeScale', () => {
    const s = sampleClipTimeline([seg('Dance', 0, 10, { timeScale: 2 })], 1.25, durations);
    expect(s).toEqual([{ clip: 'Dance', time: 0.5, weight: 1 }]);
  });

  it('cross-fades into the next clip and weights sum to 1', () => {
    const s = sampleClipTimeline([seg('Dance', 0, 4), seg('Wave', 4, 8)], 4.25, durations);
    expect(s.map((x) => x.clip)).toEqual(['Dance', 'Wave']);
    expect(s[0]!.weight + s[1]!.weight).toBeCloseTo(1);
    expect(s[1]!.weight).toBeCloseTo(0.5);
  });

  it('holds the first segment before it starts and continues the last after it ends', () => {
    const segs = [seg('Dance', 2, 4), seg('Wave', 4, 6)];
    expect(sampleClipTimeline(segs, 0, durations)[0]).toMatchObject({ clip: 'Dance', time: 0 });
    expect(sampleClipTimeline(segs, 9, durations)[0]!.clip).toBe('Wave');
  });
});

describe('beat helpers', () => {
  it('computes beat index and phase', () => {
    const b = beatAt(1.25, 120, 0)!;
    expect(b.index).toBe(2);
    expect(b.phase).toBeCloseTo(0.5);
    expect(beatAt(1, undefined, 0)).toBeNull();
  });
  it('finds the next judged move', () => {
    const moves = [
      { timeSec: 1, judged: false, pose: {} },
      { timeSec: 2, judged: true, pose: {} },
    ];
    expect(nextMoveIndex(moves, 0)).toBe(1);
    expect(nextMoveIndex(moves, 2.5)).toBe(-1);
  });
});
