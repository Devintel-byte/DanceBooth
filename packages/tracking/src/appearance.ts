import { LANDMARK, type Landmark } from '@booth/contracts';

/**
 * Appearance signature of a tracked person: a colour histogram of their
 * clothing (torso and upper legs), used to tell two duo players apart when
 * their skeletons collide or cross. Only a 40-number histogram is computed
 * per frame; no image is stored, sent or logged.
 *
 * Bins: 12 hues x 3 saturation bands for coloured pixels, plus 4 brightness
 * bands for grey/black/white pixels. Normalised to sum 1.
 */
export const APPEARANCE_BINS = 40;

const HUE_BINS = 12;
const SAT_BANDS = 3;

function binOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  // Dark or unsaturated pixels have no reliable hue: bin them by brightness.
  if (v < 0.18 || s < 0.22) return HUE_BINS * SAT_BANDS + Math.min(3, Math.floor(v * 4));
  let h: number;
  const d = max - min;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const hb = Math.min(HUE_BINS - 1, Math.floor((h / 6) * HUE_BINS));
  const sb = Math.min(SAT_BANDS - 1, Math.floor(((s - 0.22) / 0.78) * SAT_BANDS));
  return hb * SAT_BANDS + sb;
}

const lerp = (a: Landmark, b: Landmark, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Samples the clothing of one body from an RGBA image (any size; landmarks
 * are image-normalised). Returns null when the torso is not visible enough.
 */
export function appearanceSignature(rgba: Uint8ClampedArray, width: number, height: number, lms: readonly Landmark[]): number[] | null {
  const ls = lms[LANDMARK.leftShoulder];
  const rs = lms[LANDMARK.rightShoulder];
  const lh = lms[LANDMARK.leftHip];
  const rh = lms[LANDMARK.rightHip];
  if (!ls || !rs || !lh || !rh) return null;
  if (Math.min(ls.visibility ?? 1, rs.visibility ?? 1, lh.visibility ?? 1, rh.visibility ?? 1) < 0.4) return null;
  const hist = new Array<number>(APPEARANCE_BINS).fill(0);
  let n = 0;
  const sample = (x: number, y: number) => {
    const px = Math.round(x * width);
    const py = Math.round(y * height);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const o = (py * width + px) * 4;
    hist[binOf(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!)]! += 1;
    n++;
  };
  // Torso: a grid inside the shoulder-hip quad, inset so arms crossing the
  // edge and the background beside the waist are mostly avoided.
  for (let i = 1; i <= 6; i++) {
    const t = 0.1 + (i / 7) * 0.85; // shoulder line -> hip line
    const left = lerp(ls, lh, t);
    const right = lerp(rs, rh, t);
    for (let j = 1; j <= 6; j++) {
      const u = 0.15 + (j / 7) * 0.7;
      sample(left.x + (right.x - left.x) * u, left.y + (right.y - left.y) * u);
    }
  }
  // Upper legs (trousers / skirt), when the knees are visible.
  for (const [hip, knee] of [
    [lh, lms[LANDMARK.leftKnee]],
    [rh, lms[LANDMARK.rightKnee]],
  ] as const) {
    if (!knee || (knee.visibility ?? 1) < 0.4) continue;
    for (let i = 1; i <= 5; i++) {
      const p = lerp(hip, knee, 0.15 + (i / 6) * 0.6);
      sample(p.x, p.y);
    }
  }
  if (n < 20) return null;
  return hist.map((c) => c / n);
}

/** 0 = identical colour distributions, 1 = nothing in common (Hellinger distance). */
export function appearanceDistance(a: readonly number[], b: readonly number[]): number {
  let bc = 0;
  for (let i = 0; i < APPEARANCE_BINS; i++) bc += Math.sqrt((a[i] ?? 0) * (b[i] ?? 0));
  return Math.sqrt(Math.max(0, 1 - bc));
}

/** Running average of signatures (weight = share of the new one). */
export function blendAppearance(prev: readonly number[] | null, next: readonly number[], weight: number): number[] {
  if (!prev) return [...next];
  return prev.map((p, i) => p * (1 - weight) + (next[i] ?? 0) * weight);
}
