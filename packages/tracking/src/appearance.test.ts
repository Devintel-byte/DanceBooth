import { describe, expect, it } from 'vitest';
import type { DetectedBody } from '@booth/contracts';
import { APPEARANCE_BINS, appearanceDistance, appearanceSignature } from './appearance';
import { DEFAULT_ASSIGNMENT, PlayerAssigner } from './assignment';

/** RGBA image: left half one colour, right half another. */
function image(w: number, h: number, left: [number, number, number], right: [number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = x < w / 2 ? left : right;
      px.set([...c, 255], (y * w + x) * 4);
    }
  return px;
}

function person(rawX: number, look?: number[]): DetectedBody {
  const lms = Array.from({ length: 33 }, () => ({ x: rawX, y: 0.5, z: 0, visibility: 0.9 }));
  lms[11] = { x: rawX + 0.05, y: 0.35, z: 0, visibility: 0.9 };
  lms[12] = { x: rawX - 0.05, y: 0.35, z: 0, visibility: 0.9 };
  lms[23] = { x: rawX + 0.035, y: 0.6, z: 0, visibility: 0.9 };
  lms[24] = { x: rawX - 0.035, y: 0.6, z: 0, visibility: 0.9 };
  lms[25] = { x: rawX + 0.035, y: 0.75, z: 0, visibility: 0.9 };
  lms[26] = { x: rawX - 0.035, y: 0.75, z: 0, visibility: 0.9 };
  return look ? { detectionIndex: 0, imageLandmarks: lms, appearance: look } : { detectionIndex: 0, imageLandmarks: lms };
}

describe('appearance signature', () => {
  const px = image(200, 100, [220, 30, 30], [30, 60, 220]); // red shirt on the left, blue on the right
  const red = appearanceSignature(px, 200, 100, person(0.25).imageLandmarks)!;
  const blue = appearanceSignature(px, 200, 100, person(0.75).imageLandmarks)!;

  it('describes clothing colours', () => {
    expect(red).toHaveLength(APPEARANCE_BINS);
    expect(red.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(appearanceDistance(red, red)).toBeCloseTo(0);
    expect(appearanceDistance(red, blue)).toBeGreaterThan(0.9);
  });

  it('keeps duo identities through a collision where the players really swap sides', () => {
    const a = new PlayerAssigner({ ...DEFAULT_ASSIGNMENT, slots: 2, mirrorDisplay: true });
    // Calibration: P1 (display left = raw right) wears red, P2 wears blue.
    a.assign([person(0.7, red), person(0.3, blue)], 0);
    a.lockAppearance(1, red);
    a.lockAppearance(2, blue);
    expect(a.isLocked(1)).toBe(true);
    // They collide in the middle, then end up on the other sides.
    a.assign([person(0.52, red), person(0.48, blue)], 300);
    a.assign([person(0.45, red), person(0.55, blue)], 600);
    const s = a.assign([person(0.3, red), person(0.7, blue)], 900);
    const bodiesNow = [person(0.3, red), person(0.7, blue)];
    expect(bodiesNow[s.find((p) => p.slot === 1)!.bodyIndex!]!.appearance).toBe(red);
    expect(s.find((p) => p.slot === 2)!.bodyIndex).toBe(1);
  });

  it('recognises a locked player who left and came back on the other side', () => {
    const a = new PlayerAssigner({ ...DEFAULT_ASSIGNMENT, slots: 2, mirrorDisplay: true });
    a.assign([person(0.7, red), person(0.3, blue)], 0);
    a.lockAppearance(1, red);
    a.lockAppearance(2, blue);
    a.assign([person(0.3, blue)], 100); // P1 steps out of view
    const s = a.assign([person(0.3, blue), person(0.2, red)], 6000); // back after 6 s, far right of the display
    expect(s.find((p) => p.slot === 1)!.bodyIndex).toBe(1);
    expect(s.find((p) => p.slot === 2)!.bodyIndex).toBe(0);
  });
});
